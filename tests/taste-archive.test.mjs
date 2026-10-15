import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeDefaultState, makeTasteEntry, migrateState, SCHEMA_VERSION, tasteDayGroups, tasteMealOrder, tasteMealLabel, TASTE_MEALS, TASTE_VERDICTS } from '../model.js';
import { rebuildActivityLog } from '../activity-log.js';

const view = await readFile(new URL('../views/taste.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const storage = await readFile(new URL('../storage.js', import.meta.url), 'utf8');
const mediaStore = await readFile(new URL('../media-store.js', import.meta.url), 'utf8');
const mine = await readFile(new URL('../views/mine.js', import.meta.url), 'utf8');
const calendar = await readFile(new URL('../views/calendar.js', import.meta.url), 'utf8');
const today = await readFile(new URL('../views/today.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../ledger-taste-bridge.js', import.meta.url), 'utf8');
const photoUtils = await readFile(new URL('../photo-utils.js', import.meta.url), 'utf8');
const snippets = await readFile(new URL('../views/snippets.js', import.meta.url), 'utf8');

// 断言「界面上不该出现什么」时先剥注释：源码里的历史说明会误伤 doesNotMatch。
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const viewCode = stripComments(view);

test('吃喝记录：一顿一条，态度只留三档，旧五档自动归一化', () => {
  assert.deepEqual(Object.keys(TASTE_MEALS), ['breakfast', 'lunch', 'dinner', 'snack', 'drink']);
  assert.deepEqual(Object.keys(TASTE_VERDICTS), ['good', 'okay', 'bad']);
  const entry = makeTasteEntry({ meal: 'lunch', name: ' 番茄炒蛋 + 米饭 ', verdict: 'favorite', photos: ['mine-media://a.jpg', 'https://example.com/no.jpg'], notes: '  汤有点咸  ' });
  assert.equal(entry.meal, 'lunch');
  assert.equal(entry.name, '番茄炒蛋 + 米饭');
  assert.equal(entry.verdict, 'good', '旧版 favorite 应归一化到 good');
  assert.equal(entry.notes, '汤有点咸');
  assert.equal(entry.photos.length, 1);
  assert.equal(makeTasteEntry({ verdict: 'avoid' }).verdict, 'bad');
  assert.equal(makeTasteEntry({ verdict: 'again' }).verdict, 'good');
  assert.equal(makeTasteEntry({ verdict: 'okay' }).verdict, 'okay');
  assert.equal(makeTasteEntry({}).meal, '', '没给餐次时留空，不硬塞一个');
  assert.equal(makeTasteEntry({ meal: 'brunch' }).meal, '');
});

test('被移出界面的旧字段仍留在数据里，升级不会抹掉老记录', () => {
  const legacy = makeTasteEntry({ name: '老记录', rating: 5, price: '12.345', placeName: '某某面馆', brand: '示例品牌', location: '校区', flavorTags: ['酥脆', '咸香', '酥脆'] });
  assert.equal(legacy.rating, 5);
  assert.equal(legacy.price, 12.35);
  assert.equal(legacy.placeName, '某某面馆');
  assert.equal(legacy.brand, '示例品牌');
  assert.equal(legacy.location, '校区');
  assert.deepEqual(legacy.flavorTags, ['酥脆', '咸香']);
});

test('按天分组：组间日期倒序，组内先按餐次再按记录时间倒序', () => {
  const entries = [
    makeTasteEntry({ id: 'a', meal: 'dinner', name: '晚饭', date: '2026-10-15', createdAt: 30 }),
    makeTasteEntry({ id: 'b', meal: 'breakfast', name: '早饭', date: '2026-10-15', createdAt: 10 }),
    makeTasteEntry({ id: 'c', name: '没有餐次的旧记录', date: '2026-10-15', createdAt: 20 }),
    makeTasteEntry({ id: 'd', meal: 'lunch', name: '昨天的午饭', date: '2026-10-14', createdAt: 40 })
  ];
  const groups = tasteDayGroups(entries);
  assert.deepEqual(groups.map(group => group.date), ['2026-10-15', '2026-10-14']);
  assert.deepEqual(groups[0].entries.map(entry => entry.id), ['b', 'a', 'c'], '早餐 → 晚餐 → 未分类');
  assert.equal(tasteMealOrder(''), 9);
  assert.equal(tasteMealLabel('snack'), '加餐');
  assert.equal(tasteMealLabel(''), '记录');
});

test('迁移与联动：老状态可升级，吃喝记录仍进日历与活动流', () => {
  const migrated = migrateState({});
  assert.equal(migrated.meta.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.tasteEntries, []);
  const state = makeDefaultState();
  state.tasteEntries.push(makeTasteEntry({ id: 'taste-1', meal: 'dinner', name: '桂花酒酿', date: '2026-09-19', verdict: 'good', createdAt: new Date('2026-09-19T19:00:00').getTime() }));
  const event = rebuildActivityLog(state).find(item => item.kind === 'taste');
  assert.equal(event.title, '桂花酒酿');
  assert.match(event.summary, /晚餐.*好吃/);
  assert.match(calendar, /taste: \{ icon: 'restaurant_menu'/);
  assert.match(calendar, /\['habit', 'photo', 'taste', 'expense'/);
  assert.match(app, /item\.kind === 'taste'[\s\S]*openTasteEntry/);
});

test('记录册页：按顿记、不催办、照片走统一相框（480 铺底 + 原图清晰层）', () => {
  assert.match(mine, /id="open-taste-archive"/);
  assert.match(mine, /go\('taste'\)/);
  assert.match(mine, /吃喝记录/);
  assert.match(view, /吃喝记录/);
  assert.match(view, /taste-today-card/);
  assert.match(view, /taste-search-form/);
  assert.match(view, /id="taste-form"/);
  assert.match(view, /taste-meal-picker/);
  assert.match(view, /taste-verdict-picker/);
  assert.match(view, /tasteDayGroups/);
  assert.match(view, /taste-entry-cover/);
  assert.match(view, /importPhotoBatch/);
  assert.match(view, /confirmDelete/);
  assert.match(view, /registerHelper\('openTasteEntry'/);
  assert.match(view, /registerHelper\('newTasteEntry'/);
  /* 照片：统一相框 + 两段式（先 480 缩略图、清晰层够大/进视口再升原图），和随手拍同一套。
     ⚠️ 铺底层必须停在 480：两层都吃原图时，竖幅照片在相框里两侧的留边会变成
     "半透明的同一张原图"，看着像重影（2026-10-15 用户报「观感有点差」，就是这么来的）。 */
  assert.match(viewCode, /photoFrameLayersHtml\(url, \{ alt, thumbRef, progressive: Boolean\(thumbRef\), lazy: true \}\)/);
  assert.match(viewCode, /photo-blur-frame is-edge/);
  assert.match(viewCode, /progressiveSource\(source\)/, '清晰层起始要给缩略图/占位，不能一上来就拉原图');
  assert.match(viewCode, /watchThumbImages\(document\)/, '要接缩略图观察器（铺底层用的就是它）');
  assert.match(viewCode, /watchProgressiveImages\(document\)/, '要接原图升级观察器');
  assert.doesNotMatch(viewCode, /photoFrameLayersHtml\(imgSrc\(/, '不许再让铺底层吃原图——那就是重影');
  assert.doesNotMatch(viewCode, /registerOnRender/);
  // 不强制记录：界面上不出现"还差几顿"式的催办，旧版点评元素也彻底退场
  assert.doesNotMatch(viewCode, /还没记|差 \d+ 顿|今日待记/);
  assert.doesNotMatch(viewCode, /回购清单|避雷清单|店铺档案|taste-stars|评分|价格/);
});

test('今日首页有「今天吃了什么」，且不写成待办清单', () => {
  assert.match(today, /today-meals-card/);
  assert.match(today, /今天吃了什么/);
  assert.match(today, /callHelper\('newTasteEntry'\)/);
  assert.match(today, /callHelper\('openTasteEntry'/);
  assert.match(today, /go\('taste'\)/);
  assert.doesNotMatch(stripComments(today), /today-meal-slot|还没记/);
});

test('样式：吃喝记录不再叠纸边，已删除元素的规则一并清掉', () => {
  assert.match(styles, /\.taste-entry-cover/);
  assert.match(styles, /\.taste-day-group/);
  assert.match(styles, /\.today-meals-card/);
  assert.match(styles, /\.taste-meal-picker/);
  assert.match(styles, /\.phone-shell:has\(\.taste-view\) \.floating-dock\{display:none\}/);
  assert.doesNotMatch(styles, /taste-hero-paper|taste-place-card|taste-place-grid|taste-memory-shelf|taste-entry-photo|taste-more-fields|taste-stars|taste-detail-facts|taste-detail-tags/);
});

test('吃喝记录参与分区备份与媒体外置', () => {
  assert.match(storage, /'tasteEntries'/);
  assert.match(mediaStore, /state\?\.tasteEntries/);
});

test('吃喝记录：金额是可选的顺带一笔——不填就不提，也不让人填第二遍', () => {
  // 记一顿：多一格「花了多少」，可选
  assert.match(viewCode, /name="price" type="number"/, '表单要有金额输入');
  assert.match(viewCode, /花了多少（可选）/, '文案得说清这是可选的');
  assert.match(viewCode, /price: data\.get\('price'\)/, '保存要读这一格');
  // 显示：只在填过的时候出现，且不写账本式的小数
  assert.match(viewCode, /const tasteMoney = value =>/, '金额显示要有一个统一入口');
  assert.match(viewCode, /n <= 0\) return ''/, '没填（0）就什么都不显示');
  assert.match(viewCode, /replace\(\/\\\.00\$\//, '别写成 ¥28.00 这种账本式写法');
  assert.match(viewCode, /tasteMoney\(entry\.price\)/, '卡片第一行带上金额');
  assert.match(viewCode, /todayCardTitle\(todayEntries\)/, '今日那张卡要能报今天一共花了多少');
  // 账本那头：金额从这笔账直接带过来，用户不用填两遍
  assert.match(bridge, /price: transaction\.amount/, '从账本账建记录时要把金额带过去');
});

test('吃喝记录：加照片能拍也能选（相机取消不算错误）', () => {
  assert.match(viewCode, /id="taste-capture-photo"/, '表单要有「拍一张」');
  assert.match(viewCode, /id="taste-pick-photos"/, '表单要有「从相册选」');
  assert.match(viewCode, /Camera\.takePhoto\(/, '拍照要走原生相机（和随手拍同一套）');
  assert.match(viewCode, /Capacitor\.isNativePlatform\(\)/, '非原生平台要回落到文件选择，不能按了没反应');
  assert.match(viewCode, /isCameraCancellation\(error\)\) return;/, '用户按返回退出相机不算错误、不弹报错');
  // 共享判断只有一份：photo-utils 导出，随手拍不再自己实现
  assert.match(photoUtils, /export function isCameraCancellation/);
  assert.doesNotMatch(snippets, /^function isCameraCancellation/m, '随手拍里那份私有实现要删掉，改用共享的');
  assert.match(snippets, /isCameraCancellation,?\s*\}? from '\.\.\/photo-utils\.js'/, '随手拍要从共享模块引');
});
