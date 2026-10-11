import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMotionVideo, normalizeLivePhotos, pairNamedMotionSidecars, photosWithLiveMotion } from '../motion-photo.js';

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function ascii(value) {
  return Uint8Array.from(value, character => character.charCodeAt(0));
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function box(type, payload) {
  return concat(u32(8 + payload.length), ascii(type), payload);
}

function ftyp(brand) {
  const payload = new Uint8Array(12);
  payload.set(ascii(brand), 0);
  return box('ftyp', payload);
}

function videoBytes(brand = 'isom', payloadSize = 80) {
  return concat(ftyp(brand), box('moov', new Uint8Array(16)), box('mdat', new Uint8Array(payloadSize)));
}

function jpegWrapped(extra = new Uint8Array(), tail = new Uint8Array()) {
  return concat(Uint8Array.of(0xff, 0xd8), ascii('still-image'), extra, Uint8Array.of(0xff, 0xd9), tail);
}

test('MicroVideoOffset 切出末尾的 MP4，静帧部分不包含视频', () => {
  const video = videoBytes();
  const xmp = ascii(`<x:xmpmeta xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" GCamera:MicroVideo="1" GCamera:MicroVideoOffset="${video.length}"/>`);
  const file = jpegWrapped(xmp, video);
  const motion = extractMotionVideo(file);
  assert.equal(motion.mime, 'video/mp4');
  assert.equal(motion.bytes.length, video.length);
  assert.equal(ascii4(motion.bytes, 4), 'ftyp');
  assert.ok(file.length > motion.bytes.length);
});

test('Container Directory 的属性顺序不影响切出 Motion Photo', () => {
  const video = videoBytes('mp42', 96);
  const xmp = ascii(`<Container:Item Item:Semantic="MotionPhoto" Item:Padding="0" Item:Mime="video/mp4" Item:Length="${video.length}"/>`);
  const motion = extractMotionVideo(jpegWrapped(xmp, video));
  assert.equal(motion.bytes.length, video.length);
  assert.equal(ascii4(motion.bytes, 8), 'mp42');
});

test('元素形式的 XMP 和 Padding 会把填充字节留在视频外面', () => {
  const video = videoBytes();
  const padding = ascii('PAD!');
  const xmp = ascii(`<Container:Item><Item:Mime>video/mp4</Item:Mime><Item:Semantic>MotionPhoto</Item:Semantic><Item:Length>${video.length}</Item:Length><Item:Padding>${padding.length}</Item:Padding></Container:Item>`);
  const file = jpegWrapped(xmp, concat(padding, video));
  const motion = extractMotionVideo(file);
  assert.equal(motion.bytes.length, video.length);
  assert.equal(ascii4(motion.bytes, 4), 'ftyp');
});

test('mdat 长度为 0（延伸到文件末尾）时仍能按 XMP 长度切出', () => {
  const head = concat(ftyp('isom'), box('moov', new Uint8Array(16)));
  const payload = new Uint8Array(48);
  const video = concat(head, u32(0), ascii('mdat'), payload);
  const xmp = ascii(`<x:xmpmeta GCamera:MicroVideo="1" GCamera:MicroVideoOffset="${video.length}"/>`);
  const motion = extractMotionVideo(jpegWrapped(xmp, video));
  assert.equal(motion?.bytes.length, video.length);
  assert.equal(ascii4(motion.bytes, 4), 'ftyp');
});

test('没有 XMP 时，接在 JPEG 末尾且能走完 box 的 MP4 仍然保留', () => {
  const video = videoBytes('qt  ', 64);
  const motion = extractMotionVideo(jpegWrapped(new Uint8Array(), concat(video, ascii('SEFT'))));
  assert.equal(motion.mime, 'video/quicktime');
  assert.equal(motion.name, 'live-motion.mov');
  assert.equal(motion.bytes.length, video.length);
});

test('普通 JPEG 即使压缩数据里出现 ftyp 字样也不会被当成实况', () => {
  const noise = concat(ascii('not-a-box ftyp isom'), new Uint8Array(120));
  assert.equal(extractMotionVideo(jpegWrapped(noise)), null);
  assert.equal(extractMotionVideo(Uint8Array.of(0x89, 0x50, 0x4e, 0x47)), null);
});

test('实况链接只保留仍在照片列表里的静帧和视频引用', () => {
  const still = 'mine-media://still.jpg';
  const other = 'mine-media://other.jpg';
  const live = normalizeLivePhotos([
    { still, video: 'mine-media://motion.mp4' },
    { still: other, video: 'mine-media://gone.mp4' },
    { still, video: 'mine-media://duplicate.mp4' },
    { still: 'https://example.com/a.jpg', video: 'mine-media://remote.mp4' }
  ], [still]);
  assert.deepEqual(live, [{ still, video: 'mine-media://motion.mp4' }]);
  assert.deepEqual(photosWithLiveMotion([still, other], live), [
    { poster: still, video: 'mine-media://motion.mp4', live: true },
    other
  ]);
});

test('同名 JPG 与 MOV 配成一对，无关视频仍单独留下', () => {
  const photo = { kind: 'photo', name: 'IMG_0001.JPG' };
  const live = { kind: 'video', name: 'IMG_0001.MOV' };
  const clip = { kind: 'video', name: '假期.mp4' };
  const { linked, consumed } = pairNamedMotionSidecars([photo, live, clip]);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].file, photo);
  assert.equal(linked[0].sidecar, live);
  assert.equal(consumed.has(live), true);
  assert.equal(consumed.has(clip), false);
});

function ascii4(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}
