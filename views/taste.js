import { $, $$, esc, state, save, render, modal, closeModal, show, confirmDelete, imgSrc, goBack, registerView, registerBinder, registerSubmitHandler, registerHelper } from '../core.js';
import { dateKey, makeTasteEntry, tastePlaceGroups, TASTE_TYPES, TASTE_VERDICTS } from '../model.js';
import { compressSnippetPhoto, importPhotoBatch, isSupportedJournalPhoto } from '../photo-utils.js';
import { photoViewer } from './common.js';
import { photoFrameLayersHtml } from '../photo-frame.js';

let tasteFilter = 'all';
let tasteSearch = '';
let pendingTastePhotos = [];

const positiveVerdicts = new Set(['favorite', 'again']);
const negativeVerdicts = new Set(['no', 'avoid']);
const placeNameFor = entry => String(entry.type === 'place' ? entry.name : entry.placeName || '').trim();
const ratingStars = rating => rating ? `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}` : '尚未评分';

function filteredTasteEntries() {
  const needle = tasteSearch.trim().toLocaleLowerCase('zh-CN');
  return [...(state.tasteEntries || [])]
    .filter(entry => {
      if (tasteFilter === 'again' && !positiveVerdicts.has(entry.verdict)) return false;
      if (tasteFilter === 'place' && !placeNameFor(entry)) return false;
      if (tasteFilter === 'snack' && entry.type !== 'snack') return false;
      if (tasteFilter === 'avoid' && !negativeVerdicts.has(entry.verdict)) return false;
      if (!needle) return true;
      return [entry.name, entry.placeName, entry.brand, entry.location, entry.notes, ...(entry.flavorTags || [])].join(' ').toLocaleLowerCase('zh-CN').includes(needle);
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.updatedAt - a.updatedAt);
}

export function tasteView() {
  const all = state.tasteEntries || [];
  const entries = filteredTasteEntries();
  const again = all.filter(entry => positiveVerdicts.has(entry.verdict));
  const avoid = all.filter(entry => negativeVerdicts.has(entry.verdict));
  const places = tastePlaceGroups(all);
  const overview = tasteFilter === 'all' && !tasteSearch.trim()
    ? `${tasteMemoryShelf('回购清单', '想再吃的味道', again.slice(0, 4), 'favorite')}${tasteMemoryShelf('避雷清单', '下次别再踩坑', avoid.slice(0, 4), 'warning')}${places.length ? `<section class="taste-section taste-place-section"><header><span><small>PLACE NOTEBOOK</small><h2>店铺档案</h2></span><em>${places.length} 家</em></header><div class="taste-place-grid">${places.slice(0, 8).map(tastePlaceCard).join('')}</div></section>` : ''}`
    : '';
  return `<section class="view taste-view">
    <header class="taste-header"><button id="taste-back" aria-label="返回 Mine"><span class="material-symbols-outlined">arrow_back</span></button><span><small>TASTE ARCHIVE</small><strong>味觉档案</strong><em>记住每一次好吃与避雷</em></span><button id="taste-new" aria-label="记录一次"><span class="material-symbols-outlined">add</span></button></header>
    <section class="taste-hero-paper"><div><span class="taste-hero-mark material-symbols-outlined">restaurant_menu</span><span><small>MY FLAVOR MEMORY</small><h2>吃过，就认真记住</h2><p>食物是主角，店铺会自动聚合成档案。</p></span></div><div class="taste-kpis"><span><b>${all.length}</b><small>吃过</small></span><span><b>${again.length}</b><small>想再吃</small></span><span><b>${places.length}</b><small>店铺</small></span></div></section>
    <section class="taste-controls-paper"><form id="taste-search-form" role="search"><span class="material-symbols-outlined">search</span><input name="search" value="${esc(tasteSearch)}" placeholder="搜索食物、品牌、店铺或标签" aria-label="搜索味觉档案"><button>查找</button></form><div class="taste-filter-rail" role="group" aria-label="味觉档案筛选">${[['all','全部'],['again','还想吃'],['place','店铺'],['snack','零食'],['avoid','避雷']].map(([value,label])=>`<button type="button" data-taste-filter="${value}" class="${tasteFilter===value?'active':''}" aria-pressed="${tasteFilter===value}">${label}</button>`).join('')}</div></section>
    ${overview}
    <section class="taste-section taste-history-section"><header><span><small>TASTING NOTES</small><h2>${tasteSearch || tasteFilter !== 'all' ? '筛选结果' : '最近吃过'}</h2></span><em>${entries.length} 条</em></header><div class="taste-entry-list">${entries.length ? entries.map(tasteEntryCard).join('') : tasteEmpty(all.length)}</div></section>
    <p class="taste-local-note"><span class="material-symbols-outlined">lock</span>照片、评分和评价仅保存在本机，并进入加密备份。</p>
  </section>`;
}

function tasteMemoryShelf(title, subtitle, entries, icon) {
  if (!entries.length) return '';
  return `<section class="taste-memory-shelf"><header><span class="material-symbols-outlined">${icon}</span><span><strong>${title}</strong><small>${subtitle}</small></span></header><div>${entries.map(entry => `<button type="button" data-open-taste="${entry.id}">${entry.photos?.[0] ? `<span class="taste-shelf-thumb photo-blur-frame is-edge">${photoFrameLayersHtml(imgSrc(entry.photos[0]), { alt: '', lazy: true })}</span>` : `<span class="material-symbols-outlined">${TASTE_TYPES[entry.type].icon}</span>`}<b>${esc(entry.name)}</b><small>${esc(TASTE_VERDICTS[entry.verdict].short)}</small></button>`).join('')}</div></section>`;
}

function tastePlaceCard(group) {
  return `<button type="button" class="taste-place-card" data-taste-place="${esc(group.name)}">${group.cover ? `<span class="taste-place-thumb photo-blur-frame is-edge">${photoFrameLayersHtml(imgSrc(group.cover), { alt: '', lazy: true })}</span>` : '<span class="material-symbols-outlined">storefront</span>'}<span><strong>${esc(group.name)}</strong><small>${group.entries.length} 次记录${group.averageRating ? ` · ${group.averageRating}分` : ''}</small><em>${group.favorites ? `${group.favorites} 个推荐` : '继续尝鲜'}${group.avoid ? ` · ${group.avoid} 个避雷` : ''}</em></span><i class="material-symbols-outlined">chevron_right</i></button>`;
}

function tasteEntryCard(entry) {
  const type = TASTE_TYPES[entry.type];
  const verdict = TASTE_VERDICTS[entry.verdict];
  const place = placeNameFor(entry) || entry.brand;
  return `<article class="taste-entry-card verdict-${entry.verdict}"><button type="button" class="taste-entry-open" data-open-taste="${entry.id}"><span class="taste-entry-photo photo-blur-frame is-edge">${entry.photos?.[0] ? photoFrameLayersHtml(imgSrc(entry.photos[0]), { alt: entry.name, lazy: true }) : `<span class="material-symbols-outlined">${type.icon}</span>`}<em>${esc(verdict.short)}</em></span><span class="taste-entry-copy"><small>${esc(type.label)} · ${entry.date}</small><strong>${esc(entry.name)}</strong><span class="taste-stars" aria-label="${entry.rating || 0}分">${ratingStars(entry.rating)}</span><p>${esc(place || entry.notes || '还没有补充店铺或评价')}</p>${entry.flavorTags.length ? `<i>${entry.flavorTags.slice(0,3).map(tag=>`#${esc(tag)}`).join(' ')}</i>` : ''}</span><span class="material-symbols-outlined">chevron_right</span></button></article>`;
}

function tasteEmpty(hasRecords) {
  return `<div class="taste-empty"><span class="material-symbols-outlined">${hasRecords ? 'search_off' : 'restaurant_menu'}</span><strong>${hasRecords ? '没有符合条件的记录' : '还没有味觉记忆'}</strong><p>${hasRecords ? '换个关键词或筛选条件试试。' : '记录第一样吃过的东西，以后就不会忘记它值不值得再来。'}</p><button type="button" id="taste-empty-new"><span class="material-symbols-outlined">add</span>记录一次</button></div>`;
}

export function tasteForm(entry = null) {
  const item = entry || makeTasteEntry({ date: dateKey(), verdict: 'again' });
  pendingTastePhotos = [...item.photos];
  modal(`<form id="taste-form"><input type="hidden" name="id" value="${entry ? item.id : ''}"><div class="modal-head"><div><span class="eyebrow">TASTING NOTE</span><h2>${entry ? '编辑味觉记录' : '记录这次味道'}</h2><p>先记“吃了什么”和“还想不想再吃”，其他信息都可以以后补。</p></div></div><div class="taste-photo-picker"><div id="taste-photo-preview">${tastePhotoPreview()}</div><button type="button" id="taste-pick-photos"><span class="material-symbols-outlined">add_photo_alternate</span>${pendingTastePhotos.length ? '继续添加照片' : '添加照片'}</button></div><div class="form-grid"><div><label>类型</label><select name="type">${Object.entries(TASTE_TYPES).map(([value,meta])=>`<option value="${value}" ${item.type===value?'selected':''}>${meta.label}</option>`).join('')}</select></div><div><label>日期</label><input name="date" type="date" required value="${item.date}"></div></div><label>吃了什么 / 店铺名称</label><input name="name" maxlength="80" required value="${esc(item.name)}" placeholder="例如：黑松露薯片、招牌牛肉面"><div class="form-grid"><div><label>店铺</label><input name="placeName" maxlength="80" value="${esc(item.placeName)}" placeholder="菜品来自哪家店"></div><div><label>品牌</label><input name="brand" maxlength="80" value="${esc(item.brand)}" placeholder="零食或饮料品牌"></div></div><label>以后还想吃吗？</label><div class="taste-verdict-picker">${Object.entries(TASTE_VERDICTS).map(([value,meta])=>`<label><input type="radio" name="verdict" value="${value}" ${item.verdict===value?'checked':''}><span><i class="material-symbols-outlined">${meta.icon}</i>${meta.label}</span></label>`).join('')}</div><div class="form-grid"><div><label>评分</label><select name="rating">${[[0,'暂不评分'],[1,'★'],[2,'★★'],[3,'★★★'],[4,'★★★★'],[5,'★★★★★']].map(([value,label])=>`<option value="${value}" ${item.rating===value?'selected':''}>${label}</option>`).join('')}</select></div><div><label>价格（可选）</label><input name="price" type="number" min="0" max="999999" step="0.01" value="${item.price || ''}" inputmode="decimal" placeholder="0.00"></div></div><details class="taste-more-fields"><summary>补充口味、地点和详细评价</summary><label>口味标签</label><input name="flavorTags" maxlength="240" value="${esc(item.flavorTags.join('、'))}" placeholder="甜、微辣、酥脆、分量足"><label>地点</label><input name="location" maxlength="120" value="${esc(item.location)}" placeholder="商场、校区或城市"><label>详细评价</label><textarea name="notes" maxlength="1200" rows="5" placeholder="好吃在哪里，或者为什么不推荐……">${esc(item.notes)}</textarea></details><div class="modal-actions">${entry ? '<button type="button" class="danger" id="taste-delete">删除</button>' : ''}<button type="button" data-close>取消</button><button class="save">保存记录</button></div></form>`, 'taste-form-modal');
  bindTasteForm(entry);
}

function tastePhotoPreview() {
  return pendingTastePhotos.length ? pendingTastePhotos.map((photo,index)=>`<span class="photo-blur-frame is-edge">${photoFrameLayersHtml(imgSrc(photo), { alt: `照片 ${index+1}` })}<button type="button" data-remove-taste-photo="${index}" aria-label="移除第 ${index+1} 张照片"><span class="material-symbols-outlined">close</span></button></span>`).join('') : '<p><span class="material-symbols-outlined">photo_camera</span><small>最多 6 张照片</small></p>';
}

function refreshTastePhotoPreview() {
  const preview = $('#taste-photo-preview');
  if (preview) preview.innerHTML = tastePhotoPreview();
  $$('[data-remove-taste-photo]').forEach(button => button.onclick = () => { pendingTastePhotos.splice(Number(button.dataset.removeTastePhoto),1); refreshTastePhotoPreview(); });
}

function bindTasteForm(existing) {
  $('#taste-pick-photos')?.addEventListener('click', () => pickTastePhotos().catch(error => show(error.message)));
  refreshTastePhotoPreview();
  $('#taste-delete')?.addEventListener('click', () => confirmDelete(`删除“${existing.name}”的味觉记录？`, () => deleteTasteEntry(existing.id)));
}

async function pickTastePhotos() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.multiple = true;
  const files = await new Promise(resolve => { input.onchange = () => resolve([...input.files || []]); input.oncancel = () => resolve([]); input.click(); });
  if (!files.length) return;
  if (files.some(file => !isSupportedJournalPhoto(file))) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (files.some(file => file.size > 20 * 1024 * 1024)) throw new Error('单张照片不能超过 20MB');
  const remaining = 6 - pendingTastePhotos.length;
  if (remaining <= 0) throw new Error('每条记录最多保存 6 张照片');
  const imported = await importPhotoBatch(files.slice(0, remaining), compressSnippetPhoto, { concurrency: 2 });
  pendingTastePhotos.push(...imported); refreshTastePhotoPreview();
  if (files.length > remaining) show(`已添加 ${remaining} 张，单条记录最多 6 张`);
}

async function saveTasteForm(data) {
  const id = String(data.get('id') || '');
  const existing = state.tasteEntries.find(entry => entry.id === id);
  const next = makeTasteEntry({ ...existing, id: existing?.id || crypto.randomUUID(), type:data.get('type'), name:data.get('name'), placeName:data.get('placeName'), brand:data.get('brand'), date:data.get('date'), rating:data.get('rating'), verdict:data.get('verdict'), price:data.get('price'), location:data.get('location'), flavorTags:String(data.get('flavorTags')||'').split(/[，,、]/), notes:data.get('notes'), photos:pendingTastePhotos, createdAt:existing?.createdAt, updatedAt:Date.now() });
  if (!next.name) throw new Error('请填写吃过的食物或店铺名称');
  existing ? Object.assign(existing,next) : state.tasteEntries.unshift(next);
  pendingTastePhotos=[]; await save(); closeModal(); render(); show('味觉记录已保存');
}

async function deleteTasteEntry(id) {
  state.tasteEntries = state.tasteEntries.filter(entry => entry.id !== id);
  pendingTastePhotos=[]; await save(); closeModal(); render(); show('味觉记录已删除');
}

function tasteDetail(entry) {
  if (!entry) return;
  const verdict=TASTE_VERDICTS[entry.verdict], type=TASTE_TYPES[entry.type], place=placeNameFor(entry)||entry.brand;
  modal(`<article class="taste-detail"><header><small>${esc(type.label)} · ${entry.date}</small><h2>${esc(entry.name)}</h2><span class="taste-detail-verdict verdict-${entry.verdict}"><i class="material-symbols-outlined">${verdict.icon}</i>${verdict.label}</span></header>${entry.photos.length?`<button type="button" class="taste-detail-gallery photo-blur-frame is-edge" id="taste-detail-gallery">${photoFrameLayersHtml(imgSrc(entry.photos[0]), { alt: entry.name })}<span>${entry.photos.length} 张照片</span></button>`:''}<div class="taste-detail-facts"><span><small>评分</small><strong>${ratingStars(entry.rating)}</strong></span>${place?`<span><small>店铺 / 品牌</small><strong>${esc(place)}</strong></span>`:''}${entry.price?`<span><small>价格</small><strong>¥${entry.price.toFixed(2)}</strong></span>`:''}${entry.location?`<span><small>地点</small><strong>${esc(entry.location)}</strong></span>`:''}</div>${entry.flavorTags.length?`<div class="taste-detail-tags">${entry.flavorTags.map(tag=>`<span>#${esc(tag)}</span>`).join('')}</div>`:''}<p>${esc(entry.notes||'还没有写详细评价。')}</p><div class="modal-actions"><button type="button" data-close>关闭</button><button type="button" class="save" id="taste-detail-edit">编辑</button></div></article>`, 'taste-detail-modal');
  $('#taste-detail-gallery')?.addEventListener('click',()=>photoViewer(entry.photos,0));
  $('#taste-detail-edit').onclick=()=>tasteForm(entry);
}

function bindTaste() {
  $('#taste-back')?.addEventListener('click',goBack);
  $('#taste-new')?.addEventListener('click',()=>tasteForm());
  $('#taste-empty-new')?.addEventListener('click',()=>tasteForm());
  $$('[data-taste-filter]').forEach(button=>button.onclick=()=>{tasteFilter=button.dataset.tasteFilter;render();});
  $$('[data-taste-place]').forEach(button=>button.onclick=()=>{tasteSearch=button.dataset.tastePlace;tasteFilter='all';render();});
  $$('[data-open-taste]').forEach(button=>button.onclick=()=>tasteDetail(state.tasteEntries.find(entry=>entry.id===button.dataset.openTaste)));
}

registerSubmitHandler('taste-search-form',async data=>{tasteSearch=String(data.get('search')||'').trim();render();return false;});
registerSubmitHandler('taste-form',async data=>{await saveTasteForm(data);return false;});
registerHelper('openTasteEntry',id=>tasteDetail(state.tasteEntries.find(entry=>entry.id===id)));
registerView('taste',tasteView);
registerBinder(bindTaste);
