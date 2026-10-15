// 吃喝记录（路由 id 仍为 taste，2026-10-15 由「味觉档案」全面升级而来）
//
// 定位变了：以前是「点评册」——每条都得表态好不好吃、几颗星、多少钱、哪家店；
// 现在是「记录册」——按顿记，记下吃了什么/喝了什么、拍张照、给个态度就够了。
//
// 三条硬规则（2026-10-15 用户当面确定）：
// 1. 一顿一条，餐次五类（早餐/午餐/晚餐/加餐/喝的），但**不强制记录**，
//    界面绝不出现"今天还差几顿没记"这种催办语气。
// 2. 记一条只要三件事：照片 + 吃了什么 + 对食物的态度。其余都可选。
// 3. 旧版字段（评分/价格/店铺/品牌/口味标签/地点）不再出现在界面上；
//    数据本身保留在 model.js（见 makeTasteEntry 注释），需要时能恢复展示。
import { $, $$, esc, state, save, render, modal, closeModal, show, confirmDelete, imgSrc, goBack, registerView, registerBinder, registerSubmitHandler, registerHelper } from '../core.js';
import { dateKey, makeTasteEntry, tasteDayGroups, tasteMealLabel, TASTE_MEALS, TASTE_VERDICTS } from '../model.js';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraDirection, EncodingType } from '@capacitor/camera';
import { compressSnippetPhoto, importPhotoBatch, isSupportedJournalPhoto, isCameraCancellation } from '../photo-utils.js';
import { photoViewer } from './common.js';
import { photoFrameLayersHtml } from '../photo-frame.js';
import { thumbKeyFor, progressiveSource, watchThumbImages, watchProgressiveImages } from '../photo-thumbs.js';
import { withFlip, motionAllowed, mountRailMarker, EASE } from '../motion.js';

let tasteFilter = 'all';
let tasteSearch = '';
let pendingTastePhotos = [];

/* 刚记下 / 刚改完的那一条：本轮渲染不排队错落，直接从上方「落位」（见 performance.css 的 ④）。
   只认得 10 秒内的那一次 —— 从今日首页记完再绕回记录册时才不会莫名弹一下。 */
const JUST_ADDED_MS = 10000;
let justAdded = null;
const isJustAdded = id => Boolean(justAdded && justAdded.id === id && Date.now() - justAdded.at < JUST_ADDED_MS);

const MEAL_KEYS = Object.keys(TASTE_MEALS);
const VERDICT_KEYS = Object.keys(TASTE_VERDICTS);
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/* 重排动画用的身份：一条记录的 id / 一张照片的地址。 */
const entryKeyOf = card => card.querySelector('[data-open-taste]')?.dataset.openTaste || '';
/* 照片格的稳定标识写在 data 属性上，别靠 <img> 的地址 ——
   地址解析不出来时（还没导入完 / 解析失败）会是空串，几张照片就撞成同一个 key，
   重排动画会静默不跑。 */
const photoKeyOf = span => span.dataset.photoKey || '';
const CARD_ITEM = '.taste-entry-list > .taste-entry-card';
const PHOTO_ITEM = '#taste-photo-preview > span';

/* 金额显示：¥28 / ¥28.5 / ¥28.55（不补两位小数——这里是顺带看一眼的小字，不是账本）。
   只在真的填过（> 0）时才出现。 */
const tasteMoney = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return '¥' + n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

const hasMeal = entry => Boolean(TASTE_MEALS[entry?.meal]);
const verdictOf = entry => TASTE_VERDICTS[entry?.verdict] || TASTE_VERDICTS.good;

/* 照片走全 App 统一的那套相框（photo-blur-frame：同图放大铺底 + 上层 contain 完整显示，
   不裁切不拉伸，与随手拍 / 今日画页 / 私密空间同一实现）。
   两段式（和随手拍同一套）：先 480 缩略图，清晰层进视口 / 够大了再换原图 ——
   用户要的「原图」给到清晰层；**铺底层永远停在 480 缩略图**（全站约定）。
   ⚠️ 2026-10-15 踩过：两层都传原图，竖幅照片在横幅相框里两侧的留边成了"半透明的同一张原图"，
   看着像重影（用户报「观感有点差」）。 */
function tastePhotoImage(source, alt = '') {
  const thumbRef = thumbKeyFor(source) ? source : '';
  const url = thumbRef ? esc(progressiveSource(source)) : imgSrc(source);
  return photoFrameLayersHtml(url, { alt, thumbRef, progressive: Boolean(thumbRef), lazy: true });
}

// 新记录默认落在哪个餐次：按"现在几点"给一个**默认值**（界面上可见、可改），
// 不是偷偷替用户决定。旧记录没有餐次时也用它兜底。
function defaultMeal() {
  const hour = new Date().getHours();
  if (hour < 10) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

const timeLabel = entry => {
  const stamp = Number(entry?.createdAt) || 0;
  if (!stamp) return '';
  const date = new Date(stamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

function dayParts(day) {
  const today = dateKey();
  const yesterday = dateKey(new Date(Date.now() - 86400000));
  const date = new Date(`${day}T12:00:00`);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) && !Number.isNaN(date.getTime());
  const weekday = valid ? WEEK_CN[date.getDay()] : '';
  if (!valid) return { main: String(day), sub: '' };
  if (day === today) return { main: '今天', sub: `${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}` };
  if (day === yesterday) return { main: '昨天', sub: `${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}` };
  return { main: String(date.getDate()), sub: `${date.getMonth() + 1}月 · ${weekday}` };
}

function tasteDayGroup(group) {
  const parts = dayParts(group.date);
  return `<section class="taste-day-group"><header class="taste-day-head"><span class="taste-day-date"><b>${esc(parts.main)}</b><em>${esc(parts.sub)}</em></span><span class="taste-day-count">${group.entries.length} 条</span></header><div class="taste-entry-list">${group.entries.map(tasteEntryCard).join('')}</div></section>`;
}

// 一条记录的排版（2026-10-15 按用户给的参考图定稿）：
// 小字元信息（餐次 · 时间 + 态度） → 加粗标题 → 一段文字 → 大图原比例完整显示。
// 大图单独是一个按钮：点图直接看大图，点文字进详情（全 App 一致的手感）。
function tasteEntryCard(entry) {
  const verdict = verdictOf(entry);
  /* 没选餐次的记录不要写成「记录 · 14:30」—— 那一行本来就是「记录」，重复一遍是噪音。 */
  const mealLabel = hasMeal(entry) ? tasteMealLabel(entry.meal) : '';
  const time = timeLabel(entry);
  const photos = entry.photos || [];
  const cover = photos[0] || '';
  return `<article class="taste-entry-card verdict-${entry.verdict}${isJustAdded(entry.id) ? ' is-just-added' : ''}">
    <div class="taste-entry-head"><span class="taste-entry-meta">${esc([mealLabel, time, tasteMoney(entry.price)].filter(Boolean).join(' · ') || '未填')}</span><span class="taste-verdict-tag">${esc(verdict.label)}</span></div>
    <button type="button" class="taste-entry-body" data-open-taste="${entry.id}">
      <strong class="taste-entry-title">${esc(entry.name)}</strong>
      ${entry.notes ? `<p class="taste-entry-notes">${esc(entry.notes)}</p>` : ''}
      ${cover ? '' : '<span class="taste-entry-note-hint">还没有照片</span>'}
    </button>
    ${cover ? `<button type="button" class="taste-entry-cover photo-blur-frame is-edge" data-taste-photo="${entry.id}" aria-label="查看「${esc(entry.name)}」的照片">${tastePhotoImage(cover, entry.name)}${photos.length > 1 ? `<span class="taste-entry-count">共 ${photos.length} 张</span>` : ''}</button>` : ''}
  </article>`;
}

/* 今日那张卡的标题：记了几顿 + 今天一共花了多少（没填金额就不提钱）。 */
function todayCardTitle(entries) {
  if (!entries.length) return '今天吃了什么';
  const spend = entries.reduce((sum, entry) => sum + (Number(entry.price) > 0 ? Number(entry.price) : 0), 0);
  return `今天记了 ${entries.length} 顿${spend > 0 ? ` · ${tasteMoney(spend)}` : ''}`;
}

function filteredEntries() {
  const needle = tasteSearch.trim().toLocaleLowerCase('zh-CN');
  return (state.tasteEntries || [])
    .filter(entry => {
      if (tasteFilter === 'none') { if (hasMeal(entry)) return false; }
      else if (tasteFilter !== 'all' && entry.meal !== tasteFilter) return false;
      if (!needle) return true;
      return [entry.name, entry.notes, tasteMealLabel(entry.meal)]
        .join(' ').toLocaleLowerCase('zh-CN').includes(needle);
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date))
      || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

function filters() {
  const list = [['all', '全部'], ...MEAL_KEYS.map(key => [key, TASTE_MEALS[key].label])];
  if ((state.tasteEntries || []).some(entry => !hasMeal(entry))) list.push(['none', '未分类']);
  return list;
}

export function tasteView() {
  const all = state.tasteEntries || [];
  const entries = filteredEntries();
  const today = dateKey();
  const todayEntries = all
    .filter(entry => entry.date === today)
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  const groups = tasteDayGroups(entries);
  const filtering = tasteSearch.trim() || tasteFilter !== 'all';
  const html = `<section class="view taste-view" id="screen-taste">
    <header class="taste-header"><button id="taste-back" aria-label="返回 Mine"><span class="material-symbols-outlined">arrow_back</span></button><span><small>EATING LOG</small><strong>吃喝记录</strong><em>吃过什么，随手记下来</em></span><button id="taste-new" aria-label="记一顿"><span class="material-symbols-outlined">add</span></button></header>
    ${tasteTodayCard(todayEntries, all.length)}
    <section class="taste-controls-paper"><form id="taste-search-form" role="search"><span class="material-symbols-outlined">search</span><input name="search" value="${esc(tasteSearch)}" placeholder="搜索吃过的东西或写下的感受" aria-label="搜索吃喝记录"><button>查找</button></form><div class="taste-filter-rail" id="taste-filter-rail" role="group" aria-label="按餐次筛选">${filters().map(([value, label]) => `<button type="button" data-taste-filter="${value}" class="${tasteFilter === value ? 'active' : ''}" aria-pressed="${tasteFilter === value}">${label}</button>`).join('')}</div></section>
    <section class="taste-section"><header><span><small>${filtering ? 'FILTERED' : 'RECENT MEALS'}</small><h2>${filtering ? '筛选结果' : '最近记下的'}</h2></span><em>${entries.length} 条</em></header>
      ${groups.length ? groups.map(tasteDayGroup).join('') : tasteEmpty(all.length, filtering)}
    </section>
    <p class="taste-local-note"><span class="material-symbols-outlined">lock</span>照片和记录只保存在本机，并进入加密备份。</p>
  </section>`;
  justAdded = null;   // 「落位」只播一次；下一次渲染（筛选、删除、翻回来）都走普通错落
  return html;
}

// 「今天」卡片：显示今天已经记下的，不做成待办清单，不出现"还没记"的格子（用户要求不强制记录）。
function tasteTodayCard(todayEntries, total) {
  const strip = todayEntries.length
    ? `<div class="taste-today-strip">${todayEntries.map(entry => `<button type="button"${isJustAdded(entry.id) ? ' class="is-just-added"' : ''} data-open-taste="${entry.id}"><span class="taste-today-thumb photo-blur-frame is-edge">${entry.photos?.[0] ? tastePhotoImage(entry.photos[0], entry.name) : `<b>${esc(tasteMealLabel(entry.meal).slice(0, 1))}</b>`}</span><strong>${esc(entry.name)}</strong><small>${esc(hasMeal(entry) ? tasteMealLabel(entry.meal) : (timeLabel(entry) || '记录'))}</small></button>`).join('')}<button type="button" class="taste-today-add" id="taste-today-new" aria-label="再记一顿"><span class="material-symbols-outlined">add</span><small>再记</small></button></div>`
    : `<div class="taste-today-empty"><p>今天还没有记录。想记的时候随手添一笔就行。</p><button type="button" id="taste-today-new"><span class="material-symbols-outlined">add</span>记一顿</button></div>`;
  return `<section class="taste-today-card"><header><span><small>TODAY</small><h2>${todayCardTitle(todayEntries)}</h2></span><em>${total} 条</em></header>${strip}</section>`;
}

function tasteEmpty(hasRecords, filtering) {
  const title = filtering ? '没有符合条件的记录' : '还没有记过一顿';
  const body = filtering ? '换个关键词或餐次试试。' : '拍张照，写下吃了什么和觉得怎么样，就是这么简单。';
  return `<div class="taste-empty"><span class="material-symbols-outlined">restaurant_menu</span><strong>${title}</strong><p>${body}</p><button type="button" id="taste-empty-new"><span class="material-symbols-outlined">add</span>记一顿</button></div>`;
}

export function tasteForm(entry = null) {
  const item = entry || makeTasteEntry({ date: dateKey(), meal: defaultMeal(), verdict: 'good' });
  pendingTastePhotos = [...item.photos];
  modal(`<form id="taste-form"><input type="hidden" name="id" value="${entry ? item.id : ''}"><div class="modal-head"><div><span class="eyebrow">MEAL NOTE</span><h2>${entry ? '编辑这一条' : '记一顿'}</h2><p>拍张照片，写下吃了什么、你觉得怎么样就够了，其他都能以后再补。</p></div></div><div class="taste-photo-picker"><div id="taste-photo-preview">${tastePhotoPreview()}</div><div class="taste-photo-actions"><button type="button" id="taste-capture-photo"><span class="material-symbols-outlined">photo_camera</span>拍一张</button><button type="button" id="taste-pick-photos"><span class="material-symbols-outlined">photo_library</span>从相册选</button></div></div><label>吃了什么 / 喝了什么</label><input name="name" maxlength="80" required value="${esc(item.name)}" placeholder="例如：番茄炒蛋 + 米饭、冰美式"><label>这是哪一顿</label><div class="taste-meal-picker">${MEAL_KEYS.map(key => `<label><input type="radio" name="meal" value="${key}" ${item.meal === key ? 'checked' : ''}><span>${TASTE_MEALS[key].label}</span></label>`).join('')}</div><label>对它的态度</label><div class="taste-verdict-picker">${VERDICT_KEYS.map(key => `<label><input type="radio" name="verdict" value="${key}" ${item.verdict === key ? 'checked' : ''}><span>${TASTE_VERDICTS[key].label}</span></label>`).join('')}</div><label>想说的话（可选）</label><textarea name="notes" maxlength="300" rows="3" placeholder="好吃在哪里，或者为什么不合口味……">${esc(item.notes)}</textarea><div><label>花了多少（可选）</label><input name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(item.price) > 0 ? item.price : ''}" placeholder="不填就不记"></div><div><label>日期</label><input name="date" type="date" required value="${item.date}"></div><div class="modal-actions">${entry ? '<button type="button" class="danger" id="taste-delete">删除</button>' : ''}<button type="button" data-close>取消</button><button class="save">存进记录册</button></div></form>`, 'taste-form-modal');
  bindTasteForm(entry);
}

function tastePhotoPreview(newIndex = -1) {
  return pendingTastePhotos.length ? pendingTastePhotos.map((photo, index) => `<span class="photo-blur-frame is-edge${index === newIndex ? ' is-new' : ''}" data-photo-key="${esc(photo)}">${tastePhotoImage(photo, `照片 ${index + 1}`)}<button type="button" data-remove-taste-photo="${index}" aria-label="移除第 ${index + 1} 张照片"><span class="material-symbols-outlined">close</span></button></span>`).join('') : '<p><span class="material-symbols-outlined">photo_camera</span><small>最多 6 张照片</small></p>';
}

/* 删一张照片：被删的那张先缩走，其余几张滑到新位置（FLIP）。
   直接重渲染的话整排会"啪"地跳一下，看起来很糙。 */
function removeTastePhoto(index) {
  const preview = $('#taste-photo-preview');
  const target = preview ? [...preview.querySelectorAll(':scope > span')][index] : null;
  const drop = () => withFlip(preview || document.body, () => {
    pendingTastePhotos.splice(index, 1);
    refreshTastePhotoPreview();
  }, { item: PHOTO_ITEM, key: photoKeyOf });
  if (!motionAllowed() || !target?.animate) { drop(); return; }
  const out = target.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translate3d(0, -6px, 0) scale(0.88)' }],
    { duration: 170, easing: EASE.settle, fill: 'forwards' }
  );
  out.finished.then(drop, drop);
}

// newIndex：刚加进来的那一张才弹一下。删掉一张时不能重播（否则整排会一起乱动）。
function refreshTastePhotoPreview(newIndex = -1) {
  const preview = $('#taste-photo-preview');
  if (preview) preview.innerHTML = tastePhotoPreview(newIndex);
  $$('[data-remove-taste-photo]').forEach(button => button.onclick = () => removeTastePhoto(Number(button.dataset.removeTastePhoto)));
}

function bindTasteForm(existing) {
  $('#taste-pick-photos')?.addEventListener('click', () => pickTastePhotos(false).catch(error => show(error.message)));
  $('#taste-capture-photo')?.addEventListener('click', () => pickTastePhotos(true).catch(error => show(error.message)));
  refreshTastePhotoPreview();
  $('#taste-delete')?.addEventListener('click', () => confirmDelete(`删除“${existing.name}”这条记录？`, () => deleteTasteEntry(existing.id)));
}

/* 加照片有两个入口：拍一张（原生相机）/ 从相册选。
   ⚠️ 相机这段和随手拍是同一套（@capacitor/camera）；用户按返回退出相机不算错误。
   ⚠️ 相机只在原生里用；浏览器预览时自动回落到文件选择（否则网页上按了没反应）。 */
async function pickTastePhotos(useCamera = false) {
  if (6 - pendingTastePhotos.length <= 0) throw new Error('每条记录最多保存 6 张照片');
  if (useCamera && Capacitor.isNativePlatform()) {
    try {
      const photo = await Camera.takePhoto({
        quality: 86,
        targetWidth: 1600,
        targetHeight: 1600,
        correctOrientation: true,
        encodingType: EncodingType.JPEG,
        saveToGallery: false,
        cameraDirection: CameraDirection.Rear,
        editable: 'no',
        includeMetadata: true
      });
      if (!photo.webPath) throw new Error('相机没有返回照片');
      const response = await fetch(photo.webPath);
      if (!response.ok) throw new Error('无法读取刚拍摄的照片');
      const blob = await response.blob();
      const file = new File([blob], `meal-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
      const [compressed] = await importPhotoBatch([file], compressSnippetPhoto, { concurrency: 2 });
      pendingTastePhotos.push(compressed);
      refreshTastePhotoPreview(pendingTastePhotos.length - 1);
      return;
    } catch (error) {
      if (isCameraCancellation(error)) return;
      throw error;
    }
  }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.multiple = true;
  const files = await new Promise(resolve => { input.onchange = () => resolve([...input.files || []]); input.oncancel = () => resolve([]); input.click(); });
  if (!files.length) return;
  if (files.some(file => !isSupportedJournalPhoto(file))) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (files.some(file => file.size > 20 * 1024 * 1024)) throw new Error('单张照片不能超过 20MB');
  const remaining = 6 - pendingTastePhotos.length;
  if (remaining <= 0) throw new Error('每条记录最多保存 6 张照片');
  const imported = await importPhotoBatch(files.slice(0, remaining), compressSnippetPhoto, { concurrency: 2 });
  pendingTastePhotos.push(...imported); refreshTastePhotoPreview(pendingTastePhotos.length - 1);
  if (files.length > remaining) show(`已添加 ${remaining} 张，单条记录最多 6 张`);
}

async function saveTasteForm(data) {
  const id = String(data.get('id') || '');
  const existing = state.tasteEntries.find(entry => entry.id === id);
  // 只提交界面上的字段；旧版的 rating / placeName / brand / location / flavorTags
  // 通过 {...existing} 原样带过，不会被这次编辑清空。（price 从 2026-10-15 起回到界面，按输入值写。）
  const next = makeTasteEntry({
    ...existing,
    id: existing?.id || crypto.randomUUID(),
    meal: data.get('meal'),
    name: data.get('name'),
    verdict: data.get('verdict'),
    notes: data.get('notes'),
    date: data.get('date'),
    price: data.get('price'),
    photos: pendingTastePhotos,
    createdAt: existing?.createdAt,
    updatedAt: Date.now()
  });
  if (!next.name) throw new Error('请填写吃了什么或喝了什么');
  existing ? Object.assign(existing, next) : state.tasteEntries.unshift(next);
  pendingTastePhotos = [];
  // 记下来「哪一条是刚记的」，本次渲染让它直接落位、不排队（见 performance.css ④）
  justAdded = { id: next.id, at: Date.now() };
  await save(); closeModal(); render(); show('已记进吃喝记录');
}

async function deleteTasteEntry(id) {
  state.tasteEntries = state.tasteEntries.filter(entry => entry.id !== id);
  pendingTastePhotos = []; await save(); closeModal(); render(); show('记录已删除');
}

function tasteDetail(entry) {
  if (!entry) return;
  const verdict = verdictOf(entry), mealLabel = hasMeal(entry) ? tasteMealLabel(entry.meal) : '', time = timeLabel(entry);
  modal(`<article class="taste-detail"><header><small>${esc([mealLabel, entry.date, time, tasteMoney(entry.price)].filter(Boolean).join(' · '))}</small><h2>${esc(entry.name)}</h2><span class="taste-detail-verdict verdict-${entry.verdict}">${esc(verdict.label)}</span></header>${entry.photos.length ? `<button type="button" class="taste-detail-gallery photo-blur-frame is-edge" id="taste-detail-gallery">${tastePhotoImage(entry.photos[0], entry.name)}<span>${entry.photos.length} 张照片</span></button>` : ''}${entry.notes ? `<p>${esc(entry.notes)}</p>` : ''}<div class="modal-actions"><button type="button" data-close>关闭</button><button type="button" class="save" id="taste-detail-edit">编辑</button></div></article>`, 'taste-detail-modal');
  $('#taste-detail-gallery')?.addEventListener('click', () => photoViewer(entry.photos, 0));
  $('#taste-detail-edit').onclick = () => tasteForm(entry);
}

/* 餐次筛选栏里那块「选中的底」：换餐次时它滑过去，而不是闪现。
   位置怎么摆、上次在哪，都收在动效层（motion.js 的 mountRailMarker），预览页用同一份；
   这里只负责在每次渲染之后摆一次 —— render() 之后的绑定器会跑到这里。 */
/* 换餐次 / 改搜索：留下来的那条从旧位置滑到新位置（FLIP），
   新出现的照常错落入场。两者都在合成器上跑，不触发布局。 */
function relayoutTasteList(change) {
  withFlip(document.body, change, { item: CARD_ITEM, key: entryKeyOf, mute: '.taste-day-group' });
}

function bindTaste() {
  $('#taste-back')?.addEventListener('click', goBack);
  $('#taste-new')?.addEventListener('click', () => tasteForm());
  $('#taste-empty-new')?.addEventListener('click', () => tasteForm());
  $('#taste-today-new')?.addEventListener('click', () => tasteForm());
  $$('[data-taste-filter]').forEach(button => button.onclick = () => {
    const next = button.dataset.tasteFilter;
    if (next === tasteFilter) return;
    /* ⚠️ 这里**不要**再摆一次选中块：render() 之后的绑定器已经摆过一次了，
       第二次会把正在滑动的过渡关掉（读 style.transition 会变成 none），滑动就没了。 */
    relayoutTasteList(() => { tasteFilter = next; render(); });
  });
  $$('[data-open-taste]').forEach(button => button.onclick = () => tasteDetail(state.tasteEntries.find(entry => entry.id === button.dataset.openTaste)));
  // 点大图直接看大图（不做进入动效，和随手拍/日历/私密空间一致）。
  $$('[data-taste-photo]').forEach(button => button.onclick = () => {
    const entry = state.tasteEntries.find(item => item.id === button.dataset.tastePhoto);
    if (entry?.photos?.length) photoViewer(entry.photos, 0);
  });
  mountRailMarker($('#taste-filter-rail'));
  // 照片两段式：缩略图进视口就生成（铺底层用它），清晰层够大了再升原图；离开自动卸掉
  watchThumbImages(document);
  watchProgressiveImages(document);
}

registerSubmitHandler('taste-search-form', async data => {
  const next = String(data.get('search') || '').trim();
  relayoutTasteList(() => { tasteSearch = next; render(); });
  return false;
});
registerSubmitHandler('taste-form', async data => { await saveTasteForm(data); return false; });
registerHelper('openTasteEntry', id => tasteDetail(state.tasteEntries.find(entry => entry.id === id)));
registerHelper('newTasteEntry', () => tasteForm());
registerView('taste', tasteView);
registerBinder(bindTaste);
