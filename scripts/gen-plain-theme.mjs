#!/usr/bin/env node
/**
 * 生成「清简」主题的质感重置样式 themes-plain.css
 *
 * 用法：node scripts/gen-plain-theme.mjs [--report]
 *
 * 【为什么用生成而不是手写】
 * App 的"纸感"由 600+ 条规则里的图片素材（background / border-image / mask-image）撑起来。
 * 手写覆盖必然漏。这里扫描源 CSS，把「引用了素材」的规则自动转成 plain 主题下的覆盖。
 *
 * 【三件事】
 *   1. 撤掉图片：background-image / border-image / mask-image 置 none，颜色与渐变保留。
 *   2. 补回底色：原本"图 + 透明底"的元素撤图后会变成透明的空块，上面的浅色文字随之消失。
 *      给它们补一层纯色 —— 深色纸补深色实底，浅色纸补白。深浅由 scripts/lib/asset-luma.mjs
 *      **量像素**得出，不靠文件名猜。
 *   3. 中性化暖底：整个 App 有大量写死的"暖纸色"，撤掉纹理后这些底色会整片露出来
 *      （页面一片米黄），与"纯色极简"相悖 → 页面级换画布灰、卡片级换白。
 *
 * 【为什么要 !important】
 * 源 CSS 里有 61 条素材规则自带 !important，不带 !important 的覆盖压不住它们。
 * 而我们的选择器已经抬高了权重（:root[data-theme] 前缀），再加 !important 是安全的。
 *
 * 【只作用于 plain】
 * 所有选择器都带 :root[data-theme="plain"] 前缀，米白与暖阳两个主题完全不受影响。
 *
 * 【改了 styles.css / performance.css 之后要重跑本脚本】产出的 themes-plain.css 需一并提交。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { assetStats, DARK_PAPER_LUMA } from './lib/asset-luma.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const SOURCES = ['styles.css', 'performance.css'];
const OUT = join(root, 'themes-plain.css');
const REPORT = process.argv.includes('--report');
/** --trace=<selector 片段>：打印源 CSS 里命中的规则与判定依据，排查"为什么这条被改了"。 */
const TRACE = (process.argv.find(a => a.startsWith('--trace=')) || '').slice(8);

/** 品牌资产：不作为"质感装饰"清理。 */
const KEEP = new Set(['logo.png', 'launcher-foreground.png']);

/** 中性替换色（定义在 themes.css 的 plain 块里，这里给同名兜底值）。 */
const SURFACE = 'var(--plain-surface, #ffffff)';       // 纸面 / 卡片
const CANVAS = 'var(--plain-canvas, #f7f9fc)';         // 页面底（冷雾白）
const INK = 'var(--plain-ink-block, #55606c)';         // 深色强调块（石板灰蓝，不是黑）
const SAGE = 'var(--plain-sage-block, #4f76bd)';       // 原本"深到发黑"的墨绿块 → 主题蓝

/** 亮度低于这个值的底色，在浅色界面里视觉上已经等同于黑（用户明确不要）。
    这类底色即使是"有含义的深墨绿"，也要提亮一档。 */
const DEEP_TONE_LUMA = 0.14;

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* 按小节标题去重（2026-10-10）
 *
 * themes-plain-light.css 是手工维护的，靠「往文件末尾追加一节」扩展。
 * 但追加操作在某些环境里会重复执行一次，导致同一节被写进去两遍 —— 不报错，
 * 只是让产物悄悄变胖、并且两遍之间的改动容易对不上（真踩过三次）。
 * 与其每次靠人核对，不如在读取时就按小节标题去重：源头脏了，产物也干净。
 * 去重时保留**最后一次**出现的内容（追加的更新版本通常在后面）。
 */
function dedupeSections(css) {
  const lines = css.split('\n');
  const starts = [];
  lines.forEach((line, index) => {
    if (/^\/\* -{20,}\s*$/.test(line)) starts.push(index);
  });
  if (!starts.length) return css;
  const head = lines.slice(0, starts[0]);
  const chunks = starts.map((start, n) => ({
    title: (lines[start + 1] || '').trim(),
    body: lines.slice(start, n + 1 < starts.length ? starts[n + 1] : lines.length)
  }));
  const kept = new Map();                 // title → body（后写覆盖先写）
  const order = [];
  for (const chunk of chunks) {
    if (!kept.has(chunk.title)) order.push(chunk.title);
    kept.set(chunk.title, chunk.body);
  }
  if (kept.size !== chunks.length) {
    console.warn(`⚠️ themes-plain-light.css 有重复小节，已去重：${chunks.length} → ${kept.size}`);
  }
  return head.concat(...order.map(title => kept.get(title))).join('\n');
}

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
}

const luminance = ({ r, g, b }) => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** 从 background / background-color 声明里取出颜色字面量（解析后的对象）。 */
function declaredColor(body) {
  const raw = declaredColorRaw(body);
  if (!raw) return null;
  const hex = raw.match(/#([0-9a-fA-F]{3,8})\b/);
  if (hex) return hexToRgb(hex[1]);
  const rgb = raw.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const p = rgb[1].split(',').map(v => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}

/** 取出 background / background-color 声明里的写法原文（用于原样保留底色）。 */
function declaredColorRaw(body) {
  const m = body.match(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;}]+)/);
  if (!m) return null;
  const decl = m[1];
  const hex = decl.match(/#[0-9a-fA-F]{3,8}\b/);
  if (hex) return hex[0];
  const rgb = decl.match(/rgba?\([^)]+\)/);
  if (rgb) return rgb[0];
  if (/\b(transparent|none|inherit|currentcolor|var\()/.test(decl)) return null;
  return null;
}

/** 页面级容器：底色应该用画布灰，而不是卡片白，否则页面和卡片糊成一片。 */
const isPageLevel = selector => /#app\b|\.view\b|-view\b/.test(selector);

/** 伪元素是纯装饰（不承载文字），撤图后就该消失，不该补成一块纯色。 */
const isPseudo = selector => /::?(before|after|marker|placeholder)\b/.test(selector);

/** 图片被拉伸铺满整个元素（而不是只贴一角）—— 这类元素撤图后必须补底。
    三种情况都算"铺满"：
      1. 同一条规则里写了 100% 100%；
      2. 这条规则只改 background-image（尺寸在别处定），也就是没有自己指定
         位置 / 重复 / 尺寸，且没出现 contain / cover；
      3. border-image 带 fill 关键字 —— fill 的语义就是"把图片填满整个盒子"。 */
function fillsBox(body) {
  const borderDecl = body.match(/border-image(-source)?\s*:\s*([^;}]+)/)?.[2] || '';
  if (/(^|\s)fill(\s|$)/.test(borderDecl)) return true;
  if (/background-size\s*:\s*100%\s*100%/.test(body) || /\/\s*100%\s*100%/.test(body)) return true;
  if (/background-(size|position|repeat)\s*:/.test(body)) return false;
  if (/background\s*:\s*[^;}]*\//.test(body)) return false;
  if (/\b(contain|cover)\b/.test(body)) return false;
  return true;
}

/** 这条规则把背景明确重置成"什么都没有"（后面的收口规则常这么写）。
    一旦出现，前面那条规则加的中性底色就必须撤回 —— 否则会强行给一个
    "本来就该透明"的元素刷上深底，把上面的文字压没（账本预算那行就踩过）。 */
function backgroundReset(body) {
  if (/(^|[;{\s])background-image\s*:\s*(none|transparent|initial|unset)/.test(body)) return true;
  const shorthand = body.match(/(?:^|[;{\s])background\s*:\s*([^;}]+)/);
  if (shorthand && /(^|\s)(none|transparent|initial|unset)(\s|$)/.test(shorthand[1])) return true;
  const colorOnly = body.match(/(?:^|[;{\s])background-color\s*:\s*([^;}]+)/);
  if (colorOnly && /(^|\s)(transparent|initial|unset)(\s|$)/.test(colorOnly[1])) return true;
  return false;
}

/** 只在顶层按逗号切分选择器 —— :is(...) / :not(...) 里的逗号不能切，
    否则会把一个选择器拆成两半、生成出语法错误的 CSS。 */
function splitSelectors(text) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(s => s && !s.startsWith('@'));
}

function parseRules(css) {
  const out = [];
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = splitSelectors(match[1]);
    if (!selectors.length) continue;
    out.push({ selectors, body: match[2] });
  }
  return out;
}

const assetsOf = body => [...body.matchAll(/url\(['"]?assets\/([^'")]+)['"]?\)/g)].map(m => m[1]);

const bgImage = new Set();     // background-image: none
const borderImage = new Set(); // border-image: none
const mask = new Set();        // mask-image: none
const surface = new Set();     // 补白 / 浅色底
const pageCanvas = new Set();  // 补画布灰底
const inkBlock = new Set();    // 补深色底
const keepColor = new Map();   // 选择器 → 原本写死的底色（撤图后必须原样留住）

const decisions = [];          // 诊断用
let scanned = 0;
let hit = 0;

for (const file of SOURCES) {
  const css = readFileSync(join(root, file), 'utf8');
  for (const rule of parseRules(css)) {
    scanned += 1;
    const assets = assetsOf(rule.body).filter(name => !KEEP.has(name));
    if (!assets.length) {
      /* 没引用素材的规则也可能改变结论：它可能把背景重置成透明。 */
      if (backgroundReset(rule.body)) {
        for (const sel of rule.selectors) {
          const prefixed = `:root[data-theme="plain"] ${sel}`;
          surface.delete(prefixed);
          inkBlock.delete(prefixed);
          pageCanvas.delete(prefixed);
          keepColor.delete(prefixed);
        }
      }
      continue;
    }
    hit += 1;
    const body = rule.body;

    const hasBg = /(^|[;{\s])background(-image)?\s*:/.test(body) && /url\(/.test(body);
    const hasBorderImage = /border-image(-source)?\s*:/.test(body) && /url\(/.test(body);
    const hasMask = /(-webkit-)?mask-image\s*:/.test(body) && /url\(/.test(body);

    const color = declaredColor(body);
    const colorRaw = declaredColorRaw(body);
    const opaqueBg = colorRaw && (!color || color.a > 0.9);
    /* 「图 + 透明底」：撤图后元素会变成完全透明的空块。 */
    const imageOnly = (hasBg || hasBorderImage) && !opaqueBg && fillsBox(body);

    /* 这张纸本身是深色还是浅色？（量像素，不猜） */
    let paperDark = false;
    if (imageOnly) {
      const stats = assets.map(a => assetStats(join(root, 'assets', a))).filter(Boolean);
      if (stats.length) paperDark = Math.min(...stats.map(s => s.lum)) < DARK_PAPER_LUMA;
    }

    /* 暖色底 → 中性底。整个 App 大量色值写死成"暖纸色"，判据：R 明显高于 B。 */
    const warm = color && color.a > 0.5 && (color.r - color.b) > 12;
    const darkTone = color && luminance(color) < 0.42;

    for (const sel of rule.selectors) {
      const prefixed = `:root[data-theme="plain"] ${sel}`;
      if (TRACE && sel.includes(TRACE)) {
        console.log(`[trace] ${file}  ${sel}
  assets=${assets.join('+')}
  hasBg=${hasBg} hasBorderImage=${hasBorderImage} hasMask=${hasMask}
  colorRaw=${colorRaw} opaqueBg=${opaqueBg} imageOnly=${imageOnly}
  warm=${!!warm} darkTone=${!!darkTone} paperDark=${paperDark} fillsBox=${fillsBox(body)}
  body=${body.trim().slice(0, 220).replace(/\s+/g, ' ')}`);
      }
      if (hasBg) bgImage.add(prefixed);
      if (hasBorderImage) borderImage.add(prefixed);
      if (hasMask) mask.add(prefixed);

      /* 「图 + 写死的深/浅底色」：撤图后底色要原样留住。
         否则更宽泛的补白底会凭权重压过它（例：未选中的胶囊 vs 选中的深绿胶囊）。
         三种情况例外，换成中性 / 提亮后的色：
           · 暖色底      → 不留原色，否则页面又会一片米黄；
           · 很深的非暖底 → 深墨绿 / 深蓝在浅色界面里视觉上就是"黑"，一并提亮
                            （深绿按主色提亮成墨绿，其余归到石板灰蓝）。 */
      if (hasBg && opaqueBg) {
        let kept;
        if (warm) {
          kept = darkTone ? INK : (isPageLevel(sel) ? CANVAS : SURFACE);
        } else if (color && luminance(color) < DEEP_TONE_LUMA) {
          const greenish = color.g >= color.r && color.g >= color.b && (color.g - color.b) > 8;
          kept = greenish ? SAGE : INK;
        } else {
          kept = colorRaw;
        }
        if (!keepColor.has(prefixed)) keepColor.set(prefixed, new Set());
        keepColor.get(prefixed).add(kept);
      }

      if (imageOnly && !isPseudo(sel)) {
        (paperDark ? inkBlock : surface).add(prefixed);
        decisions.push({ file, sel, kind: paperDark ? 'ink' : 'surface', why: 'image-only', assets: assets.join('+') });
      }

      if (warm) {
        const bucket = isPageLevel(sel) ? pageCanvas : (darkTone ? inkBlock : surface);
        bucket.add(prefixed);
        decisions.push({ file, sel, kind: bucket === pageCanvas ? 'canvas' : (bucket === inkBlock ? 'ink' : 'surface'), why: 'warm-bg', assets: assets.join('+') || '-' });
      }
    }
  }
}

/* 深色底优先于白底：同一个选择器两边都命中时，深色那套说了算。 */
for (const sel of inkBlock) surface.delete(sel);
for (const sel of pageCanvas) surface.delete(sel);

const list = set => [...set].sort().join(',\n');

const parts = [];
parts.push(`/* ============================================================================
   清简 · 纯色极简主题的质感重置  themes-plain.css
   —— 本文件由 scripts/gen-plain-theme.mjs 自动生成，请勿手工编辑。
      改了 styles.css / performance.css 之后重新运行该脚本即可。

   扫描 ${scanned} 条规则，命中素材规则 ${hit} 条。
   只影响 [data-theme="plain"]，米白与暖阳两个主题完全不受影响。
   ========================================================================== */
`);

if (borderImage.size) {
  parts.push(`/* —— 纸边 / 相框：撤掉图片边框 —— */\n${list(borderImage)} {\n  border-image: none !important;\n  border-image-source: none !important;\n}\n`);
}
if (mask.size) {
  parts.push(`/* —— 撕纸边等形状遮罩：恢复为完整矩形 —— */\n${list(mask)} {\n  -webkit-mask-image: none !important;\n  mask-image: none !important;\n}\n`);
}
if (bgImage.size) {
  parts.push(`/* —— 纹理 / 装饰图底：撤掉图片图层（颜色与渐变保留） —— */\n${list(bgImage)} {\n  background-image: none !important;\n}\n`);
}
if (pageCanvas.size) {
  parts.push(`/* —— 页面级写死的暖色底 → 画布灰 —— */\n${list(pageCanvas)} {\n  background-color: ${CANVAS} !important;\n}\n`);
}
if (inkBlock.size) {
  parts.push(`/* —— 原本靠深色纸衬托浅字的方块 → 深色实底 —— */\n${list(inkBlock)} {\n  background-color: ${INK} !important;\n}\n`);
}
if (surface.size) {
  parts.push(`/* —— 原本「图片 + 透明底」的元素 → 补一层纯色，避免变成没有底的纸片 —— */\n${list(surface)} {\n  background-color: ${SURFACE} !important;\n}\n`);
}

/* 原样留住的底色：权重与上面的补白底同级或更高，必须排在它们之后。 */
const byColor = new Map();
for (const [sel, colors] of keepColor) {
  for (const c of colors) {
    if (!byColor.has(c)) byColor.set(c, new Set());
    byColor.get(c).add(sel);
  }
}
if (byColor.size) {
  const blocks = [];
  for (const [color, sels] of [...byColor].sort((a, b) => a[0].localeCompare(b[0]))) {
    blocks.push(`${list(sels)} {\n  background-color: ${color} !important;\n}`);
  }
  parts.push(`/* —— 同一条规则里另有写死的底色：撤图后原样留住（否则会被更宽泛的补白底压掉）—— */\n${blocks.join('\n\n')}\n`);
}

parts.push(`/* —— 以 <img> 直接贴在图里的装饰插图：清简主题下收起 —— */\n:root[data-theme="plain"] .quick-paper-art,\n:root[data-theme="plain"] .weather-art {\n  display: none !important;\n}\n`);

/* 把「浅色化 + 美化」层拼进本文件的末尾。
 *
 * 为什么不再单独发一个 themes-plain-light.css：
 *   那一层必须排在生成结果**之后**才压得住 !important，所以只能是第 6 个 <link>。
 *   但多一个文件就多一个"送不到设备上"的风险 —— 老装机包里没有它，
 *   热更新一旦下载中断，就会留下"新 index.html 引用它、文件却不在"的半截状态，
 *   表现为「用着用着一部分界面变回旧样子」（2026-10-10 用户实测）。
 *   并进来之后：index.html 只引用 themes-plain.css 一个文件，链路少一环。
 */
const LIGHT_LAYER = join(root, 'themes-plain-light.css');
if (existsSync(LIGHT_LAYER)) {
  const light = dedupeSections(readFileSync(LIGHT_LAYER, 'utf8'));
  parts.push(`\n/* ==========================================================================\n   浅色化 + 美化层（ themes-plain-light.css 由脚本拼接到此 ）\n   源文件 themes-plain-light.css 可手改；本文件由脚本生成，改完重跑即可。\n   ========================================================================== */\n${light}`);
}

writeFileSync(OUT, parts.join('\n'), 'utf8');

console.log(`✓ 已生成 ${OUT}`);
console.log(`  扫描规则   ${scanned} 条，命中素材规则 ${hit} 条`);
console.log(`  清边框      ${borderImage.size} 个选择器`);
console.log(`  清遮罩      ${mask.size} 个选择器`);
console.log(`  清背景图    ${bgImage.size} 个选择器`);
console.log(`  页面底改灰  ${pageCanvas.size} 个选择器`);
console.log(`  深色块改底  ${inkBlock.size} 个选择器`);
console.log(`  补纯色底    ${surface.size} 个选择器`);
console.log(`  保留原底色  ${keepColor.size} 个选择器`);

if (REPORT) {
  console.log('\n—— 补底判定（image-only）——');
  for (const d of decisions.filter(d => d.why === 'image-only')) {
    const l = d.assets.split('+').map(a => {
      const s = assetStats(join(root, 'assets', a));
      return `${a}(${s ? s.lum.toFixed(3) : '?'})`;
    }).join(' ');
    console.log(`  [${d.kind}] ${d.sel}\n        ${l}`);
  }
}
