import { $, state, esc, registerHelper, modal, show, save, closeModal, render, openSubpage, confirmDelete } from '../core.js';
import { dateKey } from '../model.js';
import { normalizeTimetable, teachingWeek, coursesFor, weekDate, periodLabel, periodRangeLabel, courseMoment } from '../timetable.js';

let week = 1;
let activeDay = 1;
const dayNames = ['一', '二', '三', '四', '五', '六', '日'];
const tones = ['sage', 'ochre', 'terracotta', 'plum', 'blue'];
const timetable = () => state.settings.timetable;
const entries = () => timetable().courses;
const clampWeek = value => Math.max(1, Math.min(timetable().totalWeeks, value));

function courseCard(item, index) {
  const tone = tones[index % tones.length];
  return `<button type="button" class="course-row course-tone-${tone}" data-course="${item.id}">
    <span class="course-period"><b>${item.period}</b><small>${esc(periodRangeLabel(item.period, timetable()).replace(/^\d+/, ''))}</small></span>
    <span class="course-copy"><strong>${esc(item.name)}</strong><small><time>${periodLabel(item.period, timetable())}</time> · ${esc(item.room || '教室待定')} · ${esc(item.teacher || '教师待定')}</small></span>
    <span class="material-symbols-outlined course-edit-mark" aria-hidden="true">edit</span>
  </button>`;
}

function openTimetable() {
  const today = dateKey();
  week = clampWeek(teachingWeek(today, timetable()));
  const weekday = new Date(`${today}T12:00:00`).getDay() || 7;
  activeDay = weekday;
  paint();
}

function paint() {
  let layer = $('#subpage-timetable');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'subpage-timetable';
    layer.className = 'subpage-layer';
    $('.phone-shell').append(layer);
  }
  const schedule = timetable();
  week = clampWeek(week);
  const today = weekDate(week, activeDay, schedule);
  const list = coursesFor(today, entries(), schedule);
  const training = schedule.practice.filter(item => item.weeks.includes(week));
  const range = `${weekDate(week, 1, schedule).slice(5).replace('-', '月')}日 – ${weekDate(week, 7, schedule).slice(5).replace('-', '月')}日`;
  const dayTabs = dayNames.map((name, index) => {
    const day = index + 1;
    const date = weekDate(week, day, schedule).slice(5).replace('-', '/');
    const count = coursesFor(weekDate(week, day, schedule), entries(), schedule).length;
    return `<button type="button" class="course-day-tab ${activeDay === day ? 'active' : ''}" data-course-day="${day}" aria-pressed="${activeDay === day}"><b>周${name}</b><small>${date}</small><i>${count || '–'}</i></button>`;
  }).join('');

  openSubpage('subpage-timetable', `<nav class="subpage-nav-bar course-subpage-nav"><button type="button" class="subpage-back-btn" data-subpage-close><span class="material-symbols-outlined">arrow_back</span>返回</button><span class="subpage-nav-title"><b>课程表</b><small>Class Schedule</small></span><button type="button" class="course-nav-settings" id="course-settings" aria-label="学期设置"><span class="material-symbols-outlined">settings</span></button></nav><main class="course-page">
    <section class="course-hero">
      <span class="course-kicker">${esc(schedule.semesterName)}</span>
      <div><h1>第 ${week} 周</h1><p>${range} · ${week % 2 ? '单周' : '双周'}</p></div>
      <div class="course-week-nav"><button type="button" id="course-prev" ${week === 1 ? 'disabled' : ''} aria-label="上一教学周"><span class="material-symbols-outlined">chevron_left</span></button><button type="button" id="course-next" ${week === schedule.totalWeeks ? 'disabled' : ''} aria-label="下一教学周"><span class="material-symbols-outlined">chevron_right</span></button></div>
    </section>
    <div class="course-manage-bar"><button type="button" id="course-add"><span class="material-symbols-outlined">add</span>新增课程</button><button type="button" id="course-periods"><span class="material-symbols-outlined">schedule</span>节次时间</button><button type="button" id="course-practice"><span class="material-symbols-outlined">construction</span>实训安排</button></div>
    <div class="course-day-tabs" role="tablist" aria-label="选择上课日期">${dayTabs}</div>
    <section class="course-agenda">
      <header><div><span class="course-kicker">DAILY CLASSES</span><h2>周${dayNames[activeDay - 1]} · ${today.slice(5).replace('-', '月')}日</h2></div><small>${list.length ? `${list.length} 门课程` : '轻松一天'}</small></header>
      ${list.length ? `<div class="course-list">${list.map(courseCard).join('')}</div>` : `<div class="course-empty"><span class="material-symbols-outlined">wb_sunny</span><strong>${training.length ? '本周进入实训安排' : '今天没有课程'}</strong><small>${training.length ? training.map(item => `${esc(item.name)} · ${esc(item.teacher || '负责人待定')}`).join('；') : '可以新增课程，或留一点时间给自己。'}</small></div>`}
    </section>
    ${training.length ? `<aside class="course-training"><span class="material-symbols-outlined">construction</span><div><strong>第 ${week} 周实训提醒</strong><small>${training.map(item => `${esc(item.name)} · ${esc(item.teacher || '负责人待定')}`).join('；')}</small></div></aside>` : ''}
    <p class="course-tip">点击课程卡片编辑；课程、时间和周次均保存在本机。</p>
    <div class="course-collage-footer" aria-hidden="true"></div>
  </main>`);

  $('#course-prev').onclick = () => { week--; paint(); };
  $('#course-next').onclick = () => { week++; paint(); };
  $('#course-add').onclick = () => courseForm();
  $('#course-settings').onclick = semesterForm;
  $('#course-periods').onclick = periodManager;
  $('#course-practice').onclick = practiceManager;
  layer.querySelectorAll('[data-course-day]').forEach(button => { button.onclick = () => { activeDay = Number(button.dataset.courseDay); paint(); }; });
  layer.querySelectorAll('[data-course]').forEach(button => { button.onclick = () => courseForm(entries().find(item => item.id === button.dataset.course)); });
}

function weekPattern(weeks, totalWeeks) {
  const all = Array.from({ length: totalWeeks }, (_, index) => index + 1);
  const odd = all.filter(value => value % 2);
  const even = all.filter(value => !(value % 2));
  const same = values => values.length === weeks.length && values.every((value, index) => value === weeks[index]);
  if (same(all)) return { mode: 'all', start: 1, end: totalWeeks, custom: '' };
  if (same(odd)) return { mode: 'odd', start: 1, end: totalWeeks, custom: '' };
  if (same(even)) return { mode: 'even', start: 1, end: totalWeeks, custom: '' };
  const continuous = weeks.every((value, index) => !index || value === weeks[index - 1] + 1);
  return continuous ? { mode: 'range', start: weeks[0], end: weeks.at(-1), custom: '' } : { mode: 'custom', start: 1, end: totalWeeks, custom: weeks.join(',') };
}

function weeksFromForm(data, totalWeeks) {
  const all = Array.from({ length: totalWeeks }, (_, index) => index + 1);
  const mode = String(data.get('weekMode') || 'all');
  if (mode === 'all') return all;
  if (mode === 'odd') return all.filter(value => value % 2);
  if (mode === 'even') return all.filter(value => !(value % 2));
  if (mode === 'range') {
    const start = Math.max(1, Math.min(totalWeeks, Number(data.get('startWeek')) || 1));
    const end = Math.max(start, Math.min(totalWeeks, Number(data.get('endWeek')) || totalWeeks));
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return [...new Set(String(data.get('customWeeks') || '').split(/[，,、\s]+/).map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= totalWeeks))].sort((a, b) => a - b);
}

function courseForm(item = null) {
  const schedule = timetable();
  const pattern = weekPattern(item?.weeks || Array.from({ length: schedule.totalWeeks }, (_, index) => index + 1), schedule.totalWeeks);
  modal(`<form id="course-edit"><div class="modal-head"><div><span class="eyebrow">CLASS DETAIL</span><h2>${item ? '编辑课程' : '新增课程'}</h2><p>设置上课日、时间段和实际授课周。</p></div></div><input type="hidden" name="id" value="${esc(item?.id || '')}"><label>课程名称</label><input name="name" maxlength="80" required value="${esc(item?.name || '')}"><div class="course-form-grid"><label>星期<select name="day">${dayNames.map((name, index) => `<option value="${index + 1}" ${Number(item?.day || activeDay) === index + 1 ? 'selected' : ''}>周${name}</option>`).join('')}</select></label><label>节次时间<select name="period">${schedule.periods.map(slot => `<option value="${slot.startPeriod}" ${Number(item?.period || schedule.periods[0]?.startPeriod) === slot.startPeriod ? 'selected' : ''}>${slot.startPeriod}–${slot.endPeriod}节 · ${slot.start}–${slot.end}</option>`).join('')}</select></label></div><div class="course-form-grid"><label>教师<input name="teacher" maxlength="60" value="${esc(item?.teacher || '')}"></label><label>教室<input name="room" maxlength="60" value="${esc(item?.room || '')}"></label></div><label>授课周规则</label><select name="weekMode" id="course-week-mode"><option value="all" ${pattern.mode === 'all' ? 'selected' : ''}>全部周</option><option value="odd" ${pattern.mode === 'odd' ? 'selected' : ''}>仅单周</option><option value="even" ${pattern.mode === 'even' ? 'selected' : ''}>仅双周</option><option value="range" ${pattern.mode === 'range' ? 'selected' : ''}>连续周次</option><option value="custom" ${pattern.mode === 'custom' ? 'selected' : ''}>自选周次</option></select><div class="course-form-grid"><label>连续起始周<input name="startWeek" type="number" min="1" max="${schedule.totalWeeks}" value="${pattern.start}"></label><label>连续结束周<input name="endWeek" type="number" min="1" max="${schedule.totalWeeks}" value="${pattern.end}"></label></div><label>自选周次</label><input name="customWeeks" value="${esc(pattern.custom)}" placeholder="例如：1,2,5,8,11"><small class="field-help">选择“连续周次”时读取起止周；选择“自选周次”时读取逗号列表。</small><div class="modal-actions">${item ? '<button type="button" class="danger" id="course-delete">删除课程</button>' : ''}<button type="button" data-close>取消</button><button type="submit" class="save">保存课程</button></div></form>`, 'course-edit-modal timetable-editor-modal');
  $('#course-edit').onsubmit = async event => {
    event.preventDefault(); event.stopPropagation();
    const data = new FormData(event.currentTarget);
    const weeks = weeksFromForm(data, schedule.totalWeeks);
    if (!weeks.length) return show('请至少选择一个授课周');
    const next = structuredClone(schedule);
    const id = String(data.get('id') || crypto.randomUUID());
    const value = { id, name: String(data.get('name') || '').trim(), teacher: String(data.get('teacher') || '').trim(), room: String(data.get('room') || '').trim(), day: Number(data.get('day')), period: Number(data.get('period')), weeks };
    const index = next.courses.findIndex(course => course.id === id);
    if (index >= 0) next.courses[index] = value; else next.courses.push(value);
    await replaceTimetable(next);
  };
  $('#course-delete')?.addEventListener('click', () => confirmDelete(`删除课程“${item.name}”？`, async () => { const next = structuredClone(timetable()); next.courses = next.courses.filter(course => course.id !== item.id); await replaceTimetable(next, false); }));
}

function semesterForm() {
  const schedule = timetable();
  modal(`<form id="semester-edit"><span class="eyebrow">SEMESTER SETTINGS</span><h2>学期设置</h2><label>学期名称</label><input name="semesterName" maxlength="80" required value="${esc(schedule.semesterName)}"><label>第一教学周星期一</label><input name="semesterStart" type="date" required value="${schedule.semesterStart}"><label>总教学周数</label><input name="totalWeeks" type="number" min="1" max="60" required value="${schedule.totalWeeks}"><small class="field-help">缩短总周数前，需要先调整超出新范围的课程和实训周次。</small><div class="modal-actions"><button type="button" data-close>取消</button><button class="save">保存学期</button></div></form>`, 'timetable-editor-modal');
  $('#semester-edit').onsubmit = async event => {
    event.preventDefault(); event.stopPropagation();
    const data = new FormData(event.currentTarget); const totalWeeks = Number(data.get('totalWeeks'));
    const semesterStart = String(data.get('semesterStart'));
    if (new Date(`${semesterStart}T12:00:00Z`).getUTCDay() !== 1) return show('第一教学周日期必须选择星期一');
    const highestUsed = Math.max(0, ...schedule.courses.flatMap(item => item.weeks), ...schedule.practice.flatMap(item => item.weeks));
    if (totalWeeks < highestUsed) return show(`仍有第 ${highestUsed} 周的安排，请先调整后再缩短学期`);
    await replaceTimetable({ ...structuredClone(schedule), semesterName: String(data.get('semesterName')).trim(), semesterStart, totalWeeks });
  };
}

function periodManager() {
  const schedule = timetable();
  modal(`<div class="timetable-manager"><span class="eyebrow">CLASS PERIODS</span><h2>节次时间</h2><div class="timetable-manager-list">${schedule.periods.map(slot => `<button type="button" data-period-edit="${slot.id}"><span><strong>${slot.startPeriod}–${slot.endPeriod} 节</strong><small>${slot.start}–${slot.end}</small></span><span class="material-symbols-outlined">edit</span></button>`).join('')}</div><div class="modal-actions"><button type="button" data-close>关闭</button><button type="button" class="save" id="period-add">新增时间段</button></div></div>`, 'timetable-manager-modal');
  document.querySelectorAll('[data-period-edit]').forEach(button => button.onclick = () => periodForm(schedule.periods.find(slot => slot.id === button.dataset.periodEdit)));
  $('#period-add').onclick = () => periodForm();
}

function periodForm(slot = null) {
  modal(`<form id="period-edit"><span class="eyebrow">CLASS PERIOD</span><h2>${slot ? '编辑时间段' : '新增时间段'}</h2><input type="hidden" name="id" value="${esc(slot?.id || '')}"><div class="course-form-grid"><label>起始节<input name="startPeriod" type="number" min="1" max="30" required value="${slot?.startPeriod || ''}"></label><label>结束节<input name="endPeriod" type="number" min="1" max="30" required value="${slot?.endPeriod || ''}"></label><label>开始时间<input name="start" type="time" required value="${slot?.start || ''}"></label><label>结束时间<input name="end" type="time" required value="${slot?.end || ''}"></label></div><div class="modal-actions">${slot ? '<button type="button" class="danger" id="period-delete">删除</button>' : ''}<button type="button" id="period-manager-back">返回</button><button class="save">保存</button></div></form>`, 'timetable-editor-modal');
  $('#period-manager-back').onclick = periodManager;
  $('#period-edit').onsubmit = async event => {
    event.preventDefault(); event.stopPropagation(); const data = new FormData(event.currentTarget);
    const startPeriod = Number(data.get('startPeriod')), endPeriod = Number(data.get('endPeriod'));
    if (endPeriod < startPeriod) return show('结束节不能早于起始节');
    if (String(data.get('end')) <= String(data.get('start'))) return show('结束时间必须晚于开始时间');
    const next = structuredClone(timetable());
    if (next.periods.some(item => item.id !== slot?.id && item.startPeriod === startPeriod)) return show('这个起始节已经有时间段');
    const value = { id: String(data.get('id') || crypto.randomUUID()), startPeriod, endPeriod, start: String(data.get('start')), end: String(data.get('end')) };
    const index = next.periods.findIndex(item => item.id === value.id);
    if (index >= 0) {
      const previousStart = next.periods[index].startPeriod;
      next.periods[index] = value;
      if (previousStart !== startPeriod) next.courses.forEach(course => { if (course.period === previousStart) course.period = startPeriod; });
    } else next.periods.push(value);
    await replaceTimetable(next);
  };
  $('#period-delete')?.addEventListener('click', () => { if (timetable().periods.length <= 1) return show('至少需要保留一个节次时间段'); if (timetable().courses.some(course => course.period === slot.startPeriod)) return show('仍有课程使用这个时间段，不能删除'); confirmDelete('删除这个节次时间段？', async () => { const next = structuredClone(timetable()); next.periods = next.periods.filter(item => item.id !== slot.id); await replaceTimetable(next, false); }); });
}

function practiceManager() {
  const schedule = timetable();
  modal(`<div class="timetable-manager"><span class="eyebrow">PRACTICE WEEKS</span><h2>实训安排</h2><div class="timetable-manager-list">${schedule.practice.length ? schedule.practice.map(item => `<button type="button" data-practice-edit="${item.id}"><span><strong>${esc(item.name)}</strong><small>第 ${item.weeks.join('、')} 周 · ${esc(item.teacher || '负责人待定')}</small></span><span class="material-symbols-outlined">edit</span></button>`).join('') : '<p class="subtle">还没有实训安排。</p>'}</div><div class="modal-actions"><button type="button" data-close>关闭</button><button type="button" class="save" id="practice-add">新增实训</button></div></div>`, 'timetable-manager-modal');
  document.querySelectorAll('[data-practice-edit]').forEach(button => button.onclick = () => practiceForm(schedule.practice.find(item => item.id === button.dataset.practiceEdit)));
  $('#practice-add').onclick = () => practiceForm();
}

function practiceForm(item = null) {
  modal(`<form id="practice-edit"><span class="eyebrow">PRACTICE DETAIL</span><h2>${item ? '编辑实训' : '新增实训'}</h2><input type="hidden" name="id" value="${esc(item?.id || '')}"><label>实训名称</label><input name="name" maxlength="80" required value="${esc(item?.name || '')}"><label>负责人</label><input name="teacher" maxlength="60" value="${esc(item?.teacher || '')}"><label>安排周次</label><input name="weeks" required value="${esc(item?.weeks?.join(',') || '')}" placeholder="例如：6,7,8"><div class="modal-actions">${item ? '<button type="button" class="danger" id="practice-delete">删除</button>' : ''}<button type="button" id="practice-manager-back">返回</button><button class="save">保存</button></div></form>`, 'timetable-editor-modal');
  $('#practice-manager-back').onclick = practiceManager;
  $('#practice-edit').onsubmit = async event => {
    event.preventDefault(); event.stopPropagation(); const data = new FormData(event.currentTarget);
    const weeks = [...new Set(String(data.get('weeks')).split(/[，,、\s]+/).map(Number).filter(value => Number.isInteger(value) && value >= 1 && value <= timetable().totalWeeks))].sort((a, b) => a - b);
    if (!weeks.length) return show('请至少填写一个有效周次');
    const next = structuredClone(timetable()); const id = String(data.get('id') || crypto.randomUUID());
    const value = { id, name: String(data.get('name')).trim(), teacher: String(data.get('teacher')).trim(), weeks };
    const index = next.practice.findIndex(entry => entry.id === id); if (index >= 0) next.practice[index] = value; else next.practice.push(value);
    await replaceTimetable(next);
  };
  $('#practice-delete')?.addEventListener('click', () => confirmDelete(`删除实训“${item.name}”？`, async () => { const next = structuredClone(timetable()); next.practice = next.practice.filter(entry => entry.id !== item.id); await replaceTimetable(next, false); }));
}

async function replaceTimetable(next, close = true) {
  const previous = state.settings.timetable;
  state.settings.timetable = normalizeTimetable(next);
  try { await save(); if (close) closeModal(); render(); paint(); }
  catch (error) { state.settings.timetable = previous; show(error.message); }
}

registerHelper('openTimetable', openTimetable);
registerHelper('todayCoursesHtml', () => {
  const schedule = timetable();
  const day = dateKey();
  const currentWeek = teachingWeek(day, schedule);
  const list = currentWeek >= 1 && currentWeek <= schedule.totalWeeks ? coursesFor(day, entries(), schedule) : [];
  const title = currentWeek < 1 ? '课程表已就绪' : currentWeek > schedule.totalWeeks ? '本学期课程已结束' : list.length ? `今天 ${list.length} 门课程` : '今天没有课程';
  const moment = list.length ? courseMoment(day, entries(), new Date(), schedule) : null;
  const detail = currentWeek < 1 ? `${schedule.semesterStart.slice(5).replace('-', '月')}日开始第1教学周。` : currentWeek > schedule.totalWeeks ? '查看或设置下一学期课程。' : moment?.type === 'finished' ? '今天课程已结束。' : '打开课表，查看接下来安排。';
  const tail = moment?.remaining ? `还有 ${moment.remaining} 门课` : moment?.type === 'finished' ? '课程已完成' : '查看本周安排';
  const featured = ['active', 'next'].includes(moment?.type) ? moment.item : null;
  const featuredHtml = featured ? `<em class="course-home-detail"><span class="course-home-timing">${moment.type === 'active' ? '正在上课' : '下一节'} · ${periodLabel(featured.period, schedule)}</span><b class="course-home-name">${esc(featured.name)}</b><span class="course-home-room"><span class="material-symbols-outlined">location_on</span>${esc(featured.room || '教室待定')}</span></em>` : `<em class="course-home-detail"><span>${detail}</span></em>`;
  return `<button type="button" class="today-courses" id="open-timetable"><span class="material-symbols-outlined">calendar_month</span><span><strong><span class="course-home-label">今日课程</span><span class="course-home-status">${title}</span><small>${currentWeek >= 1 && currentWeek <= schedule.totalWeeks ? `第 ${currentWeek} 教学周 · ${tail}` : esc(schedule.semesterName)}</small></strong>${featuredHtml}</span><span class="material-symbols-outlined course-open-arrow">arrow_forward</span></button>`;
});
