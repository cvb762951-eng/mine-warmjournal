import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');

const style = await read('styles.css');

/**
 * 随手拍：单张照片的展示尺寸（2026-10-09）
 *
 * 用户反馈「单张大图的显示太大了，很影响观感」。
 *
 * 排查：单张图是唯一不固定高度的分支 ——
 *   容器 .count-1 用 min-height + height:auto，
 *   图片又允许 max-height:min(82dvh,760px) 并用 contain 完整显示，
 *   于是竖拍的大图能顶到六七百像素，占掉大半个屏幕。
 *   而 2/3/4/5 张都是固定高度（250~286px），只有单张例外。
 *
 * 修法：单张也改为固定高度（比多张略高以保留「主角」分量），
 * 图片 contain 完整显示、超出部分由同照片虚化垫底。
 * 列表里是预览，点开仍可看完整原图。
 *
 * 2026-10-09 二次反馈「感觉不美观」→ 三档高度等比下调：
 * 单张 320→260、多张 286→232、两张 250→200（窄屏 280→228 等），主次关系不变。
 *
 * 2026-10-09 三次反馈「更矮一档」→ 再降一档到单张 190（≈16:9，与视频封面同高）：
 * 单张 260→190、多张 232→170、两张 200→146（窄屏 228→167 / 204→150 / 176→129）。
 * 竖拍照片仍 contain 完整显示、不裁切，左右留白由同照片虚化垫底。
 */

test('单张照片用固定高度，不再跟着原图比例无限拔高', () => {
  const rule = style.match(/\.snippet-photo-mosaic\.count-1\{([^}]*)\}/)?.[1] || '';
  assert.ok(rule, '应能找到 .count-1 的规则');
  assert.match(rule, /height:190px/, '默认应为固定 190px（与视频封面同高）');
  assert.doesNotMatch(rule, /height:auto/, '不能再让容器跟着图片自动撑高');
});

test('单张照片的图片保持完整（contain），但被固定高度约束住', () => {
  const imgRule = style.match(/\.snippet-photo-mosaic\.count-1 \.snippet-photo-tile img\{([^}]*)\}/)?.[1] || '';
  assert.ok(imgRule, '应能找到单张图的 img 规则');
  assert.match(imgRule, /height:100%/, '图片应填满容器高度');
  // contain 是有意保留的：竖拍照片要完整显示，不裁切
  assert.match(imgRule, /object-fit:contain/, '应保留 contain —— 竖拍照片完整显示是既定设计');
  // 这条是问题根源，必须彻底消失
  assert.doesNotMatch(imgRule, /max-height:min\(82dvh/, '不能再允许 82dvh 的高度上限');
});

test('窄屏下的单张图同样固定高度', () => {
  const narrow = style.match(/@media\(max-width:370px\)\{[^@]*\.snippet-photo-mosaic\.count-1\{([^}]*)\}/)?.[1] || '';
  assert.ok(narrow, '窄屏媒体查询里应有 count-1 的规则');
  assert.match(narrow, /height:167px/);
  assert.doesNotMatch(narrow, /height:auto/);
});

test('单张与多张的高度处在同一量级，观感统一', () => {
  const one = Number(style.match(/\.snippet-photo-mosaic\.count-1\{height:(\d+)px/)?.[1] || 0);
  const two = Number(style.match(/\.snippet-photo-mosaic\.count-2\{height:(\d+)px/)?.[1] || 0);
  const many = Number(style.match(/\.snippet-photo-mosaic\.count-3[^}]*height:(\d+)px/)?.[1] || 0);
  assert.ok(one && two && many, '三个高度都应能读到');
  // 单张可以略高（它是主角），但不能比多张图夸张地大
  assert.ok(one > many, '单张应略高于多张，保留主次关系');
  assert.ok(one <= many * 1.3, `单张(${one}) 不应比多张(${many}) 高出太多`);
});
