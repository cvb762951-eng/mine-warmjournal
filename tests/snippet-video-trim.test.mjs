import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { makeSnippet } from '../model.js';

const snippetsSrc = readFileSync(new URL('../views/snippets.js', import.meta.url), 'utf8');

/**
 * 随手拍视频剪辑（2026-10-18）
 *
 * 用户原话：「我随手拍里的视频没办法和私密空间一样剪辑」。
 * 查下来是两件事：
 *   ① 卡片上根本没有剪辑入口（私密空间走 video-editor.js）；
 *   ② 更隐蔽的一条：makeSnippet 归一化是**白名单重建对象**，trim / crop 不在名单里，
 *      于是剪完第一次保存就被静默抹掉 —— 表现为"剪了等于没剪"。
 * 这两个测试就是钉住这两条，别再退回去。
 */

test('makeSnippet 保留视频的 trim / crop（否则一保存就白剪）', () => {
  const entry = makeSnippet({
    type: 'photo',
    date: '2026-10-18',
    videos: [{ video: 'mine-media://abc', duration: 30, width: 1920, height: 1080, trim: { start: 2.4, end: 12.6 }, crop: { x: .1, y: .05, w: .8, h: .8 } }]
  });
  const video = entry.videos[0];
  assert.deepEqual(video.trim, { start: 2.4, end: 12.6 }, '剪辑区间要留下来');
  assert.deepEqual(video.crop, { x: .1, y: .05, w: .8, h: .8 }, '取景框要留下来');
});

test('makeSnippet 不存"假"剪辑：端点不利索的区间、零面积取景框都当没剪', () => {
  // ⚠️ 整段（0→全长）是不是 null 由剪辑器决定 —— 它知道媒体真实时长（可能带小数），
  //    模型层只看区间本身，不去猜"这算不算整段"，免得把真实的尾部小剪切掉。
  const fullCrop = makeSnippet({
    type: 'photo',
    date: '2026-10-18',
    videos: [{ video: 'mine-media://abc', duration: 30, crop: { x: 0, y: 0, w: 1, h: 1 } }]
  });
  assert.equal(fullCrop.videos[0].crop, undefined, '整幅不裁就不要留 crop');

  const broken = makeSnippet({
    type: 'photo',
    date: '2026-10-18',
    videos: [{ video: 'mine-media://abc', duration: 30, trim: { start: 5, end: 5 }, crop: { x: 0, y: 0, w: 0, h: 0 } }]
  });
  assert.equal(broken.videos[0].trim, undefined, '端点不利索的区间当没剪');
  assert.equal(broken.videos[0].crop, undefined, '零面积取景框当没裁');
});

test('随手拍卡片有剪辑入口，且和私密空间共用同一个剪辑器', () => {
  assert.match(snippetsSrc, /data-trim-snippet-video=/, '卡片上要有剪辑按钮');
  assert.match(snippetsSrc, /import \{ showVideoEditor \} from '\.\.\/video-editor\.js'/, '要复用私密空间那个剪辑器');
  assert.match(snippetsSrc, /trimSnippetVideoEntry/, '点进去要能选段/开编辑器');
  // 在线视频没有本地源，按秒定位做不到 —— 必须明确拒绝，而不是悄悄什么都不做
  assert.match(snippetsSrc, /sourceType === 'hls'[\s\S]{0,80}不支持剪辑/, '在线视频要给出明确提示');
});

test('剪辑后卡片上的时长按"还能播多久"显示', () => {
  assert.match(snippetsSrc, /function snippetPlayableDuration/, '要有时长换算');
  assert.match(snippetsSrc, /formatVideoDuration\(snippetPlayableDuration\(video\)/, '时长戳要用换算后的值');
});
