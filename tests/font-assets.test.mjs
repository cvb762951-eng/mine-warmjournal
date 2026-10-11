import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../fonts.css', import.meta.url), 'utf8');
// 中文兜底字体（Noto SC，约 8MB）单独成文件，首屏渲染后才由 app.js 挂载 —— 理由见该文件顶部注释
const fallbackCss = await readFile(new URL('../fonts-fallback.css', import.meta.url), 'utf8');
const lxgwCss = await readFile(new URL('../fonts/lxgw-wenkai-screen/lxgwwenkaigbscreenr.css', import.meta.url), 'utf8');

test('all font declarations are local and available to Web and Android builds', async () => {
  assert.doesNotMatch(css, /https?:\/\//);
  const urls = [...`${css}\n${fallbackCss}`.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map(match => match[1]);
  assert.ok(urls.length >= 60);
  await Promise.all(urls.map(async url => access(new URL(`../${url}`, import.meta.url))));
  // 2026-10-09：为省流量改成 woff2（3 个 TTF 共 30.1MB → 12.2MB，字形不变）
  // 2026-10-10：这三份改由首屏之后挂载（见下方独立用例），故断言落在 fallback 文件上
  assert.match(fallbackCss, /assets\/fonts\/noto-sc-400\.woff2/);
  assert.match(fallbackCss, /assets\/fonts\/noto-sc-500\.woff2/);
  assert.match(fallbackCss, /assets\/fonts\/noto-sc-600\.woff2/);
  assert.match(css, /font-family:\s*'Material Symbols Outlined'/);
});

test('LXGW WenKai activity font is fully local and licensed', async () => {
  assert.match(css, /fonts\/lxgw-wenkai-screen\/lxgwwenkaigbscreenr\.css/);
  assert.match(lxgwCss, /font-family:\s*'LXGW WenKai Screen R'/);
  assert.doesNotMatch(lxgwCss, /https?:\/\//);
  const urls = [...lxgwCss.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map(match => match[1]);
  assert.ok(urls.length >= 90);
  await Promise.all(urls.map(url => access(new URL(`../fonts/lxgw-wenkai-screen/${url}`, import.meta.url))));
  await access(new URL('../fonts/lxgw-wenkai-screen/OFL.txt', import.meta.url));
});

test('Chinese glyph aliases unify Inter, Newsreader and Caveat on the local LXGW font', async () => {
  for (const file of ['inter-cjk.css', 'newsreader-cjk.css', 'caveat-cjk.css']) {
    const alias = await readFile(new URL(`../fonts/lxgw-wenkai-screen/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(alias, /https?:\/\//);
    assert.match(alias, /src: url\('\.\/files\/lxgwwenkaigbscreenr-subset-/);
  }
  assert.match(css, /inter-cjk\.css/);
  assert.match(css, /newsreader-cjk\.css/);
  assert.match(css, /caveat-cjk\.css/);
});

test('Zhi Mang Xing handwriting font is local, licensed and bundled for photo annotations', async () => {
  assert.match(css, /font-family:\s*'Zhi Mang Xing'/);
  // 2026-10-09：为省流量改成 woff2（原 TTF 3.9MB → 2.2MB），字形不变
  assert.match(css, /fonts\/zhi-mang-xing\/ZhiMangXing-Regular\.woff2/);
  const font = new URL('../fonts/zhi-mang-xing/ZhiMangXing-Regular.woff2', import.meta.url);
  const license = new URL('../fonts/zhi-mang-xing/OFL.txt', import.meta.url);
  await access(font);
  await access(license);
  const licenseText = await readFile(license, 'utf8');
  assert.match(licenseText, /SIL OPEN FONT LICENSE Version 1\.1/);
});

/* 启动性能（2026-10-10）：用户报「每次打开 App 都要卡一会」。
   实测把这几份 4MB 的中文兜底字体挪出首屏，能把第一帧绘制提前约 176ms。
   这几条断言就是为了防止哪天又被顺手加回 index.html。 */
test('中文兜底字体不参与首屏，由 app.js 在首帧之后挂载', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  // 一进 index.html 的样式表清单就会在首屏抢主线程 —— 绝对不行
  assert.ok(!index.includes('fonts-fallback.css'), '兜底字体不得写进 index.html');
  // 必须由 app.js 负责挂载，且要跨过首帧
  assert.match(app, /fonts-fallback\.css/, 'app.js 必须负责挂载兜底字体');
  assert.match(app, /function loadFallbackFonts/, '应有独立的挂载函数');
  assert.match(app, /requestAnimationFrame\(\(\) => requestAnimationFrame/, '必须跨过首帧再挂载');
  // 挂载过的标记要能防重复插入
  assert.match(app, /data-fallback-fonts/, '重复挂载要有标记挡住');
  // 构建白名单：漏登记就不会进包，线上直接 404
  const buildScript = await readFile(new URL('../scripts/build-web.mjs', import.meta.url), 'utf8');
  assert.match(buildScript, /'fonts-fallback\.css'/, 'fonts-fallback.css 必须登记进构建白名单');
});

