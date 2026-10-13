import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const media = await read('media-store.js');
const app = await read('app.js');
const { firstPaintMediaRefs } = await import('../media-store.js');

test('externalizeStateMedia 支持 warmExisting=false，跳过已有引用的地址解析', () => {
  const fn = media.match(/export async function externalizeStateMedia\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(fn, /warmExisting = true/);
  assert.match(fn, /if \(!warmExisting\) continue;/);
});

test('firstPaintMediaRefs 只取封面 + 最新 3 张随手拍 + 头像', () => {
  const state = {
    settings: { todayCoverImage: 'mine-media://cover.jpg' },
    profile: { avatar: 'mine-media://avatar.jpg' },
    snippets: [
      { id: '1', type: 'photo', createdAt: 1, photo: 'mine-media://old.jpg' },
      { id: '2', type: 'photo', createdAt: 5, photos: ['mine-media://a.jpg', 'mine-media://a2.jpg'] },
      { id: '3', type: 'photo', createdAt: 4, photo: 'mine-media://b.jpg' },
      { id: '4', type: 'photo', createdAt: 3, photo: 'mine-media://c.jpg' },
      { id: '5', type: 'photo', createdAt: 2, photo: 'mine-media://d.jpg' },
      { id: '6', type: 'text', createdAt: 9, text: 'note' },
    ],
  };
  const refs = firstPaintMediaRefs(state);
  assert.deepEqual(refs, [
    'mine-media://cover.jpg',
    'mine-media://avatar.jpg',
    'mine-media://a.jpg',
    'mine-media://b.jpg',
    'mine-media://c.jpg',
  ]);
  assert.equal(refs.length, 5);
});

test('boot：首屏前不扫回收站、不给全库预热；仅外置 dataURL 且无迁移时不整份落库', () => {
  const boot = app.match(/async function boot\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.match(boot, /externalizeStateMedia\(state, \{ warmExisting: false \}\)/);
  assert.match(boot, /if \(migratedMedia\.migrated > 0\)/);
  assert.match(boot, /warmMediaRefs\(firstPaintMediaRefs\(state\)\)/);
  // 回收站找回在 render 之后
  const renderAt = boot.indexOf('render();');
  const recoverAt = boot.indexOf('recoverReferencedMedia(state)');
  assert.ok(renderAt > 0 && recoverAt > renderAt, 'recoverReferencedMedia 必须在首屏 render 之后');
  assert.match(boot, /warmMediaRefs\(stateMediaReferences\(state\)\)/);
  // 通知渠道不 await 挡首屏
  assert.match(boot, /initializeNotificationChannel\(\)\.catch/);
  assert.doesNotMatch(boot, /await initializeNotificationChannel/);
});
