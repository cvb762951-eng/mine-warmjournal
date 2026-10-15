import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

/* ---------------------------------------------------------------------------
   应用内更新（2026-10-09 新增）

   设计原则：**只在用户显式点击时联网**。
   本模块不注册任何自动检查、不在启动时拉取版本清单 —— 这与项目
   「零自动联网，只有用户显式操作才请求」的一贯原则保持一致。

   更新源是一份静态 JSON（version.json），与安装包放在同一个位置。
   发布新版本时把这两样一起更新即可，App 侧不需要改代码。

   安全约束：
   · 只接受 https 地址（原生侧还有二次校验）；
   · 下载走原生，落到应用缓存目录，不落公共存储；
   · 安装必须经过 Android 系统安装器的确认页，App 无法静默安装；
   · 清单必须带 sha256。下载后核对，缺失、算不出来或不一致都拒绝安装。
   --------------------------------------------------------------------------- */

const AppUpdater = registerPlugin('AppUpdater');

/* 渲染时用的版本常量（设置页要同步显示，不能等异步）。
   ⚠️ 发版时五处一起改，scripts/check-versions.mjs 在打包前核对，漏一处直接失败：
   package.json 的 version、这里的 APP_VERSION_NAME / APP_VERSION_CODE、
   android/app/build.gradle 的 versionName / versionCode、
   index.html 里所有 ?v=、release-notes.js 里当前 versionCode 的条目（name 与 versionName 相同）。
   真正做「有没有新版」判断时改用 currentVersion()，它以系统记录为准。 */
export const APP_VERSION_NAME = '1.1.48';
export const APP_VERSION_CODE = 149;

let cachedVersion = null;

/** 从系统读取当前版本。比常量准（以实际安装的包为准），失败时回退到常量。 */
export async function currentVersion() {
  if (cachedVersion) return cachedVersion;
  if (!isUpdateSupported()) {
    cachedVersion = { versionName: APP_VERSION_NAME, versionCode: APP_VERSION_CODE };
    return cachedVersion;
  }
  try {
    const result = await AppUpdater.getVersion();
    cachedVersion = {
      versionName: String(result?.versionName || APP_VERSION_NAME),
      versionCode: Number(result?.versionCode) || APP_VERSION_CODE
    };
  } catch {
    cachedVersion = { versionName: APP_VERSION_NAME, versionCode: APP_VERSION_CODE };
  }
  return cachedVersion;
}

/* ---------------------------------------------------------------------------
   资源热更新（2026-10-09）

   目标：更新时**只下载真的变了的文件**，而不是重下整个安装包。

   做法：
   1. 发布端为每个资源文件生成 sha256 清单（scripts/make-resource-manifest.mjs）
   2. 客户端拿清单与本地「已应用清单」比对，算出差异
   3. 只把差异文件交给原生下载（原生不受跨域限制，且能写私有目录）
   4. 全部成功才更新本地清单 —— 有失败就保持旧清单，下次继续补齐

   资源读到哪：原生侧 HotAssetWebViewClient 优先从 filesDir/hot 读，
   那里没有的走装机自带资源 —— 所以热更新失败最多是「还是旧版本」，不会白屏。
   --------------------------------------------------------------------------- */

const HOT_MANIFEST_PATH = 'hot/manifest.json';
const HOT_VERSION_PATH = 'hot/version.json';
// 装机自带的资源指纹（由 scripts/build-web.mjs 生成，与 index.html 同源）。
// 它**不参与热更新** —— 必须保持「装机那一刻」的样子，才能当比对基线。
const BUILTIN_MANIFEST_URL = 'resource-manifest.json';

/* 热更新只替换网页资源，装机包的 versionCode 不会变。
   若不单独记下「已应用到的资源版本」，检查更新就会永远显示「有新版本」。
   所以每次成功应用资源后，额外落一个小文件记录版本号。 */
async function readAppliedVersion() {
  try {
    const result = await Filesystem.readFile({ path: HOT_VERSION_PATH, directory: Directory.Data, encoding: 'utf8' });
    const text = typeof result?.data === 'string' ? result.data : '';
    const parsed = JSON.parse(text);
    return {
      versionCode: Number(parsed?.versionCode) || 0,
      versionName: String(parsed?.versionName || '')
    };
  } catch {
    return { versionCode: 0, versionName: '' };
  }
}

async function writeAppliedVersion(versionCode, versionName) {
  try {
    await Filesystem.writeFile({
      path: HOT_VERSION_PATH,
      directory: Directory.Data,
      data: JSON.stringify({ versionCode: Number(versionCode) || 0, versionName: String(versionName || '') }),
      encoding: 'utf8',
      recursive: true
    });
  } catch { /* 记不上只是下次仍提示更新，不影响已生效的资源 */ }
}

/** 已应用到的资源版本号（没热更新过就是 0）。 */
export async function appliedResourceVersionCode() {
  return (await readAppliedVersion()).versionCode;
}

/**
 * 「当前实际生效的版本」：装机版本与「已应用到的资源版本」里取较新的那个。
 *
 * ⚠️ 为什么必须有它（2026-10-12 用户反馈）：热更新只替换网页资源，装机包的
 * versionCode 永远不变。用户装着 1.1.14 的包、一路热更到 1.1.17 之后，
 * 装机版本号还停在 115。界面上一处显示「当前 1.1.17」（按资源算）、
 * 另一处点检查却报「已是最新版本（1.1.14）」（按装机算）——
 * 用户看到的就是「显示的版本号和实际版本号不符合」。
 * ⇒ 所有给用户看的「当前版本」都走这一个函数，保证只有一个答案。
 */
export async function effectiveVersion() {
  const installed = await currentVersion();
  const applied = await readAppliedVersion();
  const appliedCode = Number(applied.versionCode) || 0;
  if (appliedCode > (Number(installed.versionCode) || 0)) {
    return {
      versionCode: appliedCode,
      versionName: applied.versionName || installed.versionName,
      source: 'resource'
    };
  }
  return {
    versionCode: Number(installed.versionCode) || 0,
    versionName: installed.versionName,
    source: 'installed'
  };
}

/**
 * 算本次热更新**实际要下多少**：拿远程资源清单和本地「已应用清单」比对，
 * 把变化文件的体积加起来。
 *
 * ⚠️ 别拿安装包体积充数（2026-10-12 用户反馈「更新的实际大小一直写死一个值」）：
 * 整包 83.5MB，而热更新通常只有几 MB。用整包体积会让用户以为每次都要下一整包。
 * 读不到清单时返回 count=0 / bytes=0，调用方据此不显示具体数字，绝不编一个。
 */
export async function pendingResourceUpdate(resourceManifest) {
  const applied = await readAppliedResources();
  const files = (resourceManifest?.files || []).filter(file => file && typeof file.path === 'string' && file.path);
  const changed = files.filter(file => applied[file.path] !== file.sha256);
  const bytes = changed.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  return {
    count: changed.length,
    bytes,
    // 每个文件都带体积才算得准；缺一个就不报价，避免低报
    exact: changed.length > 0 && changed.every(file => Number(file.size) > 0)
  };
}

/** 读取本地已应用的热更新清单（文件路径 → sha256）。没有则回落到装机自带指纹。 */
async function readAppliedResources() {
  // 1) 热更新过的清单最权威
  try {
    const result = await Filesystem.readFile({ path: HOT_MANIFEST_PATH, directory: Directory.Data, encoding: 'utf8' });
    const text = typeof result?.data === 'string' ? result.data : '';
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) return parsed;
  } catch {
    // 还没热更新过，走下面的装机指纹
  }
  // 2) 装机自带的 resource-manifest.json —— 由 scripts/build-web.mjs 在打包时生成。
  //    没有它的话，首次热更新会因为「本地没有任何记录」而把所有文件都当成变化项，
  //    等于把整份资源下一遍，与整包更新无异。
  try {
    const response = await fetch(BUILTIN_MANIFEST_URL, { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      if (Array.isArray(payload?.files) && payload.files.length) {
        return Object.fromEntries(payload.files.map(file => [file.path, file.sha256]));
      }
    }
  } catch {
    // 读不到就退回空对象：会多下一些文件，但不会出错
  }
  return {};
}

async function writeAppliedResources(map) {
  try {
    await Filesystem.writeFile({
      path: HOT_MANIFEST_PATH,
      directory: Directory.Data,
      data: JSON.stringify(map),
      encoding: 'utf8',
      recursive: true
    });
    return true;
  } catch {
    // 清单写失败不影响本次已下载的文件，下次会重新比对（最坏情况是重复下一次）
    return false;
  }
}

/** 拉取资源清单（与版本清单分开，只有要热更新时才请求）。 */
export async function fetchResourceManifest(versionManifest) {
  const url = String(versionManifest?.resourceManifestUrl || '');
  if (!url.startsWith('https://')) return null;
  const text = await fetchUpdateText(url);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('资源清单格式不正确');
  }
  if (!Array.isArray(payload?.files) || !payload.files.length) throw new Error('资源清单是空的');
  return payload;
}

/**
 * 应用资源更新：比对差异后只下载变化的文件。
 * onProgress(done, total, failed) 用于显示进度。
 */
export async function applyResourceUpdate(resourceManifest, onProgress) {
  if (!isUpdateSupported()) throw new Error('仅 Android 版支持资源热更新');
  const baseUrl = String(resourceManifest?.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl.startsWith('https://')) throw new Error('资源地址必须是 https');

  const applied = await readAppliedResources();
  const files = resourceManifest.files.filter(file => file && typeof file.path === 'string' && file.path);
  const changed = files.filter(file => applied[file.path] !== file.sha256);
  const removed = Object.keys(applied).filter(path => !files.some(file => file.path === path));

  if (!changed.length && !removed.length) {
    return { downloaded: 0, failed: 0, total: 0, upToDate: true };
  }

  let listener = null;
  if (typeof onProgress === 'function') {
    listener = await AppUpdater.addListener('resourceProgress', payload => {
      onProgress(Number(payload?.done) || 0, Number(payload?.total) || changed.length, Number(payload?.failed) || 0);
    });
  }

  try {
    const result = await AppUpdater.syncResources({
      files: changed.map(file => ({
        path: file.path,
        url: `${baseUrl}/${file.path}`,
        sha256: String(file.sha256 || '')
      }))
    });
    const failed = Number(result?.failed) || 0;
    // 只有全部成功才写清单：有失败就保持旧清单，下次会重新比对并补齐
    if (!failed) {
      const next = {};
      for (const file of files) next[file.path] = file.sha256;
      await writeAppliedResources(next);
      // 同时记下已应用到的版本，否则「检查更新」会一直提示有新版
      await writeAppliedVersion(resourceManifest.versionCode, resourceManifest.versionName);
    }
    return {
      downloaded: Number(result?.downloaded) || 0,
      failed,
      failedPaths: Array.isArray(result?.failedPaths) ? result.failedPaths : [],
      total: changed.length,
      upToDate: false
    };
  } finally {
    listener?.remove?.();
  }
}

// 默认更新源，按顺序尝试。用户设置了 updateManifestUrl 时只用那一个，不再回落。
// 1. GitHub Release 上的 version.json（最新正式版的附件）
// 2. 旧的 workbuddy 地址：GitHub 超时、HTTP 错误或清单无效时兜底
// ⚠️ 清单和安装包都只接受 https。sha256 缺失视为清单无效，不能跳过校验。
export const DEFAULT_UPDATE_MANIFESTS = [
  'https://github.com/cvb762951-eng/mine-warmjournal/releases/latest/download/version.json',
  'https://warm-journal-apk.app.workbuddy.host/version.json'
];
export const DEFAULT_UPDATE_MANIFEST = DEFAULT_UPDATE_MANIFESTS[0];

// 旧版所有版本共用这一个文件名。系统安装器按路径记住了上一包，
// 下次即使下到了新内容，也会报「已安装相同版本 1.1.30」。
const LEGACY_UPDATE_APK_NAME = 'warmjournal-update.apk';
const MANIFEST_TIMEOUT_MS = 15000;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** 缓存文件名带上 versionCode，不同版本不会写进同一个路径。 */
export function updateApkFileName(versionCode) {
  const code = Number(versionCode);
  if (!Number.isInteger(code) || code <= 0) return '';
  return `warmjournal-update-${code}.apk`;
}

/**
 * 缓存里的安装包能不能用。
 *
 * - `reuse`：跳过下载之前。versionCode、versionName、体积、sha256 必须都对得上清单。
 *   读不出包内版本就不要复用（那可能是上次留下的 1.1.30）。
 * - `download`：刚下完。sha256 必须一致；读得到版本号时，版本也必须一致。
 *   个别系统解析不了归档时版本号是 0，这时只认 sha256 和体积，不因此拒绝安装。
 */
export function apkCacheMatches(manifest, file, mode = 'reuse') {
  const expectedSha = String(manifest?.sha256 || '').trim().toLowerCase();
  const actualSha = String(file?.sha256 || '').trim().toLowerCase();
  if (!SHA256_RE.test(expectedSha) || expectedSha !== actualSha) return false;

  const expectedSize = Number(manifest?.sizeBytes) || 0;
  const actualSize = Number(file?.size) || 0;
  if (!(actualSize > 0)) return false;
  if (expectedSize > 0 && actualSize !== expectedSize) return false;

  const expectedCode = Number(manifest?.versionCode) || 0;
  const actualCode = Number(file?.versionCode) || 0;
  if (!(expectedCode > 0)) return false;
  if (mode === 'reuse' && !(actualCode > 0)) return false;
  if (actualCode > 0 && actualCode !== expectedCode) return false;

  const expectedName = String(manifest?.versionName || '').trim();
  const actualName = String(file?.versionName || '').trim();
  if (mode === 'reuse' && expectedName && !actualName) return false;
  if (expectedName && actualName && actualName !== expectedName) return false;
  return true;
}

export const updateManifestUrl = settings => String(settings?.updateManifestUrl || '').trim() || DEFAULT_UPDATE_MANIFEST;

export function isUpdateSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/** 空地址用默认列表；用户填了地址就只试那一个。 */
export function manifestEndpoints(url) {
  const custom = String(url || '').trim();
  return custom ? [custom] : DEFAULT_UPDATE_MANIFESTS.slice();
}

/** 把清单文本解析成更新描述。字段不全、不是 https、或没有合法 sha256 都抛错。 */
export function parseUpdateManifest(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('版本信息格式不正确，请稍后再试');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('版本信息格式不正确，请稍后再试');
  }
  const versionCode = Number(payload.versionCode);
  const versionName = String(payload.versionName || '').trim();
  const apkUrl = String(payload.apkUrl || '').trim();
  const sha256 = String(payload.sha256 || '').trim().toLowerCase();
  const resourceManifestUrl = String(payload.resourceManifestUrl || '').trim();
  if (!Number.isInteger(versionCode) || versionCode <= 0 || !versionName) {
    throw new Error('版本信息不完整或地址不是 https');
  }
  if (!apkUrl.startsWith('https://')) throw new Error('版本信息不完整或地址不是 https');
  if (resourceManifestUrl && !resourceManifestUrl.startsWith('https://')) {
    throw new Error('版本信息不完整或地址不是 https');
  }
  if (!SHA256_RE.test(sha256)) throw new Error('版本信息缺少安装包校验值');
  return {
    versionName,
    versionCode,
    apkUrl,
    sizeBytes: Number(payload.sizeBytes) || 0,
    sha256,
    notes: String(payload.notes || ''),
    publishedAt: String(payload.publishedAt || ''),
    resourceManifestUrl
  };
}

/**
 * 拉取版本清单。
 * 未指定地址时按 DEFAULT_UPDATE_MANIFESTS 依次尝试：超时、HTTP 错误、
 * 无法解析或清单不合法都换下一个。用户指定的地址失败则直接报错，不偷偷改源。
 * options.fetchText 仅供测试注入；正式路径走 fetchUpdateText。
 */
export async function fetchUpdateManifest(url, options = {}) {
  const fetchText = options.fetchText || fetchUpdateText;
  const endpoints = manifestEndpoints(url);
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      if (!endpoint.startsWith('https://')) throw new Error('更新地址必须是 https');
      const text = await fetchText(endpoint);
      return parseUpdateManifest(text);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('检查更新失败，请稍后再试');
    }
  }
  if (endpoints.length > 1) {
    const detail = lastError?.message || '检查更新失败';
    throw new Error(`更新源都不可用，请稍后再试（${detail}）`);
  }
  throw lastError || new Error('检查更新失败，请稍后再试');
}

/**
 * 读取版本清单的文本内容。
 *
 * ⚠️ 原生平台必须走 AppUpdater.fetchText，不能直接用 fetch：
 * App 内页面的 origin 是 https://localhost，请求外部域名属于跨域；
 * 服务器没返回 CORS 头时浏览器会直接拦下，JS 侧只能收到一个
 * 没有任何信息量的 "Failed to fetch"（2026-10-09 用户实际撞到这个问题）。
 * 原生 HTTP 请求不受同源策略约束。
 *
 * 网页预览（非原生）仍用 fetch，方便本地调试。
 */
async function fetchUpdateText(endpoint) {
  if (isUpdateSupported()) {
    try {
      const result = await AppUpdater.fetchText({ url: endpoint });
      const text = String(result?.text || '');
      if (!text) throw new Error('更新服务器没有返回内容');
      return text;
    } catch (error) {
      const message = String(error?.message || '');
      // 把底层网络错误翻译成用户看得懂的话
      if (/Unable to resolve host|Connection refused|timed out|timeout|UnknownHost|ECONN/i.test(message)) {
        throw new Error('连不上更新服务器，请检查网络后重试');
      }
      throw error;
    }
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS) : null;
  try {
    const response = await fetch(endpoint, { cache: 'no-store', signal: controller?.signal });
    if (!response.ok) throw new Error(`读取版本信息失败（${response.status}）`);
    return await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('读取版本信息超时，请检查网络');
    if (/failed to fetch/i.test(String(error?.message || ''))) {
      throw new Error('连不上更新服务器，请检查网络后重试');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 判断清单里的版本是否比当前新。用 versionCode 比，避免 1.0.10 与 1.0.9 这类字符串陷阱。 */
export function hasNewerVersion(manifest, currentVersionCode) {
  const remote = Number(manifest?.versionCode) || 0;
  const current = Number(currentVersionCode) || 0;
  return remote > current;
}

/**
 * 检查更新该给用户什么。
 *
 * - `apk`：清单 versionCode 高于装机包。网页就算已经热更到同一个号，
 *   也要提示安装完整包。热更新换不了原生代码（例如桌面倒数日）。
 * - `hot`：装机包并不落后，只是网页资源还没跟上，且清单声明了热更新。
 *   纯网页检查保持原来的热更新，不改口去要求安装包。
 * - `current`：装机包已经不低于清单，按已是最新处理。
 */
export function describeUpdateOffer(manifest, versions = {}) {
  const installed = Number(versions.installedVersionCode) || 0;
  const applied = Number(versions.appliedVersionCode) || 0;
  const web = Math.max(installed, applied);
  // 清单高于装机 versionCode 就要装完整包。网页已经热更到同一个号也不能报已是最新。
  if (hasNewerVersion(manifest, installed)) return 'apk';
  // 装机并不落后时，纯网页检查仍走热更新（只下变化文件），不改口要求安装包。
  if (hasNewerVersion(manifest, web) && String(manifest?.resourceManifestUrl || '').trim()) return 'hot';
  return 'current';
}

/** 校验值缺失、算不出来或与清单不一致都拒绝安装。不允许跳过。 */
export function assertApkSha256(expected, actual) {
  const exp = String(expected || '').trim().toLowerCase();
  const got = String(actual || '').trim().toLowerCase();
  if (!SHA256_RE.test(exp) || exp !== got) {
    throw new Error('安装包校验不通过，已丢弃，请重新下载');
  }
}

async function purgeStaleUpdateApks(keep) {
  try {
    await AppUpdater.purgeUpdateApks({ keep: String(keep || '') });
  } catch { /* 旧插件没有清理方法时，至少文件名已经按版本分开 */ }
}

async function inspectCachedApk(fileName) {
  try {
    const result = await AppUpdater.inspectCachedApk({ fileName });
    return result && typeof result === 'object' ? result : { exists: false };
  } catch {
    return { exists: false };
  }
}

async function deleteCachedApk(fileName) {
  try { await AppUpdater.clearDownload({ fileName }); } catch { /* 删不掉时下载会先删再写 */ }
}

/** 下载一次并核对。对不上返回 mismatch，网络错误照常抛出。 */
async function downloadAndCheckApk(manifest, fileName) {
  const apkUrl = String(manifest?.apkUrl || '').trim();
  const result = await AppUpdater.download({ url: apkUrl, fileName });
  const path = String(result?.path || '');
  const size = Number(result?.size) || 0;
  if (!path) throw new Error('下载完成但没有拿到安装包位置');
  const inspected = await inspectCachedApk(fileName);
  const cached = {
    exists: true,
    path,
    size: Number(inspected?.size) || size,
    sha256: String(inspected?.sha256 || ''),
    versionCode: Number(inspected?.versionCode) || 0,
    versionName: String(inspected?.versionName || '')
  };
  if (!cached.sha256) {
    try { cached.sha256 = await sha256OfFile(path); } catch { cached.sha256 = ''; }
  }
  try {
    assertApkSha256(manifest?.sha256, cached.sha256);
  } catch (error) {
    await deleteCachedApk(fileName);
    return { mismatch: error };
  }
  if (!apkCacheMatches(manifest, cached, 'download')) {
    await deleteCachedApk(fileName);
    return { mismatch: new Error('安装包是旧版本，已丢弃，请重新下载') };
  }
  return { path, size: cached.size };
}

/** 下载更新包，onProgress 会收到 0~1 的比例（总量未知时为 null）。 */
export async function downloadUpdate(manifest, onProgress) {
  const sha256 = String(manifest?.sha256 || '').trim().toLowerCase();
  const apkUrl = String(manifest?.apkUrl || '').trim();
  if (!SHA256_RE.test(sha256)) throw new Error('版本信息缺少安装包校验值');
  if (!apkUrl.startsWith('https://')) throw new Error('更新地址必须是 https');
  const fileName = updateApkFileName(manifest?.versionCode);
  if (!fileName) throw new Error('版本信息不完整或地址不是 https');
  if (!isUpdateSupported()) throw new Error('仅 Android 版支持应用内更新');

  // 固定文件名的旧包（1.1.30）和其他 versionCode 的缓存都清掉，只可能留下这一版。
  await purgeStaleUpdateApks(fileName);
  const cached = await inspectCachedApk(fileName);
  if (cached?.exists && apkCacheMatches(manifest, cached, 'reuse')) {
    return { path: String(cached.path || ''), size: Number(cached.size) || 0 };
  }
  if (cached?.exists) await deleteCachedApk(fileName);

  let listener = null;
  if (typeof onProgress === 'function') {
    listener = await AppUpdater.addListener('downloadProgress', payload => {
      const received = Number(payload?.received) || 0;
      const total = Number(payload?.total) || 0;
      onProgress(total > 0 ? Math.min(1, received / total) : null, received, total);
    });
  }
  try {
    let saved = await downloadAndCheckApk(manifest, fileName);
    if (saved?.mismatch) {
      // 清单对不上（常见于复用了上一版的字节）就删掉再下一遍。
      saved = await downloadAndCheckApk(manifest, fileName);
    }
    if (saved?.mismatch) {
      await deleteCachedApk(fileName);
      throw saved.mismatch;
    }
    if (!saved?.path) throw new Error('下载完成但没有拿到安装包位置');
    return { path: saved.path, size: Number(saved.size) || 0 };
  } finally {
    listener?.remove?.();
  }
}

/** 核对下载文件的 sha256（原生侧读文件再算，避免把 160MB 读进 JS 内存）。 */
async function sha256OfFile(path) {
  const result = await AppUpdater.sha256({ path });
  return String(result?.sha256 || '').toLowerCase();
}

export async function canInstall() {
  if (!isUpdateSupported()) return { allowed: false, supported: false };
  try {
    const result = await AppUpdater.canInstall();
    return { allowed: Boolean(result?.allowed), supported: true };
  } catch {
    return { allowed: false, supported: false };
  }
}

export async function openInstallSettings() {
  await AppUpdater.openInstallSettings();
}

export async function installUpdate(path) {
  await AppUpdater.install({ path });
}

export async function clearDownload(fileName = '') {
  const name = String(fileName || '').trim();
  try {
    await AppUpdater.clearDownload({ fileName: name || LEGACY_UPDATE_APK_NAME });
    await AppUpdater.purgeUpdateApks({ keep: '' });
  } catch { /* 清理失败无需打扰用户 */ }
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (!value) return '';
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
