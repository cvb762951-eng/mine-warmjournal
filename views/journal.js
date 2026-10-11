import { $, $$, esc, uid, state, selected, save, render, modal, closeModal, show, confirmDelete, imgSrc, emptyState, go, registerView, registerBinder, registerSubmitHandler, registerHelper, callHelper, setSelected, setCursor, JOURNAL_PHOTO_LIMIT, PHOTO_IMPORT_BATCH_LIMIT, subpageHeader } from '../core.js';
import { MOODS, WEATHERS, dateKey, snippetEntries, journalEntries, makeTodo, WEEK_DAYS, habitsForDate, habitProgressForDate, habitGoalMet, minutesOnDate } from '../model.js';
import { journalMeta, photoViewer, micButtonHtml, bindVoiceInput } from './common.js';
import { compressJournalPhoto, importPhotoBatch, isSupportedJournalPhoto } from '../photo-utils.js';
import { livePhotoMarkHtml, normalizeLivePhotos, photosWithLiveMotion } from '../motion-photo.js';
import { aiJournalGuide, aiSuggestStructure, applySuggestion } from '../ai.js';
import { journalDraftFor, recordJournalDraft, clearJournalDraft } from '../journal-drafts.js';

// ---- 本地状态 ----
let pendingJournalPhotos = [];
let pendingJournalLive = [];
let selectedSnippetIds = new Set();
let pendingJournalStructure = { tags: [], summary: '' };
let journalSuggestion = null;
let journalVoice = null;
let journalDraftSaveTimer = null;
let journalDraftSaveToken = 0;

function splitJournalContent(content) {
  const text = String(content || '');
  const title = text.match(/^《(.+?)》/)?.[1] || '';
  return { title, body: title ? text.replace(/^《.+?》\n\n?/, '') : text };
}

function journalSaveStatus(message, error = false) {
  for (const selector of ['#journal-save-status', '#journal-modal-save-status']) {
    const status = $(selector);
    if (!status) continue;
    status.textContent = message;
    status.classList.toggle('is-error', error);
  }
}

function cancelPendingJournalDraftSave() {
  clearTimeout(journalDraftSaveTimer);
  journalDraftSaveTimer = null;
  journalDraftSaveToken++;
}

function scheduleJournalDraftSave() {
  cancelPendingJournalDraftSave();
  const token = journalDraftSaveToken;
  journalDraftSaveTimer = setTimeout(async () => {
    journalDraftSaveTimer = null;
    try {
      await save();
      if (token === journalDraftSaveToken) journalSaveStatus('草稿已保存到本机 · 导出备份时会包含');
    } catch (error) {
      if (token === journalDraftSaveToken) {
        journalSaveStatus('草稿持久化失败，请重试保存', true);
        show(error.message);
      }
    }
  }, 700);
}

function stageJournalDraft(day, values) {
  const result = recordJournalDraft(state, day, values);
  journalSaveStatus(result.cached ? '草稿已暂存 · 正在同步本机数据' : '正在保存草稿，请勿退出', !result.cached);
  scheduleJournalDraftSave();
  return result.cached;
}

function stageModalJournalDraft(day) {
  const form = $('#journal-form');
  if (!form) return;
  const content = splitJournalContent(form.elements.content?.value || '');
  stageJournalDraft(day, { ...content, mood: form.elements.mood?.value || '', weather: form.elements.weather?.value || '', photos: [...pendingJournalPhotos], livePhotos: [...pendingJournalLive], tags: pendingJournalStructure.tags, summary: pendingJournalStructure.summary });
}
// 沉浸式写日记：body.journal-open 控制底部导航显隐；modal-layer 关闭时只移除 open 类不清 DOM，
// 因此监听 layer 的 class 变化来收尾移除 body 类（覆盖返回/取消/Esc/保存等所有关闭路径）。
let journalImmersiveWatchStarted = false;
function ensureJournalImmersiveWatch() {
  const layer = $('#modal-layer');
  if (!layer || journalImmersiveWatchStarted) return;
  journalImmersiveWatchStarted = true;
  new MutationObserver(() => {
    if (!layer.classList.contains('open')) document.body.classList.remove('journal-open');
  }).observe(layer, { attributes: true, attributeFilter: ['class'] });
}

export function journalForm(day) {
  journalVoice?.destroy();
  journalVoice = null;
  const journal = state.journals[day];
  const draft = journalDraftFor(state, day);
  pendingJournalPhotos = [...(draft?.photos || journal?.photos || [])];
  pendingJournalLive = normalizeLivePhotos(draft?.livePhotos || journal?.livePhotos || [], pendingJournalPhotos, JOURNAL_PHOTO_LIMIT);
  pendingJournalStructure = { tags: [...(draft?.tags || journal?.tags || [])], summary: draft?.summary || journal?.summary || '' };
  journalSuggestion = null;
  modal(`<form id="journal-form"><input type="hidden" name="date" value="${day}"><div class="journal-intro"><button type="button" id="journal-back" class="icon-button" aria-label="返回" data-close><span class="material-symbols-outlined">arrow_back</span></button><div><span class="eyebrow">DAILY MOMENT</span><h2>${day} 生活记录</h2></div><div class="journal-intro-actions"><button type="button" id="use-snippets" class="icon-button" aria-label="从随手记选素材"><span class="material-symbols-outlined">collections_bookmark</span></button></div></div><p class="subtle">记录此刻的情绪、天气和值得留下的画面。</p><fieldset class="journal-field"><legend><span>今天心情怎么样？</span><button type="button" data-clear-journal-choice="mood" aria-label="清除心情选择">清除</button></legend><div class="mood-picker">${Object.entries(MOODS).map(([key, item]) => `<label><input type="radio" name="mood" value="${key}" ${journal?.mood === key ? 'checked' : ''}><span><b>${item.symbol}</b><small>${item.label}</small></span></label>`).join('')}</div></fieldset><fieldset class="journal-field"><legend><span>今天的天气</span><button type="button" data-clear-journal-choice="weather" aria-label="清除天气选择">清除</button></legend><div class="weather-picker">${Object.entries(WEATHERS).map(([key, item]) => `<label><input type="radio" name="weather" value="${key}" ${journal?.weather === key ? 'checked' : ''}><span><i class="material-symbols-outlined" aria-hidden="true">${item.icon}</i><small>${item.label}</small></span></label>`).join('')}</div></fieldset><div class="journal-photo-head"><div><strong>照片</strong><small>一次最多 ${PHOTO_IMPORT_BATCH_LIMIT} 张，每篇最多 ${JOURNAL_PHOTO_LIMIT} 张</small></div><button type="button" id="add-journal-photos"><span class="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span>批量添加照片</button></div><div id="journal-photo-editor">${journalPhotoEditor()}</div><div class="journal-write-head"><label>写下今天</label><span class="journal-write-tools">${state.settings.aiApiKey ? `<button type="button" id="ai-journal-guide" class="ai-guide-btn"><span class="material-symbols-outlined">auto_awesome</span>AI 帮我起笔</button>` : ''}${micButtonHtml()}</span></div><textarea name="content" maxlength="4000" placeholder="发生了什么？此刻最想记住什么……">${esc(journal?.content || '')}</textarea>${aiStructureCard(day, journal)}<div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存日记</button></div></form>`, 'large-modal journal-modal');
  const form = $('#journal-form');
  if (draft && form) {
    form.elements.content.value = draft.title ? `《${draft.title}》\n\n${draft.body}` : draft.body;
    $$('input[name="mood"]', form).forEach(input => { input.checked = input.value === draft.mood; });
    $$('input[name="weather"]', form).forEach(input => { input.checked = input.value === draft.weather; });
  }
  const status = document.createElement('small');
  status.id = 'journal-modal-save-status';
  status.className = 'journal-modal-draft-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = draft ? '已恢复未提交草稿 · 点保存后写入正式日记' : '输入时自动保留草稿 · 点保存后写入正式日记';
  form?.querySelector('.modal-actions')?.before(status);
  form?.querySelector('textarea[name="content"]')?.addEventListener('input', () => stageModalJournalDraft(day));
  form?.addEventListener('change', event => { if (event.target.matches('input[name="mood"], input[name="weather"]')) stageModalJournalDraft(day); });
  document.body.classList.add('journal-open');
  ensureJournalImmersiveWatch();
  bindJournalPhotoEditor();
  bindJournalStructureActions(day);
  journalVoice = bindVoiceInput($('#journal-form'), { input: () => $('textarea[name="content"]', $('#journal-form')), onText: () => stageModalJournalDraft(day) });
  $('#journal-form [data-close]')?.addEventListener('click', () => { journalVoice?.destroy(); journalVoice = null; });
  $('#ai-journal-guide')?.addEventListener('click', async () => {
    const btn = $('#ai-journal-guide');
    const ta = $('textarea[name="content"]', $('#journal-form'));
    if (!btn || !ta) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>思考中…';
    try {
      const guide = await aiJournalGuide(state);
      const existing = ta.value.trim();
      ta.value = existing ? `${existing}\n\n${guide}` : guide;
      ta.dispatchEvent(new Event('input'));
      ta.focus();
      show('已生成引导，开始写吧');
    } catch (error) {
      show(error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>AI 帮我起笔';
    }
  });
  const ta = $('textarea[name="content"]', $('#journal-form'));
  if (ta) {
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.6) + 'px'; };
    grow();
    ta.addEventListener('input', grow);
    setTimeout(() => { ta.focus(); const len = ta.value.length; ta.setSelectionRange(len, len); }, 250);
  }
}

// ---- AI 结构化建议 ----
function aiStructureCard(day, journal) {
  const hasAccepted = pendingJournalStructure.tags.length || pendingJournalStructure.summary;
  if (hasAccepted) {
    return `<div class="ai-structure-card accepted"><div class="ai-structure-head"><span class="material-symbols-outlined">auto_awesome</span><div><strong>AI 整理已归档</strong><small>标签与摘要已保存，之后可随时编辑。</small></div></div>${pendingJournalStructure.tags.length ? `<div class="ai-structure-tags">${pendingJournalStructure.tags.map(tag => `<span class="ai-tag-chip read-only">#${esc(tag)}</span>`).join('')}</div>` : ''}${pendingJournalStructure.summary ? `<p class="ai-structure-summary-text">${esc(pendingJournalStructure.summary)}</p>` : ''}</div>`;
  }
  if (!state.settings.aiApiKey) {
    return `<div class="ai-structure-card off"><div class="ai-structure-head"><span class="material-symbols-outlined">auto_awesome</span><div><strong>AI 整理</strong><small>配置 AI 后可自动整理</small></div></div></div>`;
  }
  return `<div class="ai-structure-card"><div class="ai-structure-head"><span class="material-symbols-outlined">auto_awesome</span><div><strong>AI 整理</strong><small>标签 · 待办 · 一句话摘要</small></div></div><button type="button" id="ai-structure-run"><span class="material-symbols-outlined">auto_awesome</span>整理内容</button><div id="ai-structure-result"></div></div>`;
}

function bindJournalStructureActions(day) {
  $('#ai-structure-run')?.addEventListener('click', () => runJournalStructure(day).catch(error => show(error.message)));
  $('#ai-structure-result')?.addEventListener('click', event => bindJournalStructureApply(day, event));
}

async function runJournalStructure(day) {
  const content = ($('textarea[name="content"]', $('#journal-form'))?.value || '').trim();
  if (!content) return show('先写点内容，AI 才能帮你整理');
  const button = $('#ai-structure-run');
  button.disabled = true;
  button.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>整理中…';
  try {
    journalSuggestion = await aiSuggestStructure(state, { source: 'journal', content });
    const result = $('#ai-structure-result');
    const suggestion = journalSuggestion;
    if (!suggestion || (!suggestion.tags.length && !suggestion.todos.length && !suggestion.summary)) {
      result.innerHTML = '<p class="ai-structure-fail">暂时没有可以整理的内容。</p>';
      return;
    }
    result.innerHTML = `<div class="ai-structure-group">${suggestion.tags.length ? `<div class="ai-structure-group-head"><span class="material-symbols-outlined">sell</span><div><strong>标签建议</strong><small>点击选择要采纳的标签</small></div></div><div class="ai-structure-tags">${suggestion.tags.map(tag => `<button type="button" class="ai-tag-chip active" data-ai-tag="${esc(tag)}">#${esc(tag)}</button>`).join('')}</div><div class="ai-structure-actions"><button type="button" class="ai-structure-apply" data-ai-apply-tags>采纳选中</button></div>` : ''}</div>${suggestion.todos.length ? `<div class="ai-structure-group">${suggestion.todos.map(todo => `<label class="ai-todo-row"><input type="checkbox" value="${esc(todo)}" checked><span><b>${esc(todo)}</b><small>会加入待办清单</small></span></label>`).join('')}<div class="ai-structure-actions"><button type="button" class="ai-structure-apply" data-ai-apply-todos>创建待办</button></div></div>` : ''}${suggestion.summary ? `<div class="ai-structure-group"><div class="ai-structure-group-head"><span class="material-symbols-outlined">notes</span><div><strong>一句话摘要</strong><small>保存到这篇日记</small></div></div><p class="ai-structure-summary-text">${esc(suggestion.summary)}</p><div class="ai-structure-actions"><button type="button" class="ai-structure-apply" data-ai-apply-summary>采纳摘要</button></div></div>` : ''}<div class="ai-structure-footer"><button type="button" id="ai-structure-all">全部采纳</button></div>`;
  } catch {
    journalSuggestion = null;
    const result = $('#ai-structure-result');
    if (result) result.innerHTML = '<p class="ai-structure-fail">整理失败，稍后再试。</p>';
  } finally {
    button.disabled = false;
    button.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span>整理内容';
  }
}

function bindJournalStructureApply(day, event) {
  const target = event.target;
  const result = $('#ai-structure-result');
  if (!result) return;
  const suggestion = journalSuggestion || {};
  if (target.dataset.aiTag !== undefined) {
    const chip = $(`[data-ai-tag="${target.dataset.aiTag}"]`, result);
    if (chip) chip.classList.toggle('active');
    return;
  }
  if (target.dataset.aiApplyTags !== undefined || target.dataset.aiApplyTodos !== undefined || target.dataset.aiApplySummary !== undefined || target.id === 'ai-structure-all') {    const all = target.id === 'ai-structure-all';
    adoptJournalStructure(day, {
      tags: target.dataset.aiApplyTags !== undefined || all ? [...$$('[data-ai-tag].active', result)].map(chip => chip.dataset.aiTag) : [],
      todos: target.dataset.aiApplyTodos !== undefined || all ? [...$$('.ai-todo-row input:checked', result)].map(input => input.value) : [],
      summary: target.dataset.aiApplySummary !== undefined || all ? suggestion.summary || '' : ''
    });
  }
}

async function adoptJournalStructure(day, { tags = [], todos = [], summary = '' } = {}) {
  if (tags.length) {
    pendingJournalStructure.tags = [...new Set([...pendingJournalStructure.tags, ...tags])].slice(0, 8);
    show(`已采纳 ${tags.length} 个标签`);
  }
  if (summary) {
    pendingJournalStructure.summary = String(summary).trim().slice(0, 120);
    show('已采纳摘要');
  }
  let created = 0;
  if (todos.length) {
    for (const title of todos) {
      const clean = String(title).trim().slice(0, 80);
      if (!clean) continue;
      if (state.todos.some(todo => !todo.completed && todo.title === clean)) continue;
      state.todos.push(makeTodo({ title: clean, date: day, createdAt: Date.now() }));
      created += 1;
    }
    if (created) show(`已创建 ${created} 条待办`);
  }
  if (summary || todos.length) applySuggestion(state, { summary, todos });
  stageModalJournalDraft(day);
  cancelPendingJournalDraftSave();
  await save();
  const result = $('#ai-structure-result');
  if (result) {
    if (tags.length) {
      const apply = result.querySelector('[data-ai-apply-tags]');
      if (apply) { apply.disabled = true; apply.textContent = '已采纳'; }
      $$('[data-ai-tag]', result).forEach(chip => chip.classList.remove('active'));
    }
    if (todos.length) {
      const apply = result.querySelector('[data-ai-apply-todos]');
      if (apply) { apply.disabled = true; apply.textContent = '已创建'; }
    }
    if (summary) {
      const apply = result.querySelector('[data-ai-apply-summary]');
      if (apply) { apply.disabled = true; apply.textContent = '已采纳'; }
    }
    const all = $('#ai-structure-all', result);
    if (all) {
      all.disabled = !result.querySelector('.ai-structure-apply:not([disabled])');
      all.textContent = '已全部采纳';
    }
  }
}

function journalPhotoEditor() {
  return pendingJournalPhotos.length ? `<div class="journal-photo-editor">${pendingJournalPhotos.map((photo, index) => `<div><img src="${imgSrc(photo)}" alt="待保存照片 ${index + 1}">${journalLiveMark(photo, pendingJournalLive)}<button type="button" data-remove-journal-photo="${index}" aria-label="删除第 ${index + 1} 张照片"><span class="material-symbols-outlined" aria-hidden="true">close</span></button></div>`).join('')}</div>` : '<div class="journal-photo-empty"><span class="journal-photo-empty-icon"><span class="material-symbols-outlined" aria-hidden="true">photo_library</span></span><strong>还没有添加照片</strong><small>把今天值得记住的画面放在这里</small></div>';
}

function bindJournalPhotoEditor() {
  const addButton = $('#add-journal-photos');
  if (addButton) {
    addButton.disabled = pendingJournalPhotos.length >= JOURNAL_PHOTO_LIMIT;
    addButton.onclick = () => pickJournalPhotos().catch(error => show(error.message));
  }
  $('#use-snippets')?.addEventListener('click', openSnippetPicker);
  $$('[data-remove-journal-photo]').forEach(button => button.onclick = () => {
    const index = Number(button.dataset.removeJournalPhoto);
    const removed = pendingJournalPhotos[index];
    pendingJournalPhotos.splice(index, 1);
    pendingJournalLive = pendingJournalLive.filter(item => item.still !== removed);
    refreshJournalPhotos();
    stageModalJournalDraft($('#journal-form [name="date"]')?.value);
  });
  $$('[data-clear-journal-choice]').forEach(button => button.onclick = () => {
    const choice = $(`[name="${button.dataset.clearJournalChoice}"]:checked`, $('#journal-form'));
    if (choice) choice.checked = false;
    stageModalJournalDraft($('#journal-form [name="date"]')?.value);
  });
}

function openSnippetPicker() {
  const form = $('#journal-form');
  if (!form) return;
  const draft = new FormData(form);
  const draftPhotos = [...pendingJournalPhotos];
  const entries = snippetEntries(state);
  selectedSnippetIds = new Set();
  modal(`<div class="modal-head"><div><h2>选择随手记素材</h2><p>文字会追加到正文，照片会加入照片区。</p></div></div><div class="snippet-picker">${entries.map(entry => `<label><input type="checkbox" value="${entry.id}" data-snippet-choice><span>${entry.photo ? `<img src="${imgSrc(entry.photo)}" alt="随手拍">` : '<i class="material-symbols-outlined">edit_note</i>'}<b>${esc(entry.text || '一张照片')}</b><small>${entry.date}</small></span></label>`).join('') || emptyState('还没有素材', '先去首页添加随手记或随手拍。')}</div><div class="modal-actions"><button type="button" id="back-to-journal">返回日记</button><button type="button" class="save" id="import-snippets" ${entries.length ? '' : 'disabled'}>加入日记</button></div>`, 'large-modal snippet-picker-modal');
  $$('[data-snippet-choice]').forEach(input => input.onchange = () => input.checked ? selectedSnippetIds.add(input.value) : selectedSnippetIds.delete(input.value));
  $('#back-to-journal').onclick = () => reopenJournalWithDraft(draft, '', draftPhotos);
  $('#import-snippets').onclick = () => importSnippetsIntoJournal(draft, draftPhotos);
}

function reopenJournalWithDraft(draft, extraText = '', photos = [], livePhotos = null) {
  const day = draft.get('date');
  journalForm(day);
  const form = $('#journal-form');
  const mood = draft.get('mood'), weather = draft.get('weather');
  if (mood) form.elements.mood.value = mood;
  if (weather) form.elements.weather.value = weather;
  form.elements.content.value = [draft.get('content')?.trim(), extraText].filter(Boolean).join('\n\n');
  form.elements.content.dispatchEvent(new Event('input', { bubbles: true }));
  pendingJournalPhotos = [...photos];
  if (livePhotos) pendingJournalLive = normalizeLivePhotos(livePhotos, pendingJournalPhotos, JOURNAL_PHOTO_LIMIT);
  refreshJournalPhotos();
}

function importSnippetsIntoJournal(draft, draftPhotos) {
  const chosen = state.snippets.filter(entry => selectedSnippetIds.has(entry.id));
  const text = chosen.filter(entry => entry.type === 'text').map(entry => entry.text).filter(Boolean).join('\n\n');
  const photos = chosen.filter(entry => entry.type === 'photo').flatMap(entry => entry.photos?.length ? entry.photos : (entry.photo ? [entry.photo] : []));
  const uniquePhotos = [...new Set([...draftPhotos, ...photos])];
  if (uniquePhotos.length > JOURNAL_PHOTO_LIMIT) return show(`每篇日记最多 ${JOURNAL_PHOTO_LIMIT} 张照片，本次会达到 ${uniquePhotos.length} 张`);
  const livePhotos = normalizeLivePhotos([...(pendingJournalLive || []), ...chosen.flatMap(entry => entry.livePhotos || [])], uniquePhotos, JOURNAL_PHOTO_LIMIT);
  reopenJournalWithDraft(draft, text, uniquePhotos, livePhotos);
  show(`已加入 ${chosen.length} 条素材`);
}

function refreshJournalPhotos() {
  const editor = $('#journal-photo-editor');
  if (!editor) return;
  editor.innerHTML = journalPhotoEditor();
  bindJournalPhotoEditor();
}

function pickJournalPhotos() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.multiple = true;
    input.onchange = async () => {
      try {
        const files = [...(input.files || [])];
        if (!files.length) return resolve();
        if (files.length > PHOTO_IMPORT_BATCH_LIMIT) throw new Error(`一次最多选择 ${PHOTO_IMPORT_BATCH_LIMIT} 张照片，请分批添加`);
        if (pendingJournalPhotos.length + files.length > JOURNAL_PHOTO_LIMIT) throw new Error(`每篇日记最多添加 ${JOURNAL_PHOTO_LIMIT} 张照片`);
        if (files.some(file => !isSupportedJournalPhoto(file))) throw new Error('仅支持 JPG、PNG 或 WebP 图片');
        show(`正在处理 ${files.length} 张照片…`);
        let liveAdded = 0;
        const compressed = await importPhotoBatch(files, compressJournalPhoto, { onLivePhoto: (still, video) => { pendingJournalLive.push({ still, video }); liveAdded += 1; } });
        pendingJournalPhotos.push(...compressed); refreshJournalPhotos(); stageModalJournalDraft($('#journal-form [name="date"]')?.value); show(`已加入 ${compressed.length} 张照片${liveAdded ? `，${liveAdded} 张实况仍可播放` : ''}`); resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

export function journalHistory(search = '') {
  const entries = journalEntries(state, search);
  modal(`<div class="modal-head"><div><span class="eyebrow">JOURNAL ARCHIVE</span><h2>日记历史</h2><p>按日期、正文、心情或天气寻找一篇生活志。</p></div><button type="button" class="icon-button" data-close aria-label="关闭日记历史"><span class="material-symbols-outlined">close</span></button></div><form id="journal-search" class="search-row"><input name="search" value="${esc(search)}" placeholder="搜索日记"><button class="icon-button" aria-label="搜索"><span class="material-symbols-outlined">search</span></button></form><div class="journal-history rich-history">${entries.map(entry => `<button type="button" data-open-journal="${entry.date}"><div><strong>${entry.date}</strong><span class="journal-meta">${journalMeta(entry)}</span></div>${entry.photos?.[0] ? `<img src="${imgSrc(entry.photos[0])}" alt="${entry.date} 日记照片">` : '<span class="journal-history-no-photo material-symbols-outlined">history_edu</span>'}<p>${esc(entry.content || `${entry.photos?.length || 0} 张照片`)}</p></button>`).join('') || emptyState('没有匹配的日记', '换一个关键词试试。')}</div>`, 'large-modal journal-history-modal');
  $$('[data-open-journal]').forEach(button => button.onclick = onPastJournalClick);
}

// ---- 绑定 ----
function bindJournal() {
  $('#write')?.addEventListener('click', () => journalForm(selected));
  $('#write-empty')?.addEventListener('click', () => journalForm(selected));
  $('#journal-history')?.addEventListener('click', () => journalHistory());
  $('#journal-history-mine')?.addEventListener('click', () => journalHistory());
  $$('[data-edit-journal]').forEach(button => button.onclick = () => journalForm(button.dataset.editJournal));
  $$('[data-delete-journal]').forEach(button => button.onclick = () => confirmDelete('删除这篇日记？', async () => { delete state.journals[button.dataset.deleteJournal]; await save(); render(); callHelper('scheduleAiRefresh'); }));
  $$('[data-view-photo]').forEach(button => button.onclick = () => {
    const entry = state.journals[selected];
    photoViewer(photosWithLiveMotion(entry?.photos || [], entry?.livePhotos), Number(button.dataset.viewPhoto));
  });
}

// ---- 表单提交 ----
registerSubmitHandler('journal-form', async data => {
  const day = data.get('date');
  const content = data.get('content').trim(), mood = data.get('mood') || '', weather = data.get('weather') || '';
  if (!content && !mood && !weather && !pendingJournalPhotos.length) throw new Error('请至少记录正文、心情、天气或一张照片');
  const previousJournal = state.journals[day] ? structuredClone(state.journals[day]) : null;
  const previousDraft = state.settings.journalDrafts?.[day] ? structuredClone(state.settings.journalDrafts[day]) : null;
  const rollbackJournal = () => previousJournal ? state.journals[day] = previousJournal : delete state.journals[day];
  cancelPendingJournalDraftSave();
  try {
    const photos = [...pendingJournalPhotos];
    const livePhotos = normalizeLivePhotos(pendingJournalLive, photos, JOURNAL_PHOTO_LIMIT);
    state.journals[day] = { ...previousJournal, content, mood, weather, photos, tags: pendingJournalStructure.tags, summary: pendingJournalStructure.summary, updatedAt: Math.max(Date.now(), Number(previousDraft?.updatedAt || 0) + 1) };
    if (livePhotos.length) state.journals[day].livePhotos = livePhotos;
    else delete state.journals[day].livePhotos;
    clearJournalDraft(state, day, { keepCache: true });
    await save();
  } catch (error) {
    rollbackJournal();
    if (previousDraft) state.settings.journalDrafts[day] = previousDraft;
    throw error;
  }
  clearJournalDraft(state, day);
  setSelected(day); setCursor(new Date(`${day}T12:00:00`));
  journalVoice?.destroy();
  journalVoice = null;
  pendingJournalPhotos = [];
  pendingJournalLive = [];
  selectedSnippetIds.clear();
  closeModal(); render(); show('正式日记已保存');
  callHelper('scheduleAiRefresh');
  return false;
});

registerSubmitHandler('journal-search', async data => {
  journalHistory(data.get('search'));
  return false;
});

registerBinder(bindJournal);

// ---- 生活志日记屏（原型 #screen-journal：画报编辑台 + 过往篇章）----
let journalDraftMood = '';
let journalDraftWeather = '';
let journalEditingDay = dateKey();

function setJournalEditingDay(day) {
  const normalized = String(day || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return;
  journalEditingDay = normalized;
  setSelected(normalized);
  setCursor(new Date(`${normalized}T12:00:00`));
}

function stageJournalScreenDraft(day = journalEditingDay) {
  const title = $('#journal-title-input')?.value || '';
  const body = $('#journal-content-input')?.value || '';
  const entry = state.journals?.[day];
  const stored = splitJournalContent(entry?.content || '');
  const previousDraft = journalDraftFor(state, day);
  const photos = previousDraft?.photos || entry?.photos || [];
  const livePhotos = previousDraft?.livePhotos || entry?.livePhotos || [];
  const tags = previousDraft?.tags || entry?.tags || [];
  const summary = previousDraft?.summary || entry?.summary || '';
  const unchanged = title === stored.title && body === stored.body
    && journalDraftMood === (entry?.mood || '') && journalDraftWeather === (entry?.weather || '')
    && photos.length === (entry?.photos || []).length && photos.every((photo, index) => photo === entry.photos[index])
    && tags.length === (entry?.tags || []).length && tags.every((tag, index) => tag === entry.tags[index])
    && summary === (entry?.summary || '');
  if (unchanged) {
    clearJournalDraft(state, day);
    journalSaveStatus(entry ? '正式日记已保存' : '输入后自动保留草稿');
    scheduleJournalDraftSave();
    return true;
  }
  return stageJournalDraft(day, { title, body, mood: journalDraftMood, weather: journalDraftWeather, photos, livePhotos, tags, summary });
}

function formatJournalText(text) {
  const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
  return lines.join('\n\n');
}

// Journal 主页面的“添加照片”直接进入系统选图，不重新打开写日记 Modal。
function addPhotosToJournal(day) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.multiple = true;
    input.onchange = async () => {
      try {
        const files = [...(input.files || [])];
        if (!files.length) return resolve();
        const previous = state.journals?.[day];
        const draft = journalDraftFor(state, day);
        const existingPhotos = draft?.photos || previous?.photos || [];
        if (files.length > PHOTO_IMPORT_BATCH_LIMIT) throw new Error(`一次最多选择 ${PHOTO_IMPORT_BATCH_LIMIT} 张照片，请分批添加`);
        if (existingPhotos.length + files.length > JOURNAL_PHOTO_LIMIT) throw new Error(`每篇日记最多添加 ${JOURNAL_PHOTO_LIMIT} 张照片`);
        if (files.some(file => !isSupportedJournalPhoto(file))) throw new Error('仅支持 JPG、PNG 或 WebP 图片');
        show(`正在处理 ${files.length} 张照片…`);
        const livePhotos = [...(draft?.livePhotos || previous?.livePhotos || [])];
        let liveAdded = 0;
        const compressed = await importPhotoBatch(files, compressJournalPhoto, { onLivePhoto: (still, video) => { livePhotos.push({ still, video }); liveAdded += 1; } });
        const photos = [...existingPhotos, ...compressed];
        recordJournalDraft(state, day, {
          title: $('#journal-title-input')?.value || draft?.title || '',
          body: $('#journal-content-input')?.value || draft?.body || '',
          mood: journalDraftMood,
          weather: journalDraftWeather,
          photos,
          livePhotos: normalizeLivePhotos(livePhotos, photos, JOURNAL_PHOTO_LIMIT),
          tags: draft?.tags || previous?.tags || [],
          summary: draft?.summary || previous?.summary || ''
        });
        cancelPendingJournalDraftSave();
        await save(); render(); show(`已加入草稿 ${compressed.length} 张照片${liveAdded ? `，${liveAdded} 张实况仍可播放` : ''}`); resolve();
      } catch (error) { reject(error); }
    };
    input.click();
  });
}

function journalFootprints(day) {
  const habits = habitsForDate(state, day);
  const completed = habits.filter(habit => habitGoalMet(habit, habitProgressForDate(state, habit, day))).length;
  const ledger = callHelper('ledgerSummary', new Date(`${day}T12:00:00`));
  return { completed, total: habits.length, minutes: minutesOnDate(state, day), spend: Number(ledger?.todayExpense || 0) };
}

function romanDate(day) {
  const roman = value => { const map=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]; let result=''; for(const [number,symbol] of map){while(value>=number){result+=symbol;value-=number;}} return result; };
  const date = new Date(`${day}T12:00:00`);
  return `${roman(date.getDate())} · ${roman(date.getMonth() + 1)} · ${roman(date.getFullYear())}`;
}

function journalLiveMark(still, livePhotos) {
  return (livePhotos || []).some(item => item?.still === still && item?.video) ? livePhotoMarkHtml() : '';
}

function journalPhotoWall(photos = [], day = dateKey(), livePhotos = []) {
  return `<div class="journal-photo-wall">${photos.map((photo,index) => `<button type="button" class="journal-polaroid-frame" data-view-journal-screen-photo="${index}" aria-label="查看第 ${index + 1} 张日记照片"><img src="${imgSrc(photo)}" alt="${day} 日记照片 ${index + 1}">${journalLiveMark(photo, livePhotos)}</button>`).join('')}<button type="button" class="journal-add-polaroid-btn" id="journal-add-screen-photo"><span class="material-symbols-outlined">photo_camera</span><span>添加相片</span></button></div>`;
}

function journalSnippetPicker(day) {
  const entries = (state.snippets || []).filter(entry => entry?.date === day).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 12);
  const dateLabel = `${day.slice(5, 7)}月${day.slice(8, 10)}日`;
  if (!entries.length) return `<section class="journal-inline-snippet-picker" id="journal-inline-snippet-picker" hidden><div class="journal-inline-snippet-empty"><span class="material-symbols-outlined">collections_bookmark</span><strong>${dateLabel}还没有素材</strong><small>只有这一天的随手拍和随手记会显示在这里。</small></div></section>`;
  return `<section class="journal-inline-snippet-picker" id="journal-inline-snippet-picker" hidden><div class="journal-inline-snippet-head"><div><span class="eyebrow">FROM YOUR MOMENTS</span><strong>选择 ${dateLabel} 的素材</strong><small>这里只显示所写日期的素材；文字追加到正文，照片加入照片墙。</small></div><button type="button" class="icon-button" id="journal-inline-snippet-close" aria-label="关闭素材选择"><span class="material-symbols-outlined">close</span></button></div><div class="journal-inline-snippet-list">${entries.map(entry => { const isPhoto = entry.type === 'photo'; const photo = isPhoto ? (entry.photos?.[0] || entry.photo) : ''; return `<label class="journal-inline-snippet-item"><input type="checkbox" data-journal-snippet="${esc(entry.id)}"><span class="journal-inline-snippet-thumb">${photo ? `<img src="${imgSrc(photo)}" alt="">` : '<span class="material-symbols-outlined">edit_note</span>'}</span><span class="journal-inline-snippet-copy"><strong>${esc(isPhoto ? (entry.text || '随手拍') : (entry.text || '随手记'))}</strong><small>${isPhoto ? `随手拍 · ${entry.photos?.length || (entry.photo ? 1 : 0)} 张` : '随手记'} · ${esc(entry.date)}</small></span><span class="material-symbols-outlined journal-inline-snippet-check">check_circle</span></label>`; }).join('')}</div><button type="button" class="journal-inline-snippet-apply" id="journal-inline-snippet-apply">把选中素材加入 ${dateLabel} 日记</button></section>`;
}

async function applyInlineSnippets(day) {
  const panel = $('#journal-inline-snippet-picker');
  const ids = $$('[data-journal-snippet]', panel).filter(input => input.checked).map(input => input.dataset.journalSnippet);
  const entries = ids.map(id => state.snippets.find(entry => entry.id === id)).filter(Boolean);
  if (!entries.length) return show('先选择一条素材');
  const textParts = entries.filter(entry => entry.type !== 'photo').map(entry => String(entry.text || '').trim()).filter(Boolean);
  const input = $('#journal-content-input');
  if (input && textParts.length) {
    input.value = [input.value.trim(), ...textParts].filter(Boolean).join('\n\n');
    input.dispatchEvent(new Event('input'));
  }
  const photos = entries.filter(entry => entry.type === 'photo').flatMap(entry => entry.photos?.length ? entry.photos : (entry.photo ? [entry.photo] : [])).filter(Boolean);
  if (photos.length) {
    const previous = state.journals?.[day] ? structuredClone(state.journals[day]) : { content: '', mood: '', weather: '', photos: [], tags: [], summary: '' };
    const existingPhotos = Array.isArray(previous.photos) ? previous.photos : [];
    if (existingPhotos.length + photos.length > JOURNAL_PHOTO_LIMIT) return show(`每篇日记最多添加 ${JOURNAL_PHOTO_LIMIT} 张照片`);
    const mergedPhotos = [...existingPhotos, ...photos];
    const livePhotos = normalizeLivePhotos([...(previous.livePhotos || []), ...entries.flatMap(entry => entry.livePhotos || [])], mergedPhotos, JOURNAL_PHOTO_LIMIT);
    state.journals[day] = { ...previous, photos: mergedPhotos, updatedAt: Date.now() };
    if (livePhotos.length) state.journals[day].livePhotos = livePhotos;
    else delete state.journals[day].livePhotos;
    const openDraft = journalDraftFor(state, day);
    if (openDraft) recordJournalDraft(state, day, { ...openDraft, photos: mergedPhotos, livePhotos });
    const title = $('#journal-title-input')?.value || '';
    const body = $('#journal-content-input')?.value || '';
    await save();
    render();
    requestAnimationFrame(() => { if ($('#journal-title-input')) $('#journal-title-input').value = title; if ($('#journal-content-input')) { $('#journal-content-input').value = body; $('#journal-content-input').dispatchEvent(new Event('input')); } });
  }
  if (panel) panel.hidden = true;
  show(`已加入 ${entries.length} 条素材`);
}

function openJournalReader(day) {
  const entry = state.journals[day];
  if (!entry || !entry.content?.trim()) return show('这篇日记还没有正文，暂时无法排成画报');
  const title = entry.content.match(/^《(.+?)》/)?.[1] || `${day} 的生活志`;
  const body = entry.content.replace(/^《.+?》\n\n?/, '').trim();
  const paragraphs = body.split(/\n{2,}/).filter(Boolean);
  const footprints = journalFootprints(day);
  const photos = entry.photos || [];
  const photoHtml = photos.length ? `<section class="journal-reader-gallery"><header><span><strong>这一天的照片</strong><small>${photos.length} 张 · 点击查看完整画面</small></span><span class="material-symbols-outlined" aria-hidden="true">photo_library</span></header><div>${photos.map((photo, index) => `<button type="button" data-view-journal-reader-photo="${index}" aria-label="查看第 ${index + 1} 张照片，共 ${photos.length} 张"><img src="${imgSrc(photo)}" alt="${esc(title)} 配图 ${index + 1}" loading="lazy">${journalLiveMark(photo, entry.livePhotos)}</button>`).join('')}</div></section>` : '';
  const lead = paragraphs[0] || '';
  const rest = paragraphs.slice(1);
  const quoteHtml = entry.summary?.trim() ? `<aside class="journal-reader-quote">${esc(entry.summary.trim())}</aside>` : '';
  const html = `<div class="journal-reader-page">${subpageHeader('生活志画报阅读')}
    <article class="journal-reader-article">
      <header class="journal-reader-hero">
        <div><span class="journal-reader-kicker">${day} · 星期${WEEK_DAYS[new Date(`${day}T12:00:00`).getDay()]}</span><small>ISSUE · ${romanDate(day)}</small></div>
        <span class="journal-roman-badge">${romanDate(day)}</span>
        <h1 class="journal-reader-title">${esc(title)}</h1>
        <div class="journal-reader-meta">${entry.mood ? esc(MOODS[entry.mood]?.symbol + ' ' + MOODS[entry.mood]?.label) : '心情未记'} · ${entry.weather ? esc(WEATHERS[entry.weather]?.label || entry.weather) : '天气未记'}</div>
      </header>
      ${photoHtml}
      <div class="journal-reader-paper">
        <span class="journal-reader-lead-mark">OPENING NOTE</span>
        <p class="drop-cap-p">${esc(lead)}</p>
        ${rest.map((paragraph, index) => `<section class="journal-reader-section"><span class="journal-reader-roman">${['II', 'III', 'IV', 'V'][index] || 'VI'}</span><p>${esc(paragraph)}</p></section>`).join('')}
        ${quoteHtml}
      </div>
      <footer class="journal-reader-footprints">
        <span><small>习惯</small><strong>${footprints.completed}/${footprints.total}</strong></span>
        <span><small>专注</small><strong>${footprints.minutes} <em>分钟</em></strong></span>
        <span><small>支出</small><strong>¥${footprints.spend.toFixed(2)}</strong></span>
      </footer>
      <button type="button" class="journal-reader-edit" id="journal-reader-edit"><span class="material-symbols-outlined" aria-hidden="true">edit_note</span><span>编辑这篇日记</span></button>
    </article>
  </div>`;
  callHelper('openSubpage', 'subpage-journal-reader', html);
  $('#journal-reader-edit')?.addEventListener('click', () => journalForm(day));
  $$('[data-view-journal-reader-photo]').forEach(button => button.onclick = () => photoViewer(photosWithLiveMotion(photos, entry.livePhotos), Number(button.dataset.viewJournalReaderPhoto)));
}

// 过往篇章和日记历史：有正文就开画报阅读，没有正文就进入这一天的编辑页。
// 不改已保存的日记；从编辑页改去别的日期前，先把当前输入收成草稿。
function openPastJournal(day) {
  const normalized = String(day || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || !state.journals?.[normalized]) return;
  if (state.journals[normalized].content?.trim()) {
    openJournalReader(normalized);
    return;
  }
  if (state.route === 'journal' && normalized === journalEditingDay) return;
  if (state.route === 'journal' && !stageJournalScreenDraft(journalEditingDay)) {
    show('草稿还未安全暂存，请先保存后再打开其他日期');
    return;
  }
  setJournalEditingDay(normalized);
  if (state.route === 'journal') render();
  else go('journal');
}

function onPastJournalClick(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = event.currentTarget;
  if (button?.closest('#modal-layer')) closeModal();
  openPastJournal(button?.dataset?.openJournal);
}

export function journalView() {
  const day = journalEditingDay;
  const journalEntry = state.journals[day];
  const restoredDraft = journalDraftFor(state, day);
  journalDraftMood = restoredDraft?.mood ?? journalEntry?.mood ?? '';
  journalDraftWeather = restoredDraft?.weather ?? journalEntry?.weather ?? '';
  const entries = Object.entries(state.journals)
    .map(([date, entry]) => ({ date, ...entry }))
    .filter(entry => entry.date !== day)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 3);
  const totalCount = Object.keys(state.journals).length;
  const stored = splitJournalContent(journalEntry?.content || '');
  const journalTitle = restoredDraft?.title ?? stored.title;
  const bodyText = restoredDraft?.body ?? stored.body;
  const currentPhotos = restoredDraft?.photos || journalEntry?.photos || [];
  const currentLive = restoredDraft?.livePhotos || journalEntry?.livePhotos || [];
  const dayLabel = `${day} · 星期${WEEK_DAYS[new Date(`${day}T12:00:00`).getDay()]}`;
  return `<section class="view journal-view" id="screen-journal">
    <header class="subpage-header"><div class="subpage-title">Mine Journal</div><div class="subpage-subtitle">Daily Moment · 暖色生活手记</div><span class="journal-corner-note" aria-hidden="true">Write<br>A Better<br>Me<br>Everyday.</span></header>
    <div class="journal-magazine-hero-box">
      <div class="journal-hero-top-row"><div><span class="journal-date-large">${dayLabel}</span><label class="journal-date-control"><span class="material-symbols-outlined">event</span><span>补写或修改日期</span><input type="date" id="journal-date-input" value="${day}" max="${dateKey()}" aria-label="选择日记日期"></label></div><span class="journal-roman-badge">${romanDate(day)}</span></div>
      <div class="journal-env-meta"><span><i class="material-symbols-outlined">location_on</i>本地生活记录</span><span><i class="material-symbols-outlined">${journalDraftWeather ? WEATHERS[journalDraftWeather]?.icon || 'cloud' : 'cloud'}</i>${journalDraftWeather ? esc(WEATHERS[journalDraftWeather]?.label || journalDraftWeather) : '天气未记录'}</span><span><i class="material-symbols-outlined">favorite</i>${journalDraftMood ? `${MOODS[journalDraftMood]?.symbol} ${esc(MOODS[journalDraftMood]?.label)}` : '心情未记录'}</span></div>
      <div class="picker-section-label"><span>这一天的心情与能量</span><small data-clear-journal-draft="mood">重选</small></div>
      <div class="mood-grid-picker">${Object.entries(MOODS).map(([key, item]) => `<button type="button" class="mood-pick-item ${journalDraftMood === key ? 'active' : ''}" data-draft-mood="${key}"><span>${item.symbol}</span><small>${item.label}</small></button>`).join('')}</div>
      <div class="picker-section-label"><span>天候与环境氛围</span><small data-clear-journal-draft="weather">重选</small></div>
      <div class="weather-grid-picker">${Object.entries(WEATHERS).map(([key, item]) => `<button type="button" class="weather-pick-item ${journalDraftWeather === key ? 'active' : ''}" data-draft-weather="${key}"><span class="material-symbols-outlined">${item.icon}</span><small>${item.label}</small></button>`).join('')}</div>
    </div>
    <div class="stream-sheet journal-stream-sheet">
      <div class="sheet-handle"></div>
      <div class="journal-photo-wall-head"><h3>Visual Moments</h3><small>已附 ${currentPhotos.length} 张相片 · 最多 ${JOURNAL_PHOTO_LIMIT} 张</small></div>
      ${journalPhotoWall(currentPhotos, day, currentLive)}
       <div class="journal-creative-toolbar">
        <button class="creative-tool-btn" id="journal-format-btn"><span class="material-symbols-outlined">auto_fix_high</span><span>一键排版</span></button>
        <button class="creative-tool-btn ai-glow-btn" id="journal-ai-guide"><span class="material-symbols-outlined">auto_awesome</span><span>AI 帮我起笔</span></button>
         <button class="creative-tool-btn" id="journal-import-snippets"><span class="material-symbols-outlined">collections_bookmark</span><span>导入随手记素材</span></button>
       </div>
       ${journalSnippetPicker(day)}
      <div class="journal-canvas-card">
        <input class="journal-title-input" id="journal-title-input" value="${esc(journalTitle)}" placeholder="给这一天起个充满诗意的标题…">
        <textarea class="journal-body-textarea" id="journal-content-input" placeholder="发生了什么？此刻最想记住什么……">${esc(bodyText)}</textarea>
      <div class="journal-canvas-meta-bar"><span id="journal-live-word-count"><i class="material-symbols-outlined">edit</i>共 ${bodyText.length} 字</span><span class="local-saved-dot" id="journal-save-status" role="status" aria-live="polite">${restoredDraft ? '未提交草稿已保留' : journalEntry ? '正式日记已保存' : '输入后自动保留草稿'}</span></div>
      <div class="journal-footprint-strip"><span>习惯 ${journalFootprints(day).completed}/${journalFootprints(day).total}</span><span>专注 ${journalFootprints(day).minutes} 分钟</span><span>支出 ¥${journalFootprints(day).spend.toFixed(2)}</span></div>
      </div>
      <div class="journal-save-row"><button type="button" class="journal-save-btn" id="journal-screen-save"><span class="material-symbols-outlined">edit_document</span><span>保存生活日记</span></button></div>
      <h3 class="sheet-title journal-history-title">过往篇章</h3>
      ${entries.length ? entries.map(entry => `<button type="button" class="journal-preview-row" data-open-journal="${entry.date}"><span class="journal-preview-date"><b>${entry.date.slice(5, 7)}-</b><b>${entry.date.slice(8, 10)}</b></span><span class="journal-preview-copy"><strong>${entry.title ? esc(entry.title) : entry.content ? esc(entry.content.slice(0, 30)) : `${entry.photos?.length || 0} 张照片`}</strong><small>${entry.mood ? esc(MOODS[entry.mood]?.label || entry.mood) : '无心情标注'}</small></span><i class="material-symbols-outlined">chevron_right</i></button>`).join('') : `<p class="journal-preview-empty">还没有写过日记，写下第一篇吧。</p>`}
      <button class="journal-history-link" id="journal-history"><span class="material-symbols-outlined">history</span>浏览全部日记</button>
    </div>
  </section>`;
}

function bindJournalView() {
  $('#journal-date-input')?.addEventListener('change', event => {
    const nextDay = event.target.value;
    if (!nextDay || nextDay === journalEditingDay) return;
    if (!stageJournalScreenDraft(journalEditingDay)) {
      event.target.value = journalEditingDay;
      show('草稿还未安全暂存，请先保存后再切换日期');
      return;
    }
    setJournalEditingDay(nextDay);
    render();
  });
  $$('[data-draft-mood]').forEach(button => button.onclick = () => { journalDraftMood = button.dataset.draftMood; $$('[data-draft-mood]').forEach(b => b.classList.toggle('active', b === button)); stageJournalScreenDraft(); });
  $$('[data-draft-weather]').forEach(button => button.onclick = () => { journalDraftWeather = button.dataset.draftWeather; $$('[data-draft-weather]').forEach(b => b.classList.toggle('active', b === button)); stageJournalScreenDraft(); });
  $$('[data-clear-journal-draft]').forEach(button => button.onclick = () => {
    if (button.dataset.clearJournalDraft === 'mood') { journalDraftMood = ''; $$('[data-draft-mood]').forEach(b => b.classList.remove('active')); }
    else { journalDraftWeather = ''; $$('[data-draft-weather]').forEach(b => b.classList.remove('active')); }
    stageJournalScreenDraft();
  });
  const wordCount = () => { const el = $('#journal-live-word-count'); const ta = $('#journal-content-input'); if (el && ta) el.innerHTML = `<i class="material-symbols-outlined">edit</i>共 ${ta.value.length} 字`; };
  $('#journal-title-input')?.addEventListener('input', () => stageJournalScreenDraft());
  $('#journal-content-input')?.addEventListener('input', () => { wordCount(); stageJournalScreenDraft(); });
  $('#journal-format-btn')?.addEventListener('click', () => {
    const ta = $('#journal-content-input');
    if (!ta) return;
    const formatted = formatJournalText(ta.value);
    ta.value = formatted;
    ta.dispatchEvent(new Event('input'));
    show('已排版：统一段落间距');
  });
  $('#journal-ai-guide')?.addEventListener('click', async () => {
    const btn = $('#journal-ai-guide');
    const ta = $('#journal-content-input');
    if (!btn || !ta) return;
    btn.disabled = true;
    try {
      const guide = await aiJournalGuide(state);
      const existing = ta.value.trim();
      ta.value = existing ? `${existing}\n\n${guide}` : guide;
      ta.dispatchEvent(new Event('input'));
    } catch (error) { show(error.message); }
    finally { btn.disabled = false; }
  });
  $('#journal-import-snippets')?.addEventListener('click', () => { const panel = $('#journal-inline-snippet-picker'); if (panel) panel.hidden = !panel.hidden; });
  $('#journal-inline-snippet-close')?.addEventListener('click', () => { const panel = $('#journal-inline-snippet-picker'); if (panel) panel.hidden = true; });
  $('#journal-inline-snippet-apply')?.addEventListener('click', () => applyInlineSnippets(journalEditingDay).catch(error => show(error.message)));
  $('#journal-add-screen-photo')?.addEventListener('click', () => addPhotosToJournal(journalEditingDay).catch(error => show(error.message)));
  $$('[data-view-journal-screen-photo]').forEach(button => button.onclick = () => {
    const draft = journalDraftFor(state, journalEditingDay);
    const entry = state.journals[journalEditingDay];
    photoViewer(photosWithLiveMotion(draft?.photos || entry?.photos || [], draft?.livePhotos || entry?.livePhotos), Number(button.dataset.viewJournalScreenPhoto));
  });
  $$('[data-open-journal]').forEach(button => button.onclick = onPastJournalClick);
  $('#journal-screen-save')?.addEventListener('click', async () => {
    const button = $('#journal-screen-save');
    const title = ($('#journal-title-input')?.value || '').trim();
    const content = ($('#journal-content-input')?.value || '').trim();
    const day = journalEditingDay;
    const draft = journalDraftFor(state, day);
    const photos = draft?.photos || state.journals[day]?.photos || [];
    if (!title && !content && !journalDraftMood && !journalDraftWeather && !photos.length) return show('写点什么再保存吧');
    const body = content || '';
    const finalContent = title ? `《${title}》\n\n${body}` : body;
    const previous = state.journals[day] ? structuredClone(state.journals[day]) : null;
    const previousDraft = state.settings.journalDrafts?.[day] ? structuredClone(state.settings.journalDrafts[day]) : null;
    cancelPendingJournalDraftSave();
    if (button) button.disabled = true;
    try {
      const livePhotos = normalizeLivePhotos(draft?.livePhotos || previous?.livePhotos || [], photos, JOURNAL_PHOTO_LIMIT);
      state.journals[day] = { ...(previous || {}), content: finalContent, mood: journalDraftMood, weather: journalDraftWeather, photos, tags: draft?.tags || previous?.tags || [], summary: draft?.summary || previous?.summary || '', updatedAt: Math.max(Date.now(), Number(previousDraft?.updatedAt || 0) + 1) };
      if (livePhotos.length) state.journals[day].livePhotos = livePhotos;
      else delete state.journals[day].livePhotos;
      clearJournalDraft(state, day, { keepCache: true });
      await save();
    } catch (error) {
      if (previous) state.journals[day] = previous; else delete state.journals[day];
      if (previousDraft) state.settings.journalDrafts[day] = previousDraft;
      journalSaveStatus('正式保存失败，草稿仍保留', true);
      show(error.message);
      if (button) button.disabled = false;
      return;
    }
    clearJournalDraft(state, day);
    setSelected(day); setCursor(new Date(`${day}T12:00:00`));
    render(); show('正式日记已保存');
    callHelper('scheduleAiRefresh');
  });
}

registerView('journal', journalView);
registerBinder(bindJournalView);
registerHelper('setJournalEditingDay', setJournalEditingDay);
registerHelper('openPastJournal', openPastJournal);
