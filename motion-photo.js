// 实况 / 动态照片：一张 JPEG 里另附一段短视频。
// Android 动图（Google Motion Photo、三星、小米等）通常把 MP4 接在 JPEG 末尾，
// 并用 XMP 的 MicroVideoOffset 或 Container Directory 标明长度。
// 苹果实况若以「同名 JPG + MOV」一起分享进来，则按文件名配对。
// 这里只识别和切出视频，不解码、不重压缩。

const MAX_CONTAINER_BYTES = 80 * 1024 * 1024;
const HEADER_SCAN_BYTES = 512 * 1024;
const MIN_VIDEO_BYTES = 64;
const MAX_SEFT_TRAILER = 64 * 1024;
const VIDEO_BRANDS = new Set([
  'isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1',
  'M4V ', 'M4VH', 'MSNV', 'qt  ', '3gp4', '3gp5', '3gp6', 'dash', 'hev1', 'hvc1'
]);
const STILL_REF = /^(?:data:image\/(?:jpeg|png|webp);base64,|mine-media:\/\/|mine-browser-media:\/\/)/;
const VIDEO_REF = /^(?:data:video\/[a-z0-9.+-]+;base64,|mine-media:\/\/|mine-browser-media:\/\/)/i;
const VIDEO_NAME = /\.(mp4|mov|m4v|webm)$/i;

const readU32 = (bytes, offset) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset);
const ascii4 = (bytes, offset) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

function headerText(bytes) {
  const end = Math.min(bytes.length, HEADER_SCAN_BYTES);
  return new TextDecoder('latin1').decode(bytes.subarray(0, end));
}

function endsWithSeft(bytes, offset) {
  const rest = bytes.length - offset;
  if (rest <= 0 || rest > MAX_SEFT_TRAILER) return false;
  return ascii4(bytes, bytes.length - 4) === 'SEFT';
}

// 从 start 起按 MP4/MOV 顶层 box 往下走。走得通才认为这是一段真视频，
// 避免 JPEG 压缩数据里偶然出现 “ftyp” 四个字母就被当成视频。
function walkVideo(bytes, start) {
  let offset = start;
  let sawFtyp = false;
  let sawMedia = false;
  while (offset + 8 <= bytes.length) {
    const size32 = readU32(bytes, offset);
    const type = ascii4(bytes, offset + 4);
    if (!/^[a-zA-Z0-9 ]{4}$/.test(type)) break;
    let size = size32;
    let header = 8;
    if (size32 === 1) {
      if (offset + 16 > bytes.length) break;
      if (readU32(bytes, offset + 8) !== 0) break;
      size = readU32(bytes, offset + 12);
      header = 16;
    }
    // size 0 表示这个 box 一直延伸到文件末尾，不少相机的 mdat 就是这样写的。
    // 只接受 moov / mdat，避免 JPEG 里偶然的四个字母把后半段吞进去。
    if (size32 === 0) {
      if (type !== 'moov' && type !== 'mdat') break;
      sawMedia = true;
      offset = bytes.length;
      break;
    }
    if (size < header || offset + size > bytes.length) break;
    if (type === 'ftyp') sawFtyp = true;
    if (type === 'moov' || type === 'mdat') sawMedia = true;
    offset += size;
  }
  if (!sawFtyp || !sawMedia || offset - start < MIN_VIDEO_BYTES) return -1;
  if (offset === bytes.length) return offset;
  if (endsWithSeft(bytes, offset)) return offset;
  return -1;
}

function brandAt(bytes, boxStart) {
  if (boxStart + 12 > bytes.length) return '';
  return ascii4(bytes, boxStart + 8);
}

function isPlayableSlice(bytes) {
  if (!bytes || bytes.length < MIN_VIDEO_BYTES || ascii4(bytes, 4) !== 'ftyp') return false;
  if (!VIDEO_BRANDS.has(brandAt(bytes, 0))) return false;
  return walkVideo(bytes, 0) === bytes.length;
}

function sliceByLength(bytes, length, padding = 0) {
  const starts = [];
  if (padding > 0) starts.push(bytes.length - length - padding);
  starts.push(bytes.length - length);
  for (const start of starts) {
    if (start < 2 || start >= bytes.length) continue;
    const video = bytes.subarray(start, start + length);
    if (isPlayableSlice(video)) return video;
  }
  return null;
}

function microVideoOffset(xmp) {
  const attribute = xmp.match(/MicroVideoOffset\s*=\s*"(\d+)"/i);
  if (attribute) return Number(attribute[1]);
  const element = xmp.match(/MicroVideoOffset>\s*(\d+)\s*</i);
  return element ? Number(element[1]) : 0;
}

function tagAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1].split(':').pop().toLowerCase()] = match[2];
  }
  return attributes;
}

function containerVideo(xmp) {
  const tags = xmp.match(/<[^>]*\bItem\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attributes = tagAttributes(tag);
    const semantic = String(attributes.semantic || '').toLowerCase();
    const mime = String(attributes.mime || '').toLowerCase();
    const length = Number(attributes.length) || 0;
    const padding = Number(attributes.padding) || 0;
    if (length > 0 && (semantic === 'motionphoto' || mime.startsWith('video/'))) return { length, padding };
  }
  const blocks = xmp.match(/<[^>\s]*Item\b[^>]*>[\s\S]*?<\/[^>\s]*Item>/gi) || [];
  for (const block of blocks) {
    const mime = (block.match(/Mime>\s*([^<]+)/i) || [])[1] || '';
    const semantic = (block.match(/Semantic>\s*([^<]+)/i) || [])[1] || '';
    const length = Number((block.match(/Length>\s*(\d+)/i) || [])[1] || 0);
    const padding = Number((block.match(/Padding>\s*(\d+)/i) || [])[1] || 0);
    if (length > 0 && (semantic.toLowerCase() === 'motionphoto' || mime.toLowerCase().startsWith('video/'))) return { length, padding };
  }
  return null;
}

function findAppendedVideo(bytes) {
  for (let index = 2; index + 16 <= bytes.length; index += 1) {
    if (bytes[index + 4] !== 0x66 || bytes[index + 5] !== 0x74 || bytes[index + 6] !== 0x79 || bytes[index + 7] !== 0x70) continue;
    if (!VIDEO_BRANDS.has(brandAt(bytes, index))) continue;
    const end = walkVideo(bytes, index);
    if (end > index) return bytes.subarray(index, end);
  }
  return null;
}

function motionFileName(mime) {
  return mime === 'video/quicktime' ? 'live-motion.mov' : 'live-motion.mp4';
}

function describe(video) {
  const mime = brandAt(video, 0) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  return { bytes: video, mime, name: motionFileName(mime) };
}

/**
 * 从 JPEG 字节里取出内嵌的动态视频。不是动图、或视频对不上，返回 null。
 * 普通静图不会被改写。
 */
export function extractMotionVideo(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < MIN_VIDEO_BYTES + 4) return null;
  if (bytes.length > MAX_CONTAINER_BYTES) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const xmp = headerText(bytes);
  const offset = microVideoOffset(xmp);
  if (offset) {
    const video = sliceByLength(bytes, offset, 0);
    if (video) return describe(video);
  }
  const container = containerVideo(xmp);
  if (container) {
    const video = sliceByLength(bytes, container.length, container.padding);
    if (video) return describe(video);
  }
  const appended = findAppendedVideo(bytes);
  return appended ? describe(appended) : null;
}

export async function extractMotionVideoFromBlob(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') return null;
  const size = Number(blob.size) || 0;
  if (!size || size > MAX_CONTAINER_BYTES) return null;
  if (/png|webp|gif/i.test(String(blob.type || ''))) return null;
  return extractMotionVideo(new Uint8Array(await blob.arrayBuffer()));
}

export function normalizeLivePhotos(list, stills = null, limit = 100) {
  const allowed = stills ? new Set(stills) : null;
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const still = STILL_REF.test(String(item?.still || '')) ? String(item.still) : '';
    const video = VIDEO_REF.test(String(item?.video || '')) ? String(item.video) : '';
    if (!still || !video || seen.has(still)) continue;
    if (allowed && !allowed.has(still)) continue;
    seen.add(still);
    result.push({ still, video });
    if (result.length >= limit) break;
  }
  return result;
}

export function photosWithLiveMotion(photos = [], livePhotos = []) {
  const motion = new Map(normalizeLivePhotos(livePhotos, photos).map(item => [item.still, item.video]));
  return photos.map(photo => {
    const video = motion.get(photo);
    return video ? { poster: photo, video, live: true } : photo;
  });
}

export function livePhotoMarkHtml() {
  return '<span class="live-photo-mark"><span class="material-symbols-outlined" aria-hidden="true">motion_photos_on</span>实况</span>';
}

export function photoHasLiveMotion(still, livePhotos = []) {
  return normalizeLivePhotos(livePhotos).some(item => item.still === still);
}

function fileStem(name) {
  return String(name || '').replace(/\.[^.]+$/, '').trim().toLowerCase();
}

/**
 * 把同名的静图和视频配成一对（IMG_0001.JPG + IMG_0001.MOV）。
 * 配上的视频不再单独当一条视频导入。
 */
export function pairNamedMotionSidecars(files = []) {
  const sidecars = new Map();
  for (const file of files) {
    const name = String(file?.name || '');
    if (!(file?.kind === 'video' || VIDEO_NAME.test(name))) continue;
    const stem = fileStem(name);
    if (stem && !sidecars.has(stem)) sidecars.set(stem, file);
  }
  const consumed = new Set();
  const linked = [];
  for (const file of files) {
    const name = String(file?.name || '');
    const video = file?.kind === 'video' || (VIDEO_NAME.test(name) && file?.kind !== 'photo');
    if (video) continue;
    const stem = fileStem(name);
    const sidecar = stem ? sidecars.get(stem) : null;
    if (sidecar && sidecar !== file) consumed.add(sidecar);
    linked.push({ file, sidecar: sidecar && sidecar !== file ? sidecar : null });
  }
  return { linked, consumed };
}
