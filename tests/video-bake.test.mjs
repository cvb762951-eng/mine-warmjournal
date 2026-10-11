import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 「真剪文件」（压缩并替换原件）是一个**不可逆**的动作，所以这里锁的不是手感而是底线：
// 坐标换算不能错、原片不能被顺手删掉、失败了不能动记录、取消必须真的取消。
const view = await readFile(new URL('../views/private-vault.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../vault-media-store.js', import.meta.url), 'utf8');
const mediaStore = await readFile(new URL('../media-store.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../native-video-reencode.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const plugin = await readFile(new URL('../android/app/src/main/java/com/mine/focus/VideoReencodePlugin.java', import.meta.url), 'utf8');
const activity = await readFile(new URL('../android/app/src/main/java/com/mine/focus/MainActivity.java', import.meta.url), 'utf8');
const appGradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const variables = await readFile(new URL('../android/variables.gradle', import.meta.url), 'utf8');

test('the re-encode plugin is declared, registered and reachable from the web layer', () => {
  assert.match(plugin, /@CapacitorPlugin\(name = "VideoReencode"\)/, '插件名要和网页层调用的一致');
  assert.match(bridge, /registerPlugin\('VideoReencode'\)/, '网页层要注册同名插件');
  // 漏注册的表现是"JS 调用时找不到插件而静默失败"，本项目已经踩过一次，必须有锁定。
  assert.match(activity, /registerPlugin\(VideoReencodePlugin\.class\)/, '插件必须在 MainActivity 里注册');
});

test('the encoder library is pinned in gradle so a clean build still resolves', () => {
  assert.match(variables, /media3Version = '[\d.]+'/, '版本号要集中管理');
  for (const artifact of ['media3-transformer', 'media3-effect', 'media3-common']) {
    assert.match(appGradle, new RegExp(`androidx\\.media3:${artifact}:\\$media3Version`), `${artifact} 必须显式声明`);
  }
  // 只声明真正用得到的那三个。注意 media3-exoplayer 会由 transformer 自己带进来
  // （Transformer 内部用播放器的解码链路），那是必要的，不属于"多引入"；
  // 真正该拦的是界面试图那些我们完全用不到、只会白涨包体的制品。
  assert.doesNotMatch(appGradle, /media3-(ui|session|cast|hls|dash|rtsp)/, '不要引入用不到的制品');
});

test('the crop rectangle is converted from the editor space into clip space with the Y axis flipped', () => {
  // 编辑器里量到的框：左上角为原点、y 向下；Crop 用的是 NDC：中心为原点、-1..1、y 向上。
  // y 忘了翻转的表现是"裁出来的是上下相反的那一块"，肉眼一看就是错的，所以这里逐行锁死。
  assert.match(plugin, /float left = clamp01\(cropX\) \* 2f - 1f;/, 'x 起点映射');
  assert.match(plugin, /float right = clamp01\(cropX \+ cropW\) \* 2f - 1f;/, 'x 终点映射');
  assert.match(plugin, /float top = 1f - clamp01\(cropY\) \* 2f;/, 'y 起点必须翻转');
  assert.match(plugin, /float bottom = 1f - clamp01\(cropY \+ cropH\) \* 2f;/, 'y 终点必须翻转');
  // 必须用 Media3 自带的 Crop：它同时决定"输出多大的画面"。
  // 只算裁剪矩阵、不改输出尺寸，画面会被拉变形 —— 这正是不能用自定义矩阵的原因。
  assert.match(plugin, /videoEffects\.add\(new Crop\(left, right, bottom, top\)\);/, '用 Media3 的 Crop 做裁剪');
  assert.doesNotMatch(plugin, /object-fit|clip-path/, '裁剪是重新编码，不是播放期遮罩');
});

test('trimming is frame-accurate and the output stays playable in the app', () => {
  assert.match(plugin, /setClippingConfiguration\(new MediaItem\.ClippingConfiguration\.Builder\(\)/, '剪时长走 ClippingConfiguration');
  assert.match(plugin, /\.setStartPositionMs\(startMs\)/, '起点精确到毫秒');
  assert.match(plugin, /\.setEndPositionMs\(endMs\)/, '终点精确到毫秒');
  assert.match(plugin, /\.setVideoMimeType\(MimeTypes\.VIDEO_H264\)/, '统一视频编码，保证重编码后还能在应用内播');
  assert.match(plugin, /\.setAudioMimeType\(MimeTypes\.AUDIO_AAC\)/, '统一音频编码');
  // 进度必须回传，否则长片压缩时用户只能干等一个"正在保存"。
  assert.match(plugin, /notifyListeners\("progress", payload\)/, '要有进度回调');
});

test('baking never silently deletes the original while encoding', () => {
  // 原片交给 JS 侧统一的"未引用媒体清理"处理（先入回收站，有找回窗口）。
  // 原生这边只该删自己产生的临时文件与失败的空壳。
  assert.match(plugin, /这里是\*\*新增文件\*\*，不删原片/, '这条约定要写在源码里，避免以后被"顺手清理"掉');
  assert.match(plugin, /private void deleteScratch\(\)/, '只清理解密用的临时文件');
  assert.doesNotMatch(plugin, /input\.delete\(\)/, '绝不删除输入的原片');
});

test('the web layer only re-encodes when it can actually read the file', () => {
  assert.match(store, /export async function reencodeVaultItem\(/, '要有一个明确的入口');
  assert.match(store, /网页预览不能重新压缩视频/, '网页预览要给出可读的说明而不是静默失败');
  assert.match(store, /私密空间已经锁定/, '未解锁时不能动文件');
  assert.match(store, /这段视频暂时不支持重新压缩/, '不认识的引用要明确拒绝');
  // 新文件已经在目标目录里了，只能"登记"，绝不能再复制一遍（那会白花一份时间与空间）。
  assert.match(store, /adoptNativeMediaFile\(result\.name, result\.uri\)/, '新文件只登记不复制');
  assert.match(mediaStore, /export function adoptNativeMediaFile\(name, uri\)/, '登记函数要真的存在');
  assert.match(mediaStore, /const ref = `\$\{PREFIX\}\$\{name\}`;/, '登记的引用要落在同一个命名空间');
  // 老包上热更新送不到原生能力，报错要翻译成人话。
  assert.match(store, /这个功能需要先安装最新的安装包/, '缺原生能力时要说清楚要先更新安装包');
});

test('the replace entry only shows up when there is actually something to bake in', () => {
  assert.match(view, /const canBake = item\.sourceType !== 'hls' && vaultItemEdited\(item\);/, '没剪辑过的视频不该出现这个入口');
  assert.match(view, /id="vault-menu-bake"/, '菜单里要有入口');
  assert.match(view, /id="vault-bake-confirm"/, '要有二次确认按钮');
  assert.match(view, /原来的整段录像会被删除，无法撤销/, '不可逆这件事必须写在确认框里');
  // ⚠️ 这里原先写的是"想留着原片、只另存一份剪好的，请改用保存到相册" —— 是错的：
  //    「保存到相册」走的是 exportVaultItemToGallery，原样交出存储文件，
  //    根本不读 trim/crop，导出的是**没剪过的原片**。别再写成那样。
  assert.match(view, /不想动原片就别做这一步/, '要给出不丢原片的退路');
  assert.doesNotMatch(view, /另存一份剪好的，请改用「保存到相册」/, '不能暗示"保存到相册"会导出剪好的版本');
  // 用户反馈过「我目前并不知道新增的压缩功能有什么用」——
  // 好处必须写在警告之前，而且入口那行小字也要说清楚，不能只讲"会删掉什么"。
  assert.match(view, /class="vault-bake-gain"/, '确认框要先把"这一步能给你什么"讲出来');
  assert.match(view, /剪掉的那部分会真正从这个文件里消失/, '要说清"内容真的消失"这一条');
  assert.match(view, /文件会明显变小/, '要说清体积变小');
  assert.match(view, /以后「保存到相册」导出的[\s\S]{0,30}也都是剪好的样子/, '要说清导出也是剪好的');
  assert.match(view, /剪掉的部分真正消失 · 文件变小/, '菜单入口的小字也要说明价值，不能只说"把剪辑做进文件里"');
  assert.ok(view.indexOf('vault-bake-gain') < view.indexOf('vault-bake-warning'), '先讲好处、再讲代价');
  assert.match(css, /\.vault-bake-gain\s*\{/, '好处块要有自己的样式（且与琥珀色警告块区分开）');
});

test('a finished bake clears the edit records so playback does not trim twice', () => {
  const bake = view.slice(view.indexOf('async function bakeVaultVideo('), view.indexOf('async function choosePrivateVideoCover('));
  assert.ok(bake.length > 0, '要能定位到替换流程');
  // ⚠️ 剪辑已经进到文件里了；记录若不删，播放时会被再剪一遍、再裁一遍。
  assert.match(bake, /item\.trim = null;/, '压缩后必须清掉时长记录');
  assert.match(bake, /item\.crop = null;/, '压缩后必须清掉画面记录');
  assert.match(bake, /item\.assetRef = result\.ref;/, '引用要换成新文件');
  assert.match(bake, /item\.assetIv = '';/, '换成普通引用后不该再留着老格式的密钥');
  // 顺序：先出文件，再动记录。中途失败时记录必须还是原样。
  const awaitIndex = bake.indexOf('await reencodeVaultItem');
  const assignIndex = bake.indexOf('item.assetRef = result.ref;');
  assert.ok(awaitIndex >= 0 && assignIndex > awaitIndex, '先出文件、再改记录，失败时原片与记录都不受影响');
  assert.match(bake, /时间轴整体前移/, '播放进度与封面时间点要跟着起点前移');
});

test('baking cannot look cancelled while still replacing the original', () => {
  // 点背景、按返回、按 Esc 都会让弹窗被移除。只要它不在了，就必须按放弃处理 ——
  // 否则会出现"用户以为取消了，原片却已经被换掉"这种最糟的结果。
  assert.match(view, /bakeObserver = new MutationObserver\(/, '要有弹窗消失的监视');
  assert.match(view, /if \(!document\.querySelector\('\.vault-bake-progress-modal'\)\) requestBakeCancel\(\);/, '弹窗一消失就按放弃处理');
  assert.match(view, /function requestBakeCancel\(\)/, '要有统一的放弃入口');
  assert.match(view, /cancelVaultReencode\(\)\.catch\(/, '放弃要真的通知原生停下');
  assert.match(view, /cancelVaultReencode/, '视图要接上取消能力');
  assert.match(store, /export async function cancelVaultReencode\(\)/, '取消要能传到原生');
  // 取消之后才回来的结果一律作废，绝不能"用户以为取消了、原片却已经被换掉"。
  assert.match(view, /if \(!bakeJob \|\| bakeJob\.cancelled\) throw new Error\('已取消，原视频没有改动'\);/, '取消后回来的结果一律作废');
});

test('the bake UI keeps the motion performance red lines', () => {
  assert.match(css, /\.vault-bake-warning\s*\{/, '确认框要有自己的样式');
  assert.match(css, /\.vault-bake-bar > i \{[^}]*transform: scaleX\(0\)/, '进度条用 transform 而不是 width');
  assert.match(css, /\.vault-bake-bar > i \{[^}]*transform-origin: left center/, '缩放要从左边长出来');
  // width 会触发布局，长片压缩时被高频刷新会拖慢页面（项目里三条性能红线之一）。
  assert.doesNotMatch(css, /\.vault-bake-bar > i \{[^}]*transition: width/, '不许补间会触发布局的属性');
  assert.match(view, /fill\.style\.transform = `scaleX\(/, '进度要用 transform 更新');
});
