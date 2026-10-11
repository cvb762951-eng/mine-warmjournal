import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

const perf = readFileSync(new URL('../performance.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const mediaView = readFileSync(new URL('../views/media.js', import.meta.url), 'utf8');
const statsView = readFileSync(new URL('../views/stats.js', import.meta.url), 'utf8');
const timetableView = readFileSync(new URL('../views/timetable.js', import.meta.url), 'utf8');
const ledgerView = readFileSync(new URL('../views/ledger.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../core.js', import.meta.url), 'utf8');

/**
 * 暖色纸张画报系统的一致性契约。
 *
 * 背景：项目早期是冷调玻璃态，V1.0.9 之后整体转为暖色纸张系统。
 * 二级页里仍残留冷调样式会造成「点进去像另一个 App」的割裂感。
 * 这些断言锁住暖色纸张的底线，防止重构时被无意改回玻璃态。
 */

test('all secondary pages use the same back-button icon', () => {
  // 二级页头部曾混用 arrow_back(5处) 与 arrow_back_ios(2处)
  const views = mediaView + statsView + timetableView + ledgerView + core;
  assert.doesNotMatch(views, /arrow_back_ios/, '不应再出现第二种返回图标');
  assert.match(core, /subpage-back-btn[\s\S]{0,120}?arrow_back/, '通用头部组件应使用 arrow_back');
});

test('all secondary page back buttons say the same thing', () => {
  // 标题里塞「· 返回账本」这类具体指向，与其他页的「返回」不一致
  assert.doesNotMatch(ledgerView, /subpageHeader\(`\$\{title\} · 返回/, '账本页标题不应再带「返回账本」后缀');
  assert.doesNotMatch(mediaView, /返回书影音/, '书影音页不应使用专属返回文案');
});

test('secondary page header is paper, not glass', () => {
  // 顶栏原为纯色半透明 + blur(20px) 玻璃态
  assert.match(styles, /\.subpage-nav-bar[\s\S]{0,600}?secondary-header-paper-v1\.png/, '二级页顶栏应铺头部纸素材');
  // 玻璃模糊应大幅减弱（纸张是磨砂质感，不是强玻璃）
  const navBlock = styles.slice(styles.indexOf('.subpage-nav-bar {'), styles.indexOf('.subpage-back-btn {'));
  assert.doesNotMatch(navBlock, /blur\(20px\)/, '顶栏不应再使用 20px 强玻璃模糊');
});

test('media detail cards use paper instead of white rounded cards', () => {
  // 书影音档案页三张主卡曾是 background:#fff + border-radius:24px
  assert.match(perf, /\.media-detail-hero-card\{[^}]*?secondary-content-paper-v1\.png/, '封面卡应铺内容纸');
  assert.doesNotMatch(perf, /\.media-detail-hero-card\{[^}]*?background:#fff;/, '封面卡不应再是纯白底');
  assert.match(perf, /\.media-detail-note-card,\.media-detail-focus-card\{[^}]*?secondary-content-paper-v1\.png/, '手记/专注卡应铺内容纸');
  assert.doesNotMatch(perf, /\.media-detail-note-card,\.media-detail-focus-card\{[^}]*?border-radius:24px/, '手记/专注卡不应再是 24px 圆角');
});

test('warm design tokens are used, not hardcoded cool grays', () => {
  // 设计令牌是暖色体系的一部分，二级页应复用
  assert.match(perf, /--warm-canvas:\s*#f5f1e8/, '暖色画布令牌应存在');
  assert.match(perf, /--warm-ink:\s*#181614/, '暖色墨迹令牌应存在');
  assert.match(perf, /--warm-shadow-ambient/, '暖色阴影令牌应存在');
  // 二级页容器应使用令牌
  assert.match(perf, /\.subpage-layer\s*\{\s*background:\s*var\(--warm-canvas\)/, '二级页底色应使用暖色画布令牌');
});

test('page identity is preserved — subpages keep their own accents', () => {
  // 反向约束：统一不等于抹平。各二级页的专属装饰必须保留。
  // 这些素材是「专属身份」的载体，删掉就把画报系统变成了单调卡片流。
  const identity = [
    ['secondary-media-accent-v1.png', '书影音'],
    ['secondary-habit-accent-v1.png', '习惯档案'],
    ['secondary-journal-accent-v1.png', '日记阅读'],
    ['secondary-ledger-accent-v1.png', '账本分析'],
    ['secondary-focus-accent-v1.png', '专注复盘'],
    ['timetable-campus-collage.png', '课表'],
  ];
  for (const [asset, label] of identity) {
    assert.match(styles + perf, new RegExp(asset.replace('.png', '')), `${label} 的专属装饰素材（${asset}）应保留`);
    assert.ok(existsSync(new URL(`../assets/${asset}`, import.meta.url)), `${label} 素材文件应存在：${asset}`);
  }
});

test('paper assets referenced by subpages actually exist', () => {
  const referenced = [...(styles + perf).matchAll(/assets\/([a-z0-9-]+\.png)/g)].map(m => m[1]);
  const missing = [...new Set(referenced)].filter(name => !existsSync(new URL(`../assets/${name}`, import.meta.url)));
  assert.deepEqual(missing, [], `以下被引用的素材文件不存在：${missing.join(', ')}`);
});
