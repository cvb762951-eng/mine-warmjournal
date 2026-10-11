import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { build, transform } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'www');
const assets = [
  // themes.css 必须排在 styles.css 之后复制/加载：主题覆盖依赖「后加载 + 抬高权重」
  // themes-plain.css 排在 themes.css 之后：清简主题的质感重置要能压住主题块。
  // 文件里已由 gen-plain-theme.mjs 把 themes-plain-light.css 拼在末尾，index.html 只引这一个。
  // themes-plain-light.css 仍然照常打包：老版本的热更新 index.html 可能还在引用它，
  // 留着它当兜底，避免那种情况下 404（40KB，比起"半截主题"便宜得多）。
  'index.html', 'styles.css', 'themes.css', 'themes-plain.css', 'themes-plain-light.css', 'performance.css', 'fonts.css',
  // 中文兜底字体（约 8MB）单独一个文件：index.html 不引它，由 app.js 首屏后挂载
  'fonts-fallback.css',
  'manifest.json', 'service-worker.js', 'icon-192.png', 'icon-512.png'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

/* CSS 也压缩（2026-10-10）：启动时手机要先解析这几百 KB 样式，
   解析与样式计算都算在「打开先卡一下」里。压掉空白和冗余写法不改变任何视觉效果，
   但能实打实减少解析量。注意：这里只做 transform（不 bundle），
   所以 @import 与 url(...) 原样保留，相对路径不受影响。 */
const CSS_FILES = ['styles.css', 'themes.css', 'themes-plain.css', 'themes-plain-light.css', 'performance.css', 'fonts.css', 'fonts-fallback.css'];
await Promise.all(assets.filter(file => !CSS_FILES.includes(file)).map(file => cp(resolve(root, file), resolve(output, file))));
for (const file of CSS_FILES) {
  const source = await readFile(resolve(root, file), 'utf8');
  const minified = await transform(source, { loader: 'css', minify: true });
  await writeFile(resolve(output, file), minified.code, 'utf8');
}
await cp(resolve(root, 'assets'), resolve(output, 'assets'), { recursive: true });
await cp(resolve(root, 'fonts'), resolve(output, 'fonts'), { recursive: true });
/* 字体声明表也压一遍：4 份 × 97 条 @font-face（共约 420KB）全是 unicode-range + src，
   首屏必须把它们解析完才能继续加载脚本。压掉空白与冗余写法不改变任何行为。 */
for (const file of ['lxgwwenkaigbscreenr.css', 'inter-cjk.css', 'newsreader-cjk.css', 'caveat-cjk.css']) {
  const target = resolve(output, 'fonts/lxgw-wenkai-screen', file);
  const source = await readFile(target, 'utf8');
  const minified = await transform(source, { loader: 'css', minify: true });
  await writeFile(target, minified.code, 'utf8');
}
/* 产物体积直接影响启动速度：手机 WebView 要解析这几 MB 文本，
   解析时间就是「打开 App 先卡一下」的一部分（2026-10-10 实测）。
   源码里没有任何 eval / new Function（已核对），压缩标识符是安全的；
   sourcemap 照常产出，排查问题时仍能对回源码。 */
await build({ entryPoints: [resolve(root, 'app.js')], outfile: resolve(output, 'app.js'), bundle: true, format: 'iife', target: 'es2022', minify: true, sourcemap: true });

/* 生成「装机自带」的资源指纹 resource-manifest.json（2026-10-09）
 *
 * 这是热更新能真正「只下变化文件」的前提：App 拿它作为比对基线。
 * 没有它的话，首次热更新会因为「本地没有任何记录」而把所有文件都当成变化项，
 * 等于把 54MB 资源全下一遍 —— 与整包更新无异。
 *
 * 排除 source map（不参与运行）与这份清单自身（否则自引用会一直变）。 */
const skip = new Set(['app.js.map', 'resource-manifest.json']);
async function fingerprint(dir, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { await fingerprint(full, base, out); continue; }
    const rel = relative(base, full).split(sep).join('/');
    if (skip.has(rel) || rel.endsWith('.map')) continue;
    const info = await stat(full);
    const sha256 = await new Promise((ok, fail) => {
      const hash = createHash('sha256');
      createReadStream(full).on('data', c => hash.update(c)).on('end', () => ok(hash.digest('hex'))).on('error', fail);
    });
    out.push({ path: rel, size: info.size, sha256 });
  }
  return out;
}
const files = (await fingerprint(output)).sort((a, b) => a.path.localeCompare(b.path));
await writeFile(resolve(output, 'resource-manifest.json'), `${JSON.stringify({ files }, null, 2)}\n`, 'utf8');
console.log(`Built ${assets.length + 1} web assets into ${output}（资源指纹 ${files.length} 个文件）`);
