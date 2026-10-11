/**
 * 素材（PNG）平均亮度采样 —— 只有构建期脚本用，不进 App 包。
 *
 * 【为什么需要它】
 * 「清简」主题撤掉图片质感后，原本"图 + 透明底"的元素会变成没有底的透明块，
 * 上面的浅色文字随之消失。要给它补一层底，就必须知道这张"纸"本来是深色还是浅色。
 * 靠文件名猜（"ivory"是浅、"sage"是深）是不可靠的 —— 这里直接量像素。
 *
 * 支持 bitDepth 8、非隔行的常见 PNG（灰度 / RGB / 调色板 / 灰度+Alpha / RGBA），
 * 覆盖本项目全部素材。只统计不透明（alpha ≥ 0.25）的像素。
 */

import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** 解码 PNG（构建期与真机验证脚本共用：验证脚本要靠它量屏幕上真实画出来的像素）。 */
export function decodePng(buf) {
  let p = 8;
  let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  let plte = null;
  let trns = null;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) return null;
  const chan = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!chan || !idat.length) return null;

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * chan;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= chan ? out[o + x - chan] : 0;
      const b = y > 0 ? out[o - stride + x] : 0;
      const c = (x >= chan && y > 0) ? out[o - stride + x - chan] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[o + x] = v & 0xff;
    }
    o += stride;
  }
  return { w, h, chan, ctype, plte, trns, px: out };
}

const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };

const cache = new Map();

/** 返回 { lum, rgb, cover }；无法解析时返回 null。 */
export function assetStats(file) {
  if (cache.has(file)) return cache.get(file);
  let result = null;
  if (existsSync(file)) {
    try {
      const img = decodePng(readFileSync(file));
      if (img) {
        let r = 0, g = 0, b = 0, n = 0, opaque = 0;
        for (let i = 0; i < img.px.length; i += img.chan) {
          let R, G, B, A = 255;
          if (img.ctype === 3) {
            const idx = img.px[i];
            R = img.plte[idx * 3]; G = img.plte[idx * 3 + 1]; B = img.plte[idx * 3 + 2];
            if (img.trns && idx < img.trns.length) A = img.trns[idx];
          } else if (img.ctype === 6) {
            R = img.px[i]; G = img.px[i + 1]; B = img.px[i + 2]; A = img.px[i + 3];
          } else if (img.ctype === 2) {
            R = img.px[i]; G = img.px[i + 1]; B = img.px[i + 2];
            if (img.trns && R === img.trns.readUInt16BE(0) && G === img.trns.readUInt16BE(2) && B === img.trns.readUInt16BE(4)) A = 0;
          } else if (img.ctype === 4) {
            R = G = B = img.px[i]; A = img.px[i + 1];
            if (img.trns && R === img.trns.readUInt16BE(0)) A = 0;
          } else {
            R = G = B = img.px[i];
            if (img.trns && R === img.trns.readUInt16BE(0)) A = 0;
          }
          const a = A / 255;
          if (a < 0.25) continue;
          r += R * a; g += G * a; b += B * a; n += a; opaque += 1;
        }
        if (n) {
          r /= n; g /= n; b /= n;
          result = {
            rgb: [Math.round(r), Math.round(g), Math.round(b)],
            lum: 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b),
            cover: opaque / (img.w * img.h)
          };
        }
      }
    } catch { /* 解析失败按未知处理 */ }
  }
  cache.set(file, result);
  return result;
}

/** 深色"纸"的亮度上限：低于它，说明这块底本来是深色、上面通常压着浅色文字。 */
export const DARK_PAPER_LUMA = 0.15;
