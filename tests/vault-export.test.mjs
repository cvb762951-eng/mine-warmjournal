import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const plugin = await read('android/app/src/main/java/com/mine/focus/NativeMediaStorePlugin.java');
const manifest = await read('android/app/src/main/AndroidManifest.xml');
const vaultStore = await read('vault-media-store.js');
const vaultView = await read('views/private-vault.js');
const mediaStore = await read('media-store.js');

/**
 * 私密空间「保存到相册」（2026-10-10 新增）
 *
 * 这是私密空间唯一一次"主动把内容放出去"的动作，两条底线不能破：
 *   1. 明文不能在本机留下副本 —— 解密与写盘必须一步完成，不许先解密到缓存再复制；
 *   2. 导出前必须把"离开私密空间"这件事明确告诉用户，不能用小字糊过去。
 */

test('导出到相册：解密与写盘一步完成，不在本机留明文副本', async () => {
  // 只切「真正搬字节」的那个方法本体：切到下一个方法声明为止。
  // （不能一路切到文件尾 —— 后面 decryptMediaInBackground 用缓存目录是正常的，
  //   那是"临时解密播放"，和导出是两回事。）
  const from = plugin.indexOf('private void exportToGalleryInBackground');
  assert.ok(from > 0, '找不到 exportToGalleryInBackground');
  const stops = ['\n    private ', '\n    @PluginMethod']
    .map(marker => plugin.indexOf(marker, from + 10))
    .filter(index => index > 0);
  const body = plugin.slice(from, Math.min(...stops));
  assert.ok(body.length > 200, 'exportToGalleryInBackground 实现不完整');

  // 必须是"解密流 → 相册输出流"直连
  assert.match(body, /CipherInputStream/, '加密来源必须用解密流直读');
  assert.match(body, /openOutputStream\(target\)/, '必须直接写进相册的输出流');
  // 绝对不能先解密到缓存目录再复制 —— 那会在缓存里留下明文
  assert.ok(!body.includes('getCacheDir'), '导出不许经过缓存目录：明文会留副本');
  assert.ok(!body.includes('VAULT_PREVIEW_DIRECTORY'), '不许复用"解密预览"那套临时文件');
  assert.ok(!/new FileOutputStream\(/.test(body), '不许先落地成普通文件再复制');
});

test('导出到相册：失败时不在相册里留下打不开的空记录', async () => {
  const at = plugin.indexOf('public void exportToGallery');
  const body = plugin.slice(at, plugin.indexOf('private InputStream openSource', at));
  assert.match(body, /resolver\.delete\(target/, '写入失败要把刚插入的记录删掉');
  assert.match(body, /IS_PENDING/, '写入期间要用 IS_PENDING 标记，避免半截文件被相册收录');
});

test('导出到相册：两种来源都要支持（本机媒体 + 老版加密文件）', async () => {
  assert.match(vaultStore, /export async function exportVaultItemToGallery/);
  // 现在私密空间用的大多是 MineWarmJournalMedia 里的普通文件
  assert.match(vaultStore, /storedMediaName\(ref\)/, '要支持按本机文件名导出');
  // 老版本是 AES 加密存放的，要走解密分支
  assert.match(vaultStore, /isLegacyEncryptedRef\(ref\)[\s\S]{0,120}vaultName: keyOf\(ref\)/, '要支持老格式的加密文件');
  // 浏览器存法的引用没有本机文件，必须明确报错而不是静默失败
  assert.match(vaultStore, /这条内容暂时不支持导出到相册/);
});

test('导出到相册：先确认再导出，且把话说清楚', async () => {
  assert.match(vaultView, /id="vault-menu-export"/, '菜单里要有「保存到相册」');
  assert.match(vaultView, /function exportVaultItemPrompt/, '要有确认步骤，不能点了就导');
  assert.match(vaultView, /导出后不再受私密空间保护/, '必须明确告知"离开私密空间"这件事');
  assert.match(vaultView, /任何能看相册的应用都能看到它/, '必须说明后果');
  assert.match(vaultView, /原件仍留在私密空间/, '要说明原件不会被移走');
  // 流媒体没有本机文件，不该出现这个入口
  assert.match(vaultView, /item\.sourceType !== 'hls' \? '<button type="button" id="vault-menu-export"/, '流媒体不提供导出入口');
});

test('导出到相册：权限只在 Android 9 及以下申请', async () => {
  // Android 10 起用 MediaStore 插入，属于应用自己的写入，不需要权限
  assert.match(manifest, /WRITE_EXTERNAL_STORAGE[^>]*maxSdkVersion="28"/, '写权限必须限定 maxSdkVersion=28');
  assert.match(plugin, /@Permission\(alias = "legacyWrite"/, '要有 legacyWrite 权限别名');
  assert.match(plugin, /Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.Q/, '要按系统版本判断是否需要权限');
  assert.match(plugin, /@PermissionCallback/, '要有权限回调，否则被拒后不会重试');
});

test('导出到相册：文件名带日期，相册里能认出来', async () => {
  const at = vaultStore.indexOf('function galleryFileName');
  assert.ok(at > 0, '找不到 galleryFileName');
  const body = vaultStore.slice(at, at + 700);
  assert.ok(body.includes('私密视频'), '没有名称时要有兜底名');
  assert.ok(body.includes('私密照片'), '照片也要有兜底名');
  assert.ok(body.includes('replace('), '文件名要清掉系统不接受的字符');
  assert.ok(body.includes('item.date'), '文件名里要带上记录日期');
});

test('媒体引用可以取出本机文件名（导出用）', async () => {
  assert.match(mediaStore, /export const storedMediaName/);
  // 浏览器存法没有本机文件，必须返回空串而不是乱切
  assert.match(mediaStore, /isNativeRef\(value\) \? String\(value\)\.slice\(PREFIX\.length\) : ''/);
});

test('导出到相册：老装机包上要给一句人话，不能抛原生错误', async () => {
  // Capacitor 插件是代理对象：老包里没有这个方法时不会立刻失败，而是异步 reject "not implemented"。
  // 直接把这句话弹给用户毫无意义 —— 这个功能随装机包来，必须提示"先更新安装包"。
  assert.match(vaultStore, /async function callNativeExport/);
  assert.match(vaultStore, /not implemented/, '要识别"原生方法不存在"这种失败');
  assert.match(vaultStore, /需要先安装最新的安装包/, '要翻译成人话');
  // 两条导出路径都必须走这层包装，不能有漏网的直接调用
  const direct = vaultStore.match(/return NativeMediaStore\.exportToGallery\(/g) || [];
  assert.deepEqual(direct, [], '导出必须统一走 callNativeExport，不能直接调原生');
});

test('导出到相册：老装机包上要给一句人话，不能抛原生错误', async () => {
  // Capacitor 插件是代理对象：老包里没有这个方法时不会立刻失败，而是异步 reject "not implemented"。
  // 直接把这句话弹给用户毫无意义 —— 这个功能随装机包来，必须提示"先更新安装包"。
  assert.match(vaultStore, /async function callNativeExport/);
  assert.match(vaultStore, /not implemented/, '要识别"原生方法不存在"这种失败');
  assert.match(vaultStore, /需要先安装最新的安装包/, '要翻译成人话');
  // 两条导出路径都必须走这层包装，不能有漏网的直接调用
  const direct = vaultStore.match(/return NativeMediaStore\.exportToGallery\(/g) || [];
  assert.deepEqual(direct, [], '导出必须统一走 callNativeExport，不能直接调原生');
});
