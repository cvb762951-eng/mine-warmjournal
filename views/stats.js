import { withSharedTransition, rollNumbers } from '../motion.js';
import { $, $$, esc, state, render, renderContentSwap, modal, formatMinutes, go, registerView, registerBinder, registerHelper, callHelper } from '../core.js';
import { periodSummary, dateKey } from '../model.js';
import { completeStatsWeekSummary, habitArchiveMetrics, warmWeeklyLifeMetrics, focusInsights } from '../analytics.js';

// ---- 本地状态 ----
let period = 'week';
let habitHeatmapYear = new Date().getFullYear();
let activeHabitId = '';

const money = value => Number(value || 0).toFixed(2);

function categoryName(id) {
  return (state.focusCategories || []).find(category => category.id === id)?.name || '已删除分类';
}

function focusTotalLabel(minutes) {
  const total = Number(minutes || 0);
  if (total >= 60) {
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }
  return `${total} 分钟`;
}

const periodTitle = () => period === 'week' ? '本周回顾' : period === 'month' ? '本月回顾' : '年度回顾';
const periodKicker = () => period === 'week' ? 'WEEKLY RETROSPECT' : period === 'month' ? 'MONTHLY RETROSPECT' : 'YEAR IN REVIEW';
const periodScope = () => period === 'week' ? '本周' : period === 'month' ? '本月' : '本年';

// 柱状图：周维度直接 7 天；月/年维度按 7 桶聚合，避免图上挤满 30/365 根柱。
function chartSeries(summary) {
  if (summary.daily.length <= 7) return summary.daily;
  const bucketSize = Math.ceil(summary.daily.length / 7);
  return Array.from({ length: 7 }, (_, index) => {
    const bucket = summary.daily.slice(index * bucketSize, Math.min(summary.daily.length, (index + 1) * bucketSize));
    return {
      day: bucket[0]?.day || '',
      label: period === 'year' ? `${Number(bucket[0]?.label || 0)}日` : bucket[0]?.label || '',
      minutes: bucket.reduce((total, item) => total + item.minutes, 0)
    };
  });
}

// ---- 报头 ----
function masthead(summary, metrics) {
  const range = `${summary.start.slice(5).replace('-', '/')} – ${summary.end.slice(5).replace('-', '/')}`;
  const ledger = metrics.ledger;
  return `<header class="stats-masthead">
    <span class="stats-masthead-kicker">${periodKicker()}</span>
    <div class="stats-masthead-row">
      <h1>${periodTitle()}</h1>
      <span class="stats-masthead-range">${range}</span>
    </div>
    <p class="stats-masthead-line">专注 ${focusTotalLabel(summary.totalMinutes)} · 习惯 ${metrics.habits.completionRate}% · 本${period === 'week' ? '周' : '期'}支出 ¥${money(ledger.totalExpense)}</p>
    <span class="stats-masthead-seal" aria-hidden="true"></span>
  </header>`;
}

// ---- KPI 纸卡 ----
function kpiCard(summary, metrics) {
  const percent = summary.previousMinutes
    ? Math.round(summary.difference / summary.previousMinutes * 100)
    : 0;
  const trend = summary.previousMinutes
    ? `${summary.difference >= 0 ? '↑' : '↓'} ${Math.abs(percent)}%`
    : summary.totalMinutes ? '新增' : '—';
  const tone = summary.difference >= 0 ? 'up' : 'down';
  const habits = metrics.habits;
  // 2026-10-20 重做：不再显示把所有习惯混在一起的单一百分比
  //（周目标被按天算、休息日进分母，读起来毫无意义）。
  // 改成「几个习惯达标」+ 一句人话，并列出每个习惯的具体进度。
  const habitList = habits.perHabit || [];
  const habitMetCount = habitList.filter(item => item.met).length;
  const habitTone = habitList.length && habitMetCount === habitList.length ? 'good' : habitMetCount ? 'mid' : 'low';
  const habitSummaryLine = habitList.length
    ? habitList.map(item => item.isWeekly ? `${esc(item.name)} ${item.done}/${item.target}次` : `${esc(item.name)} ${item.done}/${item.target}天`).join(' · ')
    : '还没有习惯记录';
  return `<div class="stats-kpi-grid">
    <section class="stats-kpi-sheet">
      <small>专注总时长</small>
      <strong>${focusTotalLabel(summary.totalMinutes)}</strong>
      <span class="stats-kpi-trend ${tone}">${trend}</span>
      <p>${periodScope()}日均 <span data-roll="${summary.averageMinutes}">${summary.averageMinutes}</span> 分钟 · 单次最长 <span data-roll="${summary.longestMinutes}">${summary.longestMinutes}</span> 分钟</p>
    </section>
    <section class="stats-kpi-sheet">
      <small>习惯达标</small>
      <strong>${habitList.length ? `<span data-roll="${habitMetCount}">${habitMetCount}</span><em>/${habitList.length}</em>` : '—'}</strong>
      <span class="stats-kpi-badge ${habitTone}">${!habitList.length ? '暂无习惯' : habitMetCount === habitList.length ? '全部达标' : habitMetCount === 0 ? '继续积累' : `${habitMetCount} 项达成`}</span>
      <p>${habitSummaryLine}</p>
    </section>
  </div>`;
}

// ---- 七日柱状图 ----
function focusChart(summary) {
  const series = chartSeries(summary);
  const maxMinutes = Math.max(1, ...series.map(item => item.minutes));
  const peakIndex = series.reduce((best, item, index) => item.minutes > (series[best]?.minutes || 0) ? index : best, 0);
  const peak = series[peakIndex];
  return `<section class="stats-sheet stats-chart-sheet">
    <div class="stats-sheet-head"><h2>每日专注时长</h2><small>${peak?.minutes ? `峰值 ${peak.label} · ${focusTotalLabel(peak.minutes)}` : '暂无记录'}</small></div>
    <div class="stats-chart" role="img" aria-label="${periodScope()}每日专注柱状图">
      ${series.map((item, index) => `<div class="stats-chart-col">
        <div class="stats-chart-bar ${item.minutes && index === peakIndex ? 'peak' : ''}" style="height:${item.minutes ? Math.max(4, Math.round(item.minutes / maxMinutes * 88)) : 0}%"></div>
        <span>${item.minutes ? item.label : '·'}</span>
      </div>`).join('')}
    </div>
  </section>`;
}

// ---- 分类排行（可点进明细） ----
function categoryRank(summary) {
  const rows = Object.entries(summary.byProject)
    .map(([id, minutes]) => ({ id, minutes: Number(minutes || 0), color: categoryColor(id) }))
    .filter(row => row.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 8);
  if (!rows.length) return `<section class="stats-sheet"><div class="stats-sheet-head"><h2>分类排行</h2></div><p class="stats-sheet-empty">${periodScope()}还没有专注记录，去专注工坊记一笔吧。</p></section>`;
  const max = Math.max(1, ...rows.map(row => row.minutes));
  return `<section class="stats-sheet stats-rank-sheet">
    <div class="stats-sheet-head"><h2>分类排行</h2><small>点一行看每次记录</small></div>
    <div class="stats-rank-list">
      ${rows.map(row => `<button type="button" class="stats-rank-row" data-stats-project="${esc(row.id)}" aria-label="查看${esc(categoryName(row.id))}的专注记录">
        <span class="stats-rank-name">${esc(categoryName(row.id))}</span>
        <span class="stats-rank-track"><i style="width:${Math.round(row.minutes / max * 100)}%;background:${row.color}"></i></span>
        <b>${focusTotalLabel(row.minutes)}</b>
      </button>`).join('')}
    </div>
  </section>`;
}

function categoryColor(id) {
  const palette = ['#4d7056', '#4d638b', '#77708f', '#a9764f', '#8b5e63', '#4a6b7c', '#6b6b4d', '#7c5a7c'];
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

// ---- 时段分布 ----
function timeBuckets(summary) {
  const insights = focusInsights(state, summary.sessions || []);
  const buckets = insights.buckets || [];
  if (!buckets.some(bucket => bucket.minutes > 0)) return '';
  const max = Math.max(1, ...buckets.map(bucket => bucket.minutes));
  return `<section class="stats-sheet stats-bucket-sheet">
    <div class="stats-sheet-head"><h2>时段分布</h2><small>${insights.peakLabel && insights.peakLabel !== '暂无' ? `最投入 ${insights.peakLabel}` : ''}</small></div>
    <div class="stats-bucket-list">
      ${buckets.map(bucket => `<div class="stats-bucket-row">
        <span>${esc(bucket.label)}</span>
        <span class="stats-bucket-track"><i style="width:${Math.round(bucket.minutes / max * 100)}%"></i></span>
        <b>${bucket.minutes ? focusTotalLabel(bucket.minutes) : '—'}</b>
      </div>`).join('')}
    </div>
  </section>`;
}

// ---- 习惯清单 ----
function habitSheet(habits, metrics) {
  if (!habits.length) return '';
  // 2026-10-20 重做：每个习惯右侧直接显示本周期进度（2/3次、4/5天），
  // 用一个色块表示状态 —— 不用点进去才知道哪个落后了。
  const perHabit = new Map((metrics.habits?.perHabit || []).map(item => [item.id, item]));
  return `<section class="stats-sheet stats-habit-sheet">
    <div class="stats-sheet-head"><h2>习惯档案</h2><small>${habits.length} 个习惯 · 点一行看全部记录</small></div>
    <div class="stats-habit-list">
      ${habits.map(habit => {
        const stat = perHabit.get(habit.id);
        const progress = stat
          ? `<span class="stats-habit-progress ${stat.met ? 'done' : ''}"><i style="width:${stat.target ? Math.min(100, Math.round(stat.done / stat.target * 100)) : 0}%"></i><em>${stat.isWeekly ? `${stat.done}/${stat.target} 次` : `${stat.done}/${stat.target} 天`}</em></span>`
          : '';
        return `<button type="button" class="stats-habit-row" data-habit-detail="${habit.id}" aria-label="查看${esc(habit.name)}习惯档案">
        <span class="material-symbols-outlined">${habit.icon || 'track_changes'}</span>
        <span><strong>${esc(habit.name)}</strong><small>${habit.goalPeriod === 'weekly' ? '每周' : '每日'}目标 ${habit.target}${habit.goalType === 'range' ? `–${habit.targetMax}` : ''}${esc(habit.unit)}</small></span>
        ${progress}
        <span class="material-symbols-outlined">chevron_right</span>
      </button>`;
      }).join('')}
    </div>
  </section>`;
}

// ---- 账本纸卡 ----
function ledgerSheet(metrics) {
  const ledger = metrics.ledger;
  const hasBudget = ledger.budgetTotal > 0;
  const status = !hasBudget ? '未设预算' : ledger.remainingBudget < 0 ? '已超支' : '预算内';
  return `<button type="button" class="stats-sheet stats-ledger-sheet" id="stats-ledger-go">
    <div class="stats-sheet-head"><h2>账本</h2><span class="stats-kpi-badge ${ledger.remainingBudget < 0 ? 'bad' : 'good'}">${status}</span></div>
    <p class="stats-ledger-numbers"><span>支出 ¥${money(ledger.totalExpense)}</span><span>收入 ¥${money(ledger.totalIncome)}</span><span>${ledger.transactionCount} 笔</span></p>
    ${hasBudget ? `<p class="stats-ledger-progress"><i style="width:${Math.min(100, Math.round(ledger.budgetSpentToRangeEnd / ledger.budgetTotal * 100))}%"></i></p>` : '<p class="stats-ledger-hint">去账本设置预算，就能看到每期用了多少。</p>'}
  </button>`;
}

// ---- 生活侧写（日记 / 书影音） ----
function reflectionSheet(metrics) {
  const journals = metrics.journals;
  const media = metrics.media;
  if (!journals.count && !media.completed && !media.inProgress) return '';
  return `<section class="stats-sheet stats-reflection-sheet">
    <div class="stats-sheet-head"><h2>这${periodScope()}</h2></div>
    <div class="stats-reflection-list">
      ${journals.count ? `<div><span class="material-symbols-outlined">edit_note</span><b>${journals.count}</b><small>篇日记 · ${journals.wordCount} 字</small></div>` : ''}
      ${media.completed ? `<div><span class="material-symbols-outlined">task_alt</span><b>${media.completed}</b><small>部读完看完</small></div>` : ''}
      ${media.inProgress ? `<div><span class="material-symbols-outlined">bookmark</span><b>${media.inProgress}</b><small>部在读在看</small></div>` : ''}
    </div>
  </section>`;
}

export function statsView() {
  const baseSummary = periodSummary(state, period);
  const summary = period === 'week' ? completeStatsWeekSummary(state, baseSummary) : baseSummary;
  const metrics = warmWeeklyLifeMetrics(state, { start: summary.start, end: summary.end, weekNumber: 0 });
  const habits = (state.habits || []).filter(habit => !habit.archived);
  return `<section class="view stats-view stats-screen">
    ${masthead(summary, metrics)}
    <div class="stats-toolbar">
      <div class="segment">${[['week', '周'], ['month', '月'], ['year', '年']].map(([value, label]) => `<button data-period="${value}" class="${period === value ? 'active' : ''}">${label}</button>`).join('')}</div>
      <button class="stats-report-trigger" id="report" aria-label="查看${periodScope()}总结"><span class="material-symbols-outlined">auto_stories</span></button>
    </div>
    ${kpiCard(summary, metrics)}
    ${focusChart(summary)}
    ${categoryRank(summary)}
    ${timeBuckets(summary)}
    ${habitSheet(habits, metrics)}
    ${ledgerSheet(metrics)}
    ${reflectionSheet(metrics)}
  </section>`;
}

// ---- 周期总结弹窗 ----
export function reportModal() {
  const summary = periodSummary(state, period);
  const best = [...summary.sessions].sort((a, b) => b.minutes - a.minutes)[0];
  const rows = Object.entries(summary.byProject)
    .filter(([, minutes]) => minutes > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  modal(`<div class="modal-head"><div><h2>${periodTitle()}</h2><p>${summary.start} 至 ${summary.end}</p></div></div>
    <div class="report-summary">
      <p><strong>${formatMinutes(summary.totalMinutes)}</strong><small>总专注时长</small></p>
      <p><strong>${summary.sessions.length}</strong><small>专注次数</small></p>
      <p><strong>${summary.averageMinutes}</strong><small>日均分钟</small></p>
    </div>
    ${best ? `<p class="report-best">最长一次：${esc(best.task || categoryName(best.projectId || best.categoryId) || '专注')} · ${formatMinutes(best.minutes)}</p>` : '<p class="report-best">本周期还没有专注记录。</p>'}
    ${rows.length ? `<div class="report-rank"><h3>分类占比</h3>${rows.map(([id, minutes]) => `<div><span>${esc(categoryName(id))}</span><b>${formatMinutes(minutes)}</b></div>`).join('')}</div>` : ''}
    <div class="modal-actions"><button class="save" data-close>知道了</button></div>`, 'large-modal report-modal');
}

// ---- 习惯热力图二级页 ----
function openHabitDetail(habitId, sourceEl = null) {
  const habit = (state.habits || []).find(item => item.id === habitId);
  if (!habit) return;
  activeHabitId = habit.id;
  callHelper('openSubpage', 'subpage-habit-detail', `<nav class="subpage-nav-bar habit-detail-nav"><button type="button" class="subpage-back-btn" data-subpage-close><span class="material-symbols-outlined">arrow_back</span><span>返回</span></button><span class="subpage-nav-title">习惯档案 · ${esc(habit.name)}</span><button type="button" class="subpage-nav-action" id="habit-settings" aria-label="习惯设置"><span class="material-symbols-outlined">settings</span></button></nav>${habitDetailBody(habit)}`);
  bindHabitDetail();
}

function habitDetailBody(habit) {
  const heatmap = callHelper('habitHeatmapData', habit.id, habitHeatmapYear) || { days: [], totalActiveDays: 0, currentStreak: 0, longestStreak: 0 };
  const metrics = habitArchiveMetrics(state, habit.id, habitHeatmapYear, heatmap);
  const plannedDates = new Set(metrics.plannedDates);
  const leading = heatmap.days[0] ? (new Date(`${heatmap.days[0].date}T12:00:00`).getDay() + 6) % 7 : 0;
  const todayLabel = ({ completed:'今日已达标 ✓', 'in-progress':'今日进行中', planned:'今日待完成', rest:'今日休息日', 'outside-year':`${habitHeatmapYear} 年之外`, unavailable:'今日无安排' }[metrics.today?.status] || '今日无安排');
  const targetLabel = habit.goalPeriod === 'weekly' ? `每周目标：${habit.target} ${habit.unit}` : `每日目标：${habit.target}${habit.goalType === 'range' ? `–${habit.targetMax}` : ''}${habit.unit}`;
  const grid = `${Array.from({ length:leading }, () => '<span class="heatmap-leading" aria-hidden="true"></span>').join('')}${heatmap.days.map(day => {
    // habitHeatmapData 只产出 { date, level, value }；休息日与未来日要另外算，不能读不存在的字段。
    const isRest = Boolean((state.habitSkips || {})[day.date]);
    const isFuture = day.date > dateKey();
    const className = isFuture || isRest ? 'planned' : plannedDates.has(day.date) ? 'planned' : '';
    const stateLabel = isFuture ? '未来' : isRest ? '休息日' : `${day.value}`;
    return `<span class="heatmap-cell level-${isFuture || isRest ? 0 : day.level} ${className}" role="img" aria-label="${day.date} ${stateLabel}" title="${day.date} · ${isRest ? '休息日' : `${day.value}`}"></span>`;
  }).join('')}`;
  const switcher = `<div class="habit-detail-switcher" aria-label="切换习惯档案">${(state.habits || []).filter(item => !item.archived).map(item => `<button type="button" class="habit-switch-chip ${item.id === habit.id ? 'active' : ''}" data-habit-switch="${item.id}" aria-pressed="${item.id === habit.id}"><span class="material-symbols-outlined">${item.icon || 'track_changes'}</span>${esc(item.name)}</button>`).join('')}</div>`;

  // 2026-10-20 重做：把抽象数字换成「这周/这月做了什么」的具体说法。
  // 周目标习惯显示「本周 2/3 次」，日目标显示「30 天里做到了 24 天」，
  // 休息日不再出现在分母里，主动休息不算漏做。
  const week = metrics.weekProgress;
  const streak = metrics.streak || { current: 0, longest: 0 };
  const habitStats = metrics.isWeekly
    ? [
        { strong: `${week?.done ?? 0}<em>/${week?.target ?? habit.target}</em>`, small: '本周次数', tone: week?.met ? 'good' : 'mid' },
        { strong: `${metrics.completedPeriods}<em>${metrics.rateUnit}</em>`, small: '达标周数', tone: metrics.completionRate >= 80 ? 'good' : 'mid' },
        { strong: String(streak.longest), small: '最长连续达标天', tone: '' },
        { strong: String(heatmap.totalActiveDays), small: '有记录天数', tone: '' }
      ]
    : [
        { strong: String(streak.current), small: '当前连续天', tone: streak.current > 0 ? 'good' : '' },
        { strong: String(streak.longest), small: '最长连续天', tone: '' },
        { strong: `${metrics.completedDays}<em>/${metrics.plannedDays}</em>`, small: `做到 / 计划（天）${metrics.restDays ? ` · 休息 ${metrics.restDays}` : ''}`, tone: metrics.completionRate >= 80 ? 'good' : 'mid' },
        { strong: String(heatmap.totalActiveDays), small: '累计活跃天', tone: '' }
      ];
  const statsHtml = habitStats.map(item => `<div class="${item.tone}"><strong>${item.strong}</strong><small>${item.small}</small></div>`).join('');
  return `<div class="habit-detail-screen">${switcher}<section class="habit-hero-card"><div class="habit-hero-head"><div class="habit-hero-identity"><span class="material-symbols-outlined">${habit.icon || 'track_changes'}</span><div><h2>${esc(habit.name)}</h2><small>${esc(targetLabel)}</small></div></div><span class="habit-hero-badge">${todayLabel}</span></div><div class="habit-hero-stats">${statsHtml}</div></section><section class="habit-heatmap-card"><div class="habit-heatmap-head"><h3>${habitHeatmapYear} 年足迹</h3><div class="habit-heatmap-year-switch">${[habitHeatmapYear - 1, habitHeatmapYear, habitHeatmapYear + 1].map(year => `<button type="button" data-heatmap-year="${year}" class="${year === habitHeatmapYear ? 'active' : ''}">${year}</button>`).join('')}</div></div><div class="habit-heatmap-scroll"><div class="habit-heatmap-grid">${grid}</div></div><div class="heatmap-legend"><span>少</span>${[0, 1, 2, 3, 4].map(level => `<i class="heatmap-cell level-${level}"></i>`).join('')}<span>多</span><span class="heatmap-total">${heatmap.totalActiveDays} 天有记录</span></div></section>${achievementSection(metrics)}</div>`;
}

function achievementSection(metrics) {
  return `<section class="habit-achievement-card"><h3>成就与勋章里程碑</h3><div class="habit-achievement-list">${metrics.achievements.map(item => `<div class="${item.unlocked ? 'earned' : ''}"><span class="material-symbols-outlined">${item.icon || 'emoji_events'}</span><strong>${esc(item.label)}</strong><small>${item.unlocked ? `已达 ${item.value}${esc(item.unit || '')}` : `还差 ${item.remaining}${esc(item.unit || '')}`}</small></div>`).join('')}</div></section>`;
}

// ---- 绑定 ----
function bindStats() {
  const statsRoot = $('.stats-view');
  if (statsRoot) rollNumbers(statsRoot);
  $$('[data-period]').forEach(button => button.onclick = () => {
    if (period === button.dataset.period) return;
    period = button.dataset.period;
    renderContentSwap();   // 周/月/年：退 → 换 → 进，别让整页数字瞬跳
  });
  $$('[data-stats-project]').forEach(button => button.onclick = () => callHelper('projectSessionHistory', button.dataset.statsProject));
  $('#report')?.addEventListener('click', reportModal);
  $('#stats-ledger-go')?.addEventListener('click', () => go('ledger'));
  $$('[data-habit-detail]').forEach(button => button.onclick = () => {
    // 共享元素：这一行"长大"成二级页顶部的档案头卡
    withSharedTransition(button, () => openHabitDetail(button.dataset.habitDetail), {
      targetSelector: '#subpage-habit-detail .habit-hero-card',
      fallbackTargetSelector: '#subpage-habit-detail .habit-hero-card'
    });
  });
  $$('[data-heatmap-year]').forEach(button => button.onclick = () => { habitHeatmapYear = Number(button.dataset.heatmapYear); const habit = (state.habits || []).find(item => item.id === document.querySelector('[data-habit-detail]')?.dataset.habitDetail); if (habit) openHabitDetail(habit.id); });
}

function bindHabitDetail() {
  // 年度图可横向滚动，打开当前年份时把今天放到可见区域，不改任何记录。
  requestAnimationFrame(() => {
    const scroller = $('.habit-heatmap-scroll');
    const grid = $('.habit-heatmap-grid');
    const todayCell = grid?.querySelector(`[aria-label^="${dateKey()} "]`);
    if (scroller && todayCell) scroller.scrollLeft = Math.max(0, todayCell.getBoundingClientRect().left - grid.getBoundingClientRect().left - scroller.clientWidth / 2);
  });
  $('#habit-settings')?.addEventListener('click', () => callHelper('openHabitManager'));
  $$('[data-habit-switch]').forEach(button => button.onclick = () => openHabitDetail(button.dataset.habitSwitch));
  $$('[data-heatmap-year]').forEach(button => button.onclick = () => {
    habitHeatmapYear = Number(button.dataset.heatmapYear);
    if (activeHabitId) openHabitDetail(activeHabitId);
  });
}

registerView('statistics', statsView);
registerBinder(bindStats);
registerHelper('warmWeeklyLifeMetrics', (now = new Date()) => warmWeeklyLifeMetrics(state, callHelper('previousCompleteWeekRange', now)));
registerHelper('openHabitDetail', openHabitDetail);
