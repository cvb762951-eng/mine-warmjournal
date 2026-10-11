import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const vault = await read('views/private-vault.js');
// 方向判定本身在数据层（2026-10-10 迁过去）：它还要处理"裁过画面之后以取景框为准"，
// 只放在视图层会和播放器/列表的其他判断不一致。
const vaultData = await read('private-vault.js');
const snippets = await read('views/snippets.js');
const style = await read('styles.css');

/**
 * 私密空间的「按方向筛选」（2026-10-09 新增）
 *
 * 用户诉求：能筛出竖屏视频和横屏视频，并且在竖屏分类下把竖屏视频的封面
 * 调整到「最能体现」的样式。
 *
 * 这正好化解了前几轮那对矛盾：
 *   混排时 → 卡片统一尺寸（整齐）
 *   只看竖屏时 → 切换成竖版卡片（内容充分展示）
 * 不是靠统一尺寸硬压所有内容，而是按当前视图的需要切换。
 */

test('方向判定：优先用元数据，其次按宽高比，都不行则不归类', () => {
  assert.match(vaultData, /export function vaultItemOrientation\(item\)/);
  assert.match(vaultData, /if \(item\.displayOrientation === 'portrait'\) return 'portrait'/);
  assert.match(vaultData, /if \(item\.displayOrientation === 'landscape'\) return 'landscape'/);
  assert.match(vaultData, /if \(!frame\.width \|\| !frame\.height\) return ''/, '尺寸未知时返回空串');
  assert.match(vaultData, /return frame\.height > frame\.width \? 'portrait' : 'landscape'/);
  // 关键取舍：拿不到尺寸时**不猜**，宁可筛不出来也不把内容归错方向
  assert.match(vaultData, /宁可筛不出来，也不要猜错了把内容归错类/);
  // 视图层不能再自己维护一份，否则两处会各判各的
  assert.doesNotMatch(vault, /function vaultItemOrientation\(/);
  assert.match(vault, /import \{[^}]*vaultItemOrientation[^}]*\} from '\.\.\/private-vault\.js'/);
});

test('裁过画面之后：方向以取景框为准，横竖屏翻转要能重新归类', () => {
  // 有 crop 时必须先走取景框分支，不能被导入时那套「黑边分析」的旧结论截胡
  assert.match(
    vaultData,
    /if \(item\.crop\) \{[\s\S]{0,220}?return frame\.height > frame\.width \? 'portrait' : 'landscape'/,
    'crop 存在时方向必须由取景框决定'
  );
  assert.match(vaultData, /export function vaultFrameSize\(item\)[\s\S]{0,160}croppedFrame\(item\?\.width, item\?\.height, item\?\.crop\)/);
  // 列表卡片是不是竖版，也必须跟着重判
  assert.match(vault, /const portraitCover = item\.type === 'video' && vaultItemOrientation\(item\) === 'portrait'/);
});

test('画面被裁剪后，播放器的控件按「看到的画面」排版', () => {
  assert.match(snippets, /croppedFrame\(width, height, videoCrop\)/, '要按裁剪后的画面算尺寸');
  assert.match(snippets, /updateFeedVideoBounds\(\$\('#warm-video-player'\), viewport, shown\.width, shown\.height\)/,
    '进度条与信息层的位置要按裁剪后的画面算');
  assert.match(snippets, /let frame = shownFrame|const frame = shownFrame\(player\.videoWidth, player\.videoHeight\)/,
    '尺寸变化时重算也要带上裁剪');
  assert.match(snippets, /landscapeButton\.hidden = !shownIsLandscape/, '横屏按钮要按裁剪后的方向显示');
});

test('筛选值与类型筛选用的是同一组互斥选项', () => {
  assert.match(vault, /const ORIENTATION_FILTERS = new Set\(\['portrait', 'landscape'\]\)/);
  assert.match(vault, /ORIENTATION_FILTERS\.has\(vaultMediaFilter\)[\s\S]{0,120}filter\(item => vaultItemOrientation\(item\) === vaultMediaFilter\)/);
  // 类型筛选分支必须保留（全部 / 照片 / 视频）
  assert.match(vault, /vaultMediaFilter === 'all' \|\| item\.type === vaultMediaFilter/);
  // 五个按钮：全部 / 照片 / 视频 / 竖屏 / 横屏
  for (const value of ['all', 'photo', 'video', 'portrait', 'landscape']) {
    assert.match(vault, new RegExp(`data-vault-media-filter="${value}"`), `缺少「${value}」筛选按钮`);
  }
  // 绑定是通用的（读 dataset），新值无需额外接线
  assert.match(vault, /vaultMediaFilter = button\.dataset\.vaultMediaFilter/);
});

test('竖屏筛选下视频框切换成竖版比例（这是「最能体现」的关键）', () => {
  // 网格要带上当前方向的标记类
  assert.match(vault, /class="vault-grid\$\{ORIENTATION_FILTERS\.has\(vaultMediaFilter\) \? ` filter-\$\{vaultMediaFilter\}` : ''\}"/);
  assert.match(style, /\.private-vault-view \.vault-grid\.filter-portrait \.vault-video-item \.vault-media-box\{?\s*[^}]*aspect-ratio:9\/16/,
    '竖屏筛选下视频框要用 9:16');
  // 默认仍是 16:9（混排时保持整齐）
  assert.match(style, /\.private-vault-view \.vault-video-item \.vault-media-box,[^{]*\{[^}]*aspect-ratio:16\/9/,
    '默认仍是 16:9，不能把混排视图也改成竖版');
});

test('空状态文案区分方向筛选', () => {
  assert.match(vault, /'这里还没有竖屏内容'/);
  assert.match(vault, /'这里还没有横屏内容'/);
  assert.match(vault, /ORIENTATION_FILTERS\.has\(vaultMediaFilter\) \? 'screen_rotation'/);
});
