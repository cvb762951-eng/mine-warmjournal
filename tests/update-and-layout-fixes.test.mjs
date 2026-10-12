import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const style = await read('styles.css');
const snippets = await read('views/snippets.js');
const photoFrame = await read('photo-frame.js');
const activity = await read('android/app/src/main/java/com/mine/focus/MainActivity.java');

/**
 * 2026-10-09 用户报的三个问题
 *
 * ① 装到 1.0.72，界面仍显示 1.0.71
 * ② 随手拍没法完整展示竖屏视频封面
 * ③ 底部导航的纸背景没罩住文字
 */

test('① 换装机包后必须丢弃上一版的热更新资源', () => {
  // 根因：热更新目录优先于装机资源，而里面的文件属于上一个装机版本。
  // 装了新包反而被旧缓存盖住，界面永远停在旧版 —— 用户实测「装到 1.0.72 却显示 1.0.71」。
  assert.match(activity, /discardStaleHotAssets\(hotDir\)/, '启动时要先清理失效的热更新资源');
  assert.match(activity, /new File\(hotDir, "\.apk-version"\)/, '需要记录「应用时的装机版本」');
  assert.match(activity, /if \(appliedVersionCode != currentVersionCode\)/, '版本不一致就丢弃');
  assert.match(activity, /deleteRecursively\(hotDir\)/);
  // 读不到装机版本时不能乱删
  assert.match(activity, /return; \/\/ 读不到装机版本就别乱删/);
  // 必须在挂载拦截器之前执行，否则旧资源还会先被用上
  const clearAt = activity.indexOf('discardStaleHotAssets(hotDir)');
  const mountAt = activity.indexOf('new HotAssetWebViewClient');
  assert.ok(clearAt > -1 && mountAt > -1 && clearAt < mountAt, '清理要排在挂载之前');
});

test('② 随手拍的视频封面：统一为横屏高度 + 两侧虚化（方案③最终版）', () => {
  // 这条规则的演进（五次都因为用户反馈而改）：
  //   v1 固定 178px 横条 + 深色留白 → 竖屏缩成中间一小条、两侧两条深色，像"没加载出来"
  //   v2 高度跟随内容 + 限幅 → 竖屏变大了，但卡片高矮不一，列表不齐
  //   v3 方框统一 1:1 → 列表齐了，但横屏卡片被迫变高，用户不接受
  //   v4 各自按内容比例 → 横屏矮、竖屏高，用户仍不接受（原话「竖屏视频的高度也按横屏视频的来」）
  //   v5 现在：竖屏也用横屏的高度（统一 16:9 横条），画面完整居中，两侧留白用虚化兜住
  const frame = style.match(/\.snippets-view \.snippet-cover-frame\{([^}]*)\}/)?.[1] || '';
  assert.ok(frame, '应能找到视频封面的方框规则');
  assert.match(frame, /aspect-ratio:16\/9/, '统一为横屏画面的高度，竖屏不会再把卡片撑高');
  assert.doesNotMatch(frame, /aspect-ratio:1\/1/, '不能是正方形（用户已否决）');
  assert.match(frame, /overflow:hidden/, '虚化层被放大过，必须靠方框裁边');

  const blur = style.match(/\.snippets-view \.snippet-cover-blur\{([^}]*)\}/)?.[1] || '';
  assert.ok(blur, '应有底层虚化规则');
  assert.match(blur, /filter:blur\(/, '底层要是同一画面放大虚化，不能是纯色块');
  assert.match(blur, /object-fit:cover/, '底层要铺满，不能留白');

  const main = style.match(/\.snippets-view \.snippet-cover-main\{([^}]*)\}/)?.[1] || '';
  assert.ok(main, '应有上层主图规则');
  assert.match(main, /object-fit:contain/, '上层要完整显示，不能裁切');
  assert.match(main, /height:100%/, '主图要铺满框高，竖屏多出来的部分由虚化兜住');
  // 高度不能再由内容决定，否则竖屏又会把卡片撑高
  assert.doesNotMatch(main, /height:auto/, '高度不得跟随画面比例，否则卡片又高矮不一');
  assert.doesNotMatch(style, /max-height:min\(64vh,480px\)/, '超高限幅那版应已移除');

  // 两层复用同一地址 → 只下载一次，不额外占存储、不用重新处理图片
  // 2026-10-12：两层结构已抽到共用实现 photo-frame.js（牌组/随手拍/私密空间共用），
  // 断言跟着改成「随手拍调用共用实现 + 共用实现里两层引用同一个 url」——意图不变，写法跟上源码。
  assert.match(snippets, /photoFrameLayersHtml\(url, \{[^}]*padClass: 'snippet-cover-blur'/, '虚化层要用封面自己的地址');
  assert.match(snippets, /photoFrameLayersHtml\(url, \{[^}]*stillClass: 'snippet-cover-main'/, '主图要用同一个地址');
  const urlsInFrame = photoFrame.match(/src="\$\{url\}"/g) || [];
  assert.ok(urlsInFrame.length >= 2, '共用实现里两层必须引用同一个地址（浏览器只下载一次）');
  assert.match(snippets, /snippet-cover-frame is-video-cover/, '列表卡片要渲染虚化封面的方框');

  // 最早的固定高度横条规则不能回来
  assert.doesNotMatch(style, /\.snippets-view \.snippet-photo-cover\.is-video-cover\{/,
    '旧的固定 178px 横条规则应已移除');
});

test('③ 底部导航要留得下图标加文字', () => {
  // 全局 box-sizing 是 border-box，64px 扣掉 padding 与底部安全区后只剩约 35px，
  // 装不下图标(24px) + 文字(12px)，文字底部被挤出纸外 —— 用户反馈「没罩住文字」。
  const dockHeight = Number(style.match(/--dock-height:\s*(\d+)px/)?.[1] || 0);
  assert.ok(dockHeight >= 70, `导航栏高度应至少 70px 才装得下内容，当前 ${dockHeight}px`);
  // 高度要用变量，改一处即可，且 --dock-clearance 会自动跟随
  assert.match(style, /\.floating-dock\{width:100%;height:var\(--dock-height\)/,
    '导航栏高度应改用变量而非硬编码');
  assert.doesNotMatch(style, /\.floating-dock\{width:100%;height:64px/);
  assert.match(style, /--dock-clearance:\s*calc\(var\(--dock-height\)/, '页面底部留白要跟着一起变');
});
