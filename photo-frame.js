/* 照片「完整显示 + 背后同图放大铺底」的唯一实现（来源：日记翻阅牌组，用户指定的参考样式）。
   结构：外框 .photo-blur-frame（overflow:hidden + 纸色兜底，图片未到前不露白）
        └ img.photo-blur-pad   同一张图 inset:-12% / cover / opacity:.5 / scale(1.08)，无 filter
        └ img.photo-blur-still 同一张图 contain，完整不裁不拉伸
   两层同一地址，浏览器只下载一次；只用已有照片/封面缩略图，不读视频文件。
   牌组（motion.js）、随手拍（views/snippets.js）、私密空间封面（views/private-vault.js）共用。 */
export const PHOTO_FRAME_CLASS = 'photo-blur-frame';
export const PHOTO_PAD_CLASS = 'photo-blur-pad';
export const PHOTO_STILL_CLASS = 'photo-blur-still';

const attr = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** 返回两层 <img> 的 HTML。url 需已是可直接放进 src 的地址（调用方负责转义）。 */
export function photoFrameLayersHtml(url, { alt = '', padClass = '', stillClass = '', lazy = false } = {}) {
  const loading = lazy ? ' loading="lazy"' : '';
  return `<img class="${PHOTO_PAD_CLASS}${padClass ? ` ${padClass}` : ''}" src="${url}" alt="" aria-hidden="true" draggable="false"${loading}>`
    + `<img class="${PHOTO_STILL_CLASS}${stillClass ? ` ${stillClass}` : ''}" src="${url}" alt="${attr(alt)}" draggable="false"${loading}>`;
}

/** DOM 版本（牌组用），返回 [pad, still]。 */
export function photoFrameLayers(url, { padClass = '', stillClass = '' } = {}) {
  return [[PHOTO_PAD_CLASS, padClass], [PHOTO_STILL_CLASS, stillClass]].map(([base, extra]) => {
    const img = document.createElement('img');
    img.className = extra ? `${base} ${extra}` : base;
    img.alt = '';
    img.draggable = false;
    img.src = url;
    return img;
  });
}

/* 大图先藏着（舞台底色兜底，不白闪），解码完成后一次淡入；已解码的图立刻显示，没有任何过渡。
   只动 opacity；减少动态效果时 CSS 里不做过渡。共享转场会提前把 is-decoding 摘掉。 */
export function revealViewerImageWhenDecoded(image) {
  if (!image || image.tagName !== 'IMG' || typeof image.decode !== 'function') return;
  if (image.complete && image.naturalWidth && image.dataset?.decoded === '1') return;
  image.classList.add('is-decoding');
  const reveal = () => { image.classList.remove('is-decoding'); if (image.dataset) image.dataset.decoded = '1'; };
  const fallback = setTimeout(reveal, 1200);
  image.decode().catch(() => {}).then(() => { clearTimeout(fallback); reveal(); });
}
