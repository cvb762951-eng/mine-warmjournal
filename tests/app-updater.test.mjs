import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { hasNewerVersion, APP_VERSION_NAME, APP_VERSION_CODE, DEFAULT_UPDATE_MANIFEST, isUpdateSupported } from '../app-updater.js';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const updater = await read('app-updater.js');
const plugin = await read('android/app/src/main/java/com/mine/focus/AppUpdaterPlugin.java');
const hotClient = await read('android/app/src/main/java/com/mine/focus/HotAssetWebViewClient.java');
const activity = await read('android/app/src/main/java/com/mine/focus/MainActivity.java');
const manifest = await read('android/app/src/main/AndroidManifest.xml');
const mine = await read('views/mine.js');
const gradle = await read('android/app/build.gradle');
const script = await read('scripts/make-update-manifest.mjs');
const buildScript = await read('scripts/build-web.mjs');
const resourceScript = await read('scripts/make-resource-manifest.mjs');

/**
 * 应用内更新（2026-10-09）
 *
 * 设计底线（都锁在下面）：
 * 1. 只在用户点击时联网 —— 不做启动自动检查；
 * 2. 只接受 https；
 * 3. 下载落到应用缓存目录，安装必须过 Android 系统安装器的确认页（无法静默安装）；
 * 4. 原生插件必须在 MainActivity 注册（项目曾因漏注册出过 P0）。
 */

test('版本比较用 versionCode，不踩字符串比较的坑', () => {
  assert.equal(hasNewerVersion({ versionCode: 66 }, 65), true);
  assert.equal(hasNewerVersion({ versionCode: 65 }, 65), false);
  assert.equal(hasNewerVersion({ versionCode: 64 }, 65), false);
  // 字符串比较会把 "1.0.10" 判成比 "1.0.9" 小 —— 用 versionCode 就没有这个问题
  assert.equal(hasNewerVersion({ versionCode: 10 }, 9), true);
  assert.equal(hasNewerVersion({ versionCode: 110 }, 109), true);
  assert.equal(hasNewerVersion({}, 0), false);
});

test('前端版本常量与 build.gradle 严格同步', () => {
  const gradleName = gradle.match(/versionName\s+"([^"]+)"/)?.[1] || '';
  const gradleCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1] || 0);
  assert.equal(APP_VERSION_NAME, gradleName, 'APP_VERSION_NAME 必须与 build.gradle 的 versionName 一致');
  assert.equal(APP_VERSION_CODE, gradleCode, 'APP_VERSION_CODE 必须与 build.gradle 的 versionCode 一致');
  // 真正判断更新时以系统记录为准（currentVersion），常量只用于渲染
  assert.match(updater, /export async function currentVersion\(\)/);
  assert.match(updater, /AppUpdater\.getVersion\(\)/);
});

test('只接受 https，且不提供任何自动检查入口', () => {
  assert.match(updater, /if \(!endpoint\.startsWith\('https:\/\/'\)\) throw new Error\('更新地址必须是 https'\)/);
  assert.match(DEFAULT_UPDATE_MANIFEST, /^https:\/\//);
  // 原生侧二次校验
  assert.match(plugin, /!url\.startsWith\("https:\/\/"\)/);
  // 没有定时器 / 生命周期钩子去自动拉清单
  assert.doesNotMatch(updater, /setInterval|setTimeout\([^)]*fetchUpdateManifest/);
  assert.match(mine, /\$\('#settings-update'\)\?\.addEventListener\('click'/, '只能由点击触发');
  assert.match(mine, /只在你点击时才联网/, '界面上要如实说明这一点');
});

test('下载与安装的边界：缓存目录 + 系统安装器 + 完整性校验', () => {
  // 下载落到应用缓存目录（file_paths.xml 的 cache-path 已覆盖）
  assert.match(plugin, /new File\(getContext\(\)\.getCacheDir\(\), targetName\)/);
  // 安装走 FileProvider + ACTION_VIEW，交系统安装器
  assert.match(plugin, /FileProvider\.getUriForFile/);
  assert.match(plugin, /Intent\.ACTION_VIEW/);
  assert.match(plugin, /application\/vnd\.android\.package-archive/);
  assert.match(plugin, /FLAG_GRANT_READ_URI_PERMISSION/);
  // Android 8+ 需要用户授权「安装未知应用」，要能检查并引导
  assert.match(plugin, /canRequestPackageInstalls\(\)/);
  assert.match(plugin, /ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(plugin, /public void canInstall\(PluginCall call\)/);
  assert.match(plugin, /public void openInstallSettings\(PluginCall call\)/);
  // 清单给了 sha256 就要核对，不一致直接丢弃
  assert.match(updater, /if \(manifest\.sha256\)/);
  assert.match(updater, /安装包校验不通过，已丢弃/);
  assert.match(plugin, /public void sha256\(PluginCall call\)/);
});

test('原生插件已在 MainActivity 注册（漏注册会静默失败）', () => {
  assert.match(activity, /registerPlugin\(AppUpdaterPlugin\.class\)/,
    '插件必须在 MainActivity 注册，否则 JS 调用时会找不到插件');
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/,
    '需要声明安装包权限，否则系统安装器会被拦下');
});

test('发布脚本从 build.gradle 现读版本，不接受手填', () => {
  assert.match(script, /const gradle = await readFile\(join\(root, 'android\/app\/build\.gradle'\), 'utf8'\)/);
  assert.match(script, /versionCode\\s\+\(\\d\+\)/);
  assert.match(script, /versionName\\s\+"\(\[\^"\]\+\)"/);
  // 流式计算 sha256（安装包上百 MB，不能整个读进内存）
  assert.match(script, /createReadStream\(apkPath\)/);
  assert.doesNotMatch(script, /readFile\(apkPath\)/);
  // 只接受 https 的发布地址
  assert.match(script, /--base-url 必须是 https 地址/);
});

test('发布脚本会拦住「内容变了却没升版本」', () => {
  // 这条例外的检查是拿一次真实失误换来的（2026-10-09）：
  // 给同一个版本号加了新功能却没升版本，导致两个内容不同的包共用一个号，
  // 装了旧包的人点「检查更新」会永远显示「已是最新」，界面上完全看不出来。
  assert.match(script, /版本号没有递增，但安装包内容已经变了/);
  assert.match(script, /Number\(previous\.versionCode\) >= versionCode && previous\.sha256 !== sha256/,
    '判据：版本号没涨、但安装包内容变了');
  assert.match(script, /\.published\.json/, '需要一份已发布版本记录作为比对基准');
  assert.match(script, /process\.exit\(1\)/, '命中时必须中断发布');
});

test('版本清单必须走原生请求（直接 fetch 会被跨域拦下）', () => {
  // 2026-10-09 用户实测：点「检查更新」报 "failed to fetch"。
  // 根因是 App 内页面 origin 为 https://localhost，请求外部域名属于跨域，
  // 而发布站点没有返回 CORS 头 → 浏览器直接拦下，JS 只拿到一句无信息量的报错。
  // 原生 HTTP 不受同源策略约束，所以清单改由原生读取。
  assert.match(updater, /async function fetchUpdateText\(endpoint\)/);
  assert.match(updater, /AppUpdater\.fetchText\(\{ url: endpoint \}\)/);
  assert.match(plugin, /public void fetchText\(PluginCall call\)/, '原生侧要有对应方法');
  assert.match(plugin, /Accept", "application\/json/, '原生请求要声明接受 JSON');

  // 原生分支必须排在网页分支之前，否则原生平台仍会先撞上 fetch
  const nativeAt = updater.indexOf('AppUpdater.fetchText');
  const fetchAt = updater.indexOf('await fetch(endpoint');
  assert.ok(nativeAt > -1, '应有原生分支');
  assert.ok(fetchAt > -1, '网页预览仍保留 fetch');
  assert.ok(nativeAt < fetchAt, '原生分支必须在 fetch 之前');

  // 无信息量的底层报错要翻译成用户看得懂的话
  assert.match(updater, /连不上更新服务器/);
  assert.match(updater, /failed to fetch/i, '要识别这个原始报错');
  // 响应体积上限：清单只有几百字节，不该被投喂超大响应
  assert.match(plugin, /MAX_TEXT_BYTES/);
});

test('资源热更新：只下载变化的文件，且有完整兜底', () => {
  // 用户诉求原话：「每次更新都只更新新的部分，而不是把整个资源重新安装一遍」。
  // 做法：清单比对 → 只把 sha256 变了的文件交给原生下载。
  assert.match(updater, /export async function fetchResourceManifest/);
  assert.match(updater, /export async function applyResourceUpdate/);
  assert.match(updater, /const changed = files\.filter\(file => applied\[file\.path\] !== file\.sha256\)/,
    '必须按 sha256 比对出变化的文件');
  assert.match(updater, /const removed = Object\.keys\(applied\)\.filter/,
    '被删除的文件也要识别出来（否则清单会残留）');

  // 原生侧承担下载（不受跨域限制，且能写私有目录）
  assert.match(plugin, /public void syncResources\(PluginCall call\)/);
  assert.match(plugin, /String url = entry\.optString\("url", ""\)/);
  assert.match(plugin, /!url\.startsWith\("https:\/\/"\)/, '资源地址必须 https');
  assert.match(plugin, /path\.contains\("\.\."\) \|\| path\.startsWith\("\/"\)/, '必须挡掉越权路径');
  assert.match(plugin, /getCanonicalPath\(\)\.startsWith\(hotRoot\.getCanonicalPath\(\)/,
    '写入前要用规范路径二次确认');

  // 单个文件校验不过就丢弃，绝不覆盖旧版本
  assert.match(plugin, /!item\[2\]\.equalsIgnoreCase\(sha256Of\(temp\)\)/);
  assert.match(plugin, /校验不通过/);

  // 有失败就不写清单 —— 保持旧清单，下次继续补齐
  assert.match(updater, /if \(!failed\) \{[\s\S]{0,200}writeAppliedResources\(next\)/,
    '只有全部成功才更新本地清单');

  // 读不到资源清单时静默回退完整安装包，不让用户卡住
  assert.match(mine, /if \(manifest\.resourceManifestUrl\)/);
  assert.match(mine, /改为下载完整安装包/);
});

test('热更新资源优先加载，失败自动回退内置资源（不白屏）', () => {
  assert.match(hotClient, /class HotAssetWebViewClient extends BridgeWebViewClient/);
  assert.match(hotClient, /public WebResourceResponse shouldInterceptRequest\(WebView view, WebResourceRequest request\)/);
  assert.match(hotClient, /return super\.shouldInterceptRequest\(view, request\)/, '没命中就走内置资源');
  // 任何异常都必须退回 null（= 用内置资源），这是不白屏的最后一道保险
  assert.match(hotClient, /catch \(Exception ignored\) \{[\s\S]{0,120}return null;/);
  assert.match(hotClient, /!"localhost"\.equals\(url\.getHost\(\)\)/, '只接管 App 自己的资源域');
  assert.match(hotClient, /path\.contains\("\.\."\)/, '拒绝越权路径');
  // 必须挂到 Activity 上，否则拦截器不生效
  assert.match(activity, /bridge\.setWebViewClient\(new HotAssetWebViewClient/);
  assert.match(activity, /installHotAssetClient\(\)/, '要在启动时安装');
  assert.doesNotMatch(hotClient, /throw new/, '加载路径里不应向外抛异常');
});

test('热更新后不再重复提示有新版（资源版本要单独记录）', () => {
  // 热更新只替换网页资源，装机包的 versionCode 不会变。
  // 如果只拿装机版本去比较，用户热更新完成后仍会一直看到「有新版本」。
  assert.match(updater, /const HOT_VERSION_PATH = 'hot\/version\.json'/);
  assert.match(updater, /export async function appliedResourceVersionCode/);
  assert.match(updater, /await writeAppliedVersion\(resourceManifest\.versionCode/,
    '应用成功后要记下资源版本');
  // 2026-10-12 起：比较与显示统一走 effectiveVersion()，不再在界面里自己 Math.max
  // （否则设置页那行按资源算、检查结果按装机算，会出现两个「当前版本」）。
  assert.match(mine, /const current = await effectiveVersion\(\)/);
  assert.match(mine, /hasNewerVersion\(manifest, Number\(current\.versionCode\) \|\| 0\)/);
});

test('「当前版本」只能有一个答案，更新体积要按本次实际下载量报', () => {
  // 2026-10-12 用户反馈的两件事：
  //  ① 点「检查更新」提示已是最新，但它报的版本号和页面上显示的版本号不一致；
  //  ② 每次更新显示的体积都是同一个写死的值，不是这次真正要下多少。
  //
  // ① 根因：热更新只换网页资源、装机 versionCode 不变。设置页那行用常量（=资源版本），
  //    检查结果用装机版本 ⇒ 同一个屏幕上两个答案。
  assert.match(updater, /export async function effectiveVersion/);
  assert.match(updater, /if \(appliedCode > \(Number\(installed\.versionCode\) \|\| 0\)\)/,
    '装机版本与已应用资源版本要取较新者');
  assert.match(mine, /id="update-current-version"/, '那行要能异步纠正');
  assert.match(mine, /async function refreshCurrentVersionLabel\(\)/);
  assert.match(mine, /label\.textContent = `当前 \$\{version\.versionName\} · 只在你点击时才联网`/,
    '显示的是实际生效版本，不是渲染常量');

  // ② 根因：体积取自版本清单的 sizeBytes（整包体积，每版都是 83.5MB 上下，看着就像写死的）。
  //    修法：热更新时按「远程资源清单 vs 本地已应用清单」现算变化文件之和。
  assert.match(updater, /export async function pendingResourceUpdate/);
  assert.match(updater, /applied\[file\.path\] !== file\.sha256/, '按 sha256 比对出变化文件');
  assert.match(updater, /changed\.reduce\(\(sum, file\) => sum \+ \(Number\(file\.size\) \|\| 0\), 0\)/,
    '把变化文件的体积加起来');
  assert.match(mine, /async function pendingUpdateSize\(manifest\)/);
  assert.match(mine, /const pending = await pendingUpdateSize\(manifest\)/);
  assert.match(mine, /const size = hot \? \(pending \? sizeText : ''\) : sizeText/,
    '热更新算不出体积时不报数字，绝不用整包体积顶替');
  assert.match(mine, /formatBytes\(pending\.bytes\)/, '报的是现算出来的体积');
  assert.match(mine, /if \(!manifest\?\.resourceManifestUrl\) return null;[\s\S]{0,400}catch \{\s*return null;/,
    '算不出来就返回 null，不要编一个数字');
});

test('热更新必须真正生效：入口页、缓存、免重启三处都不能漏', () => {
  // 2026-10-09 用户反馈「更新模块还是有点问题」。逐条排查出三个会让人以为
  // 「更新了却没变化」的缺陷，全部修掉：

  // ① 根路径要映射到 index.html。原先用 path.length() <= 1 直接放行，
  //    导致入口页永远不参与热更新 —— 而它里面写着 app.js?v=版本号。
  assert.match(hotClient, /if \(relative\.isEmpty\(\)\) relative = "index.html"/);
  assert.doesNotMatch(hotClient, /path\.length\(\) <= 1/, '不能再用长度判断挡掉根路径');

  // ② 必须禁止缓存：热更新靠的就是「同一个 URL 拿到新内容」，
  //    被 WebView 缓存住的话重启多少次都还是旧界面。
  assert.match(hotClient, /headers\.put\("Cache-Control", "no-store, no-cache, must-revalidate"\)/);
  assert.match(hotClient, /new WebResourceResponse\(mimeOf\(relative\), null, 200, "OK", headers, stream\)/);

  // ③ 更新完成后自动刷新，不该让用户手动杀进程重启。
  assert.match(mine, /setTimeout\(\(\) => window\.location\.reload\(\), 800\)/);
  assert.match(mine, /正在刷新/);
});

test('首次热更新必须只下变化文件：以装机自带指纹为基线', () => {
  // 没有基线的话，本地没有任何记录 → 所有文件都被当成变化项 →
  // 把整份资源下一遍，与整包更新无异，「只下变化部分」形同虚设。
  assert.match(updater, /const BUILTIN_MANIFEST_URL = 'resource-manifest\.json'/);
  assert.match(updater, /const response = await fetch\(BUILTIN_MANIFEST_URL/);
  assert.match(updater, /return Object\.fromEntries\(payload\.files\.map\(file => \[file\.path, file\.sha256\]\)\)/);
  // 这份指纹由构建脚本产出，且不能包含自身（自引用会一直变）
  assert.match(buildScript, /resource-manifest\.json/, '构建时要生成装机指纹');
  assert.match(buildScript, /skip = new Set\(\['app\.js\.map', 'resource-manifest\.json'\]\)/);
  // 它也不能被热更新覆盖，否则基线失真
  assert.match(resourceScript, /EXCLUDED = new Set\(\['app\.js\.map', 'service-worker\.js', 'resource-manifest\.json'/,
    '发布清单要排除装机指纹');
});

test('发布清单的时间写到北京时间的时分，不再只留 UTC 日期', () => {
  assert.match(script, /function shanghaiPublishedAt/);
  assert.match(script, /\+08:00/);
  assert.doesNotMatch(script, /toISOString\(\)\.slice\(0,\s*10\)/);
  assert.match(mine, /formatShanghaiDateTime\(parsed\)/);
  assert.match(mine, /publishedAt/);
});

test('界面开关：仅 Android 原生支持，网页预览给出明确提示', () => {
  assert.equal(typeof isUpdateSupported(), 'boolean');
  assert.match(updater, /return Capacitor\.isNativePlatform\(\) && Capacitor\.getPlatform\(\) === 'android'/);
  assert.match(mine, /网页预览不支持应用内更新/);
});
