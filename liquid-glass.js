// ============================================================
// liquid-glass.js —— 液态玻璃组件（原生 JS，无框架依赖）
// 移植自 rdev/liquid-glass-react（用户确认 Demo 满意）
// 核心：SVG filter（feImage 位移贴图 + 色差 + 边缘遮罩）+ backdrop-filter + 弹性 transform
// 用法：liquidGlass(el, { mode, displacementScale, blurAmount, ... })
// 全局开关：body.liquid-glass 存在时启用（便于回退）
// ============================================================

// 位移贴图（base64，从 lg-utils.ts 提取）
import { displacementMap, polarDisplacementMap, prominentDisplacementMap } from './liquid-maps.js';

// shader 模式：Canvas 2D 逐像素生成位移贴图（从 lg-shader-utils.ts 移植）
// 圆角矩形分布（roundedRectSDF）：位移/折射/高光沿卡片圆角矩形边缘分布，四角贴合圆角
function generateShaderDisplacementMap(width, height, cornerRadius) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.style.display = 'none';
  const ctx = canvas.getContext('2d');
  if (!ctx) return displacementMap;
  const smoothStep = (a, b, t) => { t = Math.max(0, Math.min(1, (t - a) / (b - a))); return t * t * (3 - 2 * t); };
  const length = (x, y) => Math.sqrt(x * x + y * y);
  // 圆角矩形 SDF：归一化坐标 [-0.5,0.5]，halfW/halfH 为矩形半宽高比例，r 为圆角比例
  const roundedRectSDF = (x, y, halfW, halfH, r) => {
    const qx = Math.abs(x) - halfW + r, qy = Math.abs(y) - halfH + r;
    return Math.min(Math.max(qx, qy), 0) + length(Math.max(qx, 0), Math.max(qy, 0)) - r;
  };
  const h = canvas.height, w = canvas.width;
  // 矩形半宽高与圆角（按元素实际尺寸/圆角，贴合卡片边界）
  const radius = Math.min(cornerRadius || 0, w / 2, h / 2);
  const halfW = Math.max(0.01, 0.5 - radius / w);
  const halfH = Math.max(0.01, 0.5 - radius / h);
  const rProp = Math.max(0.01, radius / Math.min(w, h));
  let maxScale = 0;
  const raw = [];
  // 边缘环带位移（收敛）：折射退化为贴边的极窄微光带，中心/外部为 0
  const band = 0.06;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const uvX = x / w, uvY = y / h;
      const ix = uvX - 0.5, iy = uvY - 0.5;
      const dist = roundedRectSDF(ix, iy, halfW, halfH, rProp);
      // 边缘环带权重：dist ∈ [-band, band] 内正弦峰，中心(dist 更负)与外部(dist 更大)为 0
      let d = 0;
      if (dist >= -band && dist <= band) {
        d = Math.sin(((dist + band) / (2 * band)) * Math.PI);
      }
      const scaled = d;
      const dx = (ix * scaled + 0.5) * w - x;
      const dy = (iy * scaled + 0.5) * h - y;
      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
      raw.push(dx, dy);
    }
  }
  maxScale = Math.max(maxScale || 1, 1);
  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;
  let idx = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = raw[idx++], dy = raw[idx++];
      const edgeDistance = Math.min(x, y, w - x - 1, h - y - 1);
      const edgeFactor = Math.min(1, edgeDistance / 2);
      const r = (dx * edgeFactor) / maxScale + 0.5;
      const g = (dy * edgeFactor) / maxScale + 0.5;
      const pi = (y * w + x) * 4;
      data[pi] = Math.max(0, Math.min(255, r * 255));
      data[pi + 1] = Math.max(0, Math.min(255, g * 255));
      data[pi + 2] = Math.max(0, Math.min(255, g * 255));
      data[pi + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const url = canvas.toDataURL();
  canvas.remove();
  return url;
}

// 位移贴图：统一用 shader 生成的圆角矩形分布（贴合卡片圆角矩形边界，四角有折射）。
// base64 圆形贴图仅作 Canvas 不可用时的兜底。
const getMap = (mode, shaderUrl) => shaderUrl || displacementMap;

let uidCounter = 0;
const uid = () => `lg-${Date.now().toString(36)}-${(uidCounter += 1)}`;

function glassFilterHtml(id, displacementScale, aberrationIntensity, mode, shaderUrl) {
  const map = getMap(mode, shaderUrl);
  const scaleSign = mode === 'shader' ? 1 : -1;
  return `<svg style="position:absolute;width:100%;height:100%;top:0;left:0;pointer-events:none;z-index:0" aria-hidden="true"><defs>
    <radialGradient id="${id}-edge-mask" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="black" stop-opacity="0"/>
      <stop offset="${Math.max(30, 80 - aberrationIntensity * 2)}%" stop-color="black" stop-opacity="0"/>
      <stop offset="100%" stop-color="white" stop-opacity="1"/>
    </radialGradient>
    <filter id="${id}" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
      <feImage x="0" y="0" width="100%" height="100%" result="DISPLACEMENT_MAP" href="${map}" preserveAspectRatio="xMidYMid slice"/>
      <feColorMatrix in="DISPLACEMENT_MAP" type="matrix" values="0.3 0.3 0.3 0 0&#10;0.3 0.3 0.3 0 0&#10;0.3 0.3 0.3 0 0&#10;0 0 0 1 0" result="EDGE_INTENSITY"/>
      <feComponentTransfer in="EDGE_INTENSITY" result="EDGE_MASK"><feFuncA type="discrete" tableValues="0 ${aberrationIntensity * 0.05} 1"/></feComponentTransfer>
      <feOffset in="SourceGraphic" dx="0" dy="0" result="CENTER_ORIGINAL"/>
      <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="${displacementScale * scaleSign}" xChannelSelector="R" yChannelSelector="B" result="RED_DISPLACED"/>
      <feColorMatrix in="RED_DISPLACED" type="matrix" values="1 0 0 0 0&#10;0 0 0 0 0&#10;0 0 0 0 0&#10;0 0 0 1 0" result="RED_CHANNEL"/>
      <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="${displacementScale * (scaleSign - aberrationIntensity * 0.05)}" xChannelSelector="R" yChannelSelector="B" result="GREEN_DISPLACED"/>
      <feColorMatrix in="GREEN_DISPLACED" type="matrix" values="0 0 0 0 0&#10;0 1 0 0 0&#10;0 0 0 0 0&#10;0 0 0 1 0" result="GREEN_CHANNEL"/>
      <feDisplacementMap in="SourceGraphic" in2="DISPLACEMENT_MAP" scale="${displacementScale * (scaleSign - aberrationIntensity * 0.1)}" xChannelSelector="R" yChannelSelector="B" result="BLUE_DISPLACED"/>
      <feColorMatrix in="BLUE_DISPLACED" type="matrix" values="0 0 0 0 0&#10;0 0 0 0 0&#10;0 0 1 0 0&#10;0 0 0 1 0" result="BLUE_CHANNEL"/>
      <feBlend in="GREEN_CHANNEL" in2="BLUE_CHANNEL" mode="screen" result="GB_COMBINED"/>
      <feBlend in="RED_CHANNEL" in2="GB_COMBINED" mode="screen" result="RGB_COMBINED"/>
      <feGaussianBlur in="RGB_COMBINED" stdDeviation="${Math.max(0.1, 0.5 - aberrationIntensity * 0.1)}" result="ABERRATED_BLURRED"/>
      <feComposite in="ABERRATED_BLURRED" in2="EDGE_MASK" operator="in" result="EDGE_ABERRATION"/>
      <feComponentTransfer in="EDGE_MASK" result="INVERTED_MASK"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>
      <feComposite in="CENTER_ORIGINAL" in2="INVERTED_MASK" operator="in" result="CENTER_CLEAN"/>
      <feComposite in="EDGE_ABERRATION" in2="CENTER_CLEAN" operator="over"/>
    </filter>
  </defs></svg>`;
}

/**
 * liquidGlass(el, options) —— 为元素套液态玻璃效果（装饰覆盖方案）。
 * options：{ mode, displacementScale, blurAmount, saturation, aberrationIntensity,
 *            elasticity, cornerRadius, overLight }
 * 不转移 padding、不搬内容 —— el 尺寸/布局完全不变；
 * 装饰层（玻璃底 z-index:-1 + 高光 z-index:-1，均在内容下方）absolute inset:0 覆盖整盒（含 padding 区）。
 * 弹性 transform 只作用装饰层，内容保持原样锐利稳定。
 * 返回 { destroy }。
 */
export function liquidGlass(el, options = {}) {
  if (!el) return { destroy: () => {} };
  // 读 CSS 变量（--lg-*，性能.css :root；options 可覆盖，一处改全局同步）
  const readCssVar = (name, fallback) => {
    try {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return value || fallback;
    } catch (error) { return fallback; }
  };
  // strength：strong（浮层/弹窗）| card（主卡）| sub（小卡/输入区）——对应分层 blur 变量
  const strength = options.strength || 'card';
  const blurVar = strength === 'strong' ? '--lg-blur-strong' : strength === 'sub' ? '--lg-blur-sub' : '--lg-blur-card';
  const cssBlur = parseFloat(readCssVar(blurVar, '14'));
  // cornerRadius：默认读元素实际圆角（贴合卡片圆角矩形边界），options 可覆盖
  const cssRadius = getComputedStyle(el).borderRadius;
  const parsedRadius = cssRadius ? parseFloat(cssRadius) : 0;
  const fallbackRadius = parseFloat(readCssVar('--lg-corner-radius', '999')) || 999;
  const o = {
    mode: options.mode || 'standard',
    displacementScale: options.displacementScale ?? parseFloat(readCssVar('--lg-displacement', '14')),
    blurAmount: options.blurAmount ?? undefined,
    blurPxOverride: options.blurPx ?? null,
    saturation: options.saturation ?? parseFloat(readCssVar('--lg-saturate', '140')),
    aberrationIntensity: options.aberrationIntensity ?? 0.4,
    elasticity: options.elasticity ?? parseFloat(readCssVar('--lg-elasticity', '0.08')),
    glowOpacity: options.glowOpacity ?? parseFloat(readCssVar('--lg-glow-opacity', '0.12')),
    cornerRadius: Number.isFinite(options.cornerRadius) ? options.cornerRadius : (parsedRadius || fallbackRadius),
    overLight: options.overLight ?? true,
    cssBlur
  };
  const id = uid();
  // 所有模式统一生成圆角矩形位移贴图（贴合元素尺寸与圆角）
  let shaderUrl = '';
  const rect = el.getBoundingClientRect();
  shaderUrl = generateShaderDisplacementMap(Math.max(64, Math.round(rect.width)), Math.max(64, Math.round(rect.height)), o.cornerRadius);

  const radius = o.cornerRadius;
  // clip-path 的圆角用「圆形角」值（rx=ry=min(radius, 半高, 半宽)）：
  // border-radius 999px 由 CSS 等比缩放成圆形胶囊角，但 clip-path inset round 的 rx/ry 各自 clamp 到
  // 宽/高一半 → 胶囊(390×80) 会成椭圆角（rx 195/ry 40）→ 梭形收缩。用圆形角值避免。
  const clipRadius = Math.max(1, Math.min(radius, rect.height / 2, rect.width / 2));
  // 模糊强度：blurAmount 给定用旧公式；否则用 --lg-blur-* 变量（strength 分层）或 blurPx 覆盖
  const blurPx = o.blurPxOverride != null ? o.blurPxOverride
    : (o.blurAmount != null ? (o.overLight ? 12 : 4) + o.blurAmount * 32 : o.cssBlur);
  const satPct = o.saturation;

  // 确保 el 可容纳 absolute 装饰层（static → relative；不动 fixed/absolute）
  const pos = getComputedStyle(el).position;
  if (pos === 'static') el.style.position = 'relative';

  // 记录并临时禁用 el 自身 backdrop-filter 与背景（避免 backdrop root 限制玻璃、玻璃被自身背景盖住）
  const prevBackdrop = el.style.backdropFilter || '';
  const prevWebkitBackdrop = el.style.webkitBackdropFilter || '';
  const prevBg = el.style.background || '';
  el.style.backdropFilter = 'none';
  el.style.webkitBackdropFilter = 'none';
  el.style.background = 'transparent';

  // 玻璃底容器（z-index:-1：内容之下，backdrop-filter 模糊页面背景 + SVG filter）
  // clip-path 圆形角裁剪：裁剪 feDisplacementMap 位移/折射溢出到圆角边界（防尖角/防梭形）
  const bottom = document.createElement('div');
  bottom.className = 'liquid-glass__bottom';
  bottom.style.cssText = 'position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:' + radius + 'px;overflow:hidden;clip-path:inset(0 round ' + clipRadius + 'px);-webkit-clip-path:inset(0 round ' + clipRadius + 'px);transition:all ease-out 0.2s';
  bottom.innerHTML = glassFilterHtml(id, o.displacementScale, o.aberrationIntensity, o.mode, shaderUrl);
  const warp = document.createElement('span');
  warp.className = 'liquid-glass__warp';
  warp.style.cssText = 'position:absolute;inset:0;filter:url(#' + id + ');backdrop-filter:blur(' + blurPx + 'px) saturate(' + satPct + '%);-webkit-backdrop-filter:blur(' + blurPx + 'px) saturate(' + satPct + '%);background:rgba(255,255,255,' + (o.overLight ? 0.05 : 0.3) + ');border-radius:' + radius + 'px';
  bottom.appendChild(warp);
  // overLight 深色遮罩（内容下方，极淡 ≤0.03——背景自然透出，明亮通透）
  if (o.overLight) {
    const shade = document.createElement('span');
    shade.className = 'liquid-glass__shade';
    shade.style.cssText = 'position:absolute;inset:0;background:rgba(10,12,18,0.02);border-radius:' + radius + 'px';
    bottom.appendChild(shade);
  }
  el.appendChild(bottom);

  // 高光容器（z-index:-1：内容下方，透过透明内容可见，绝不叠加前景文字/图标）
  // clip-path 圆形角裁剪：裁剪高光/glow 溢出到圆角边界（防尖角/防梭形）
  const top = document.createElement('div');
  top.className = 'liquid-glass__top';
  top.style.cssText = 'position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:' + radius + 'px;overflow:hidden;clip-path:inset(0 round ' + clipRadius + 'px);-webkit-clip-path:inset(0 round ' + clipRadius + 'px);transition:all ease-out 0.2s';
  // 高光边框：mask 只显示 1.5px 边缘亮带（content-box xor）——无内部 tint，不形成内圈轮廓
  const borderMask = '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;box-sizing:border-box;';
  const border1 = document.createElement('span');
  border1.className = 'liquid-glass__border';
  border1.style.cssText = 'position:absolute;inset:0;border-radius:' + radius + 'px;pointer-events:none;mix-blend-mode:screen;opacity:0.1;padding:1.5px;' + borderMask + 'box-shadow:0 0 0 0.5px rgba(255,255,255,0.4) inset,0 1px 3px rgba(255,255,255,0.2) inset,0 1px 4px rgba(0,0,0,0.2)';
  const border2 = border1.cloneNode();
  border2.style.mixBlendMode = 'overlay';
  border2.style.opacity = '0.35';
  // hover 光效：沿胶囊顶部边缘的高光带（非径向圆斑，不形成第二套椭圆轮廓）
  const glow = document.createElement('span');
  glow.className = 'liquid-glass__glow';
  glow.style.cssText = 'position:absolute;inset:0;border-radius:' + radius + 'px;pointer-events:none;opacity:0;transition:all 0.2s ease-out;background-image:linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.04) 38%, rgba(255,255,255,0) 62%);mix-blend-mode:overlay';
  top.appendChild(border1);
  top.appendChild(border2);
  top.appendChild(glow);
  el.appendChild(top);

  // ---- 鼠标追踪与弹性（只作用装饰层）----
  let mouseX = 0, mouseY = 0, offsetX = 0, offsetY = 0, hovered = false, active = false;
  const decorLayers = [bottom, top];

  const onMove = (e) => {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    mouseX = e.clientX; mouseY = e.clientY;
    offsetX = ((e.clientX - centerX) / rect.width) * 100;
    offsetY = ((e.clientY - centerY) / rect.height) * 100;
    applyTransform();
    updateBorders();
  };
  const onEnter = () => { hovered = true; glow.style.opacity = String(o.glowOpacity); };
  const onLeave = () => {
    hovered = false; active = false;
    glow.style.opacity = '0';
    decorLayers.forEach(layer => { layer.style.transform = ''; });
  };
  const onDown = () => { active = true; };
  const onUp = () => { active = false; };

  function applyTransform() {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const dx = mouseX - cx, dy = mouseY - cy;
    const edgeDistX = Math.max(0, Math.abs(dx) - rect.width / 2);
    const edgeDistY = Math.max(0, Math.abs(dy) - rect.height / 2);
    const edgeDist = Math.sqrt(edgeDistX * edgeDistX + edgeDistY * edgeDistY);
    const activation = 200;
    const fade = edgeDist > activation ? 0 : 1 - edgeDist / activation;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    // 整体等比缩放 + 平移：轮廓形状恒定（胶囊半圆始终饱满，无 scaleX/scaleY 椭圆变形）
    const stretch = Math.min(dist / 300, 1) * o.elasticity * fade;
    const scale = Math.max(0.92, 1 + stretch * 0.1);
    const tx = dx * o.elasticity * 0.1 * fade;
    const ty = dy * o.elasticity * 0.1 * fade;
    const transform = 'translate(' + tx + 'px,' + ty + 'px) ' + (active ? 'scale(0.96)' : 'scale(' + scale + ')');
    decorLayers.forEach(layer => { layer.style.transform = transform; });
  }

  function updateBorders() {
    const deg = 135 + offsetX * 1.2;
    const a1 = 0.12 + Math.abs(offsetX) * 0.008;
    const a2 = 0.4 + Math.abs(offsetX) * 0.012;
    const p1 = Math.max(10, 33 + offsetY * 0.3);
    const p2 = Math.min(90, 66 + offsetY * 0.4);
    border1.style.background = 'linear-gradient(' + deg + 'deg, rgba(255,255,255,0) 0%, rgba(255,255,255,' + a1 + ') ' + p1 + '%, rgba(255,255,255,' + a2 + ') ' + p2 + '%, rgba(255,255,255,0) 100%)';
    border2.style.background = 'linear-gradient(' + deg + 'deg, rgba(255,255,255,0) 0%, rgba(255,255,255,' + (0.32 + Math.abs(offsetX) * 0.008) + ') ' + p1 + '%, rgba(255,255,255,' + (0.6 + Math.abs(offsetX) * 0.012) + ') ' + p2 + '%, rgba(255,255,255,0) 100%)';
  }

  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);

  updateBorders();

  return {
    destroy() {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      bottom.remove();
      top.remove();
      el.style.backdropFilter = prevBackdrop;
      el.style.webkitBackdropFilter = prevWebkitBackdrop;
      el.style.background = prevBg;
      if (el.__liquidGlass) delete el.__liquidGlass;
    }
  };
}

export const isLiquidGlassEnabled = () => typeof document !== 'undefined' && document.body && document.body.classList.contains('liquid-glass');
