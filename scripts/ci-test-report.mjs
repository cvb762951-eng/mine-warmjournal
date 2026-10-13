import { spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');

export function parseTapSummary(text) {
  const pick = name => {
    const match = String(text || '').match(new RegExp(`^# ${name} (\\d+)$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  return {
    tests: pick('tests'),
    pass: pick('pass'),
    fail: pick('fail'),
    skipped: pick('skipped'),
    cancelled: pick('cancelled')
  };
}

export function isRegression(currentFail, baselineFail) {
  if (currentFail == null || baselineFail == null) return false;
  return currentFail > baselineFail;
}

function runSuite(cwd) {
  const logPath = join(tmpdir(), `wj-tap-${process.pid}-${Date.now()}.txt`);
  const fd = openSync(logPath, 'w');
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=120000'], {
    cwd,
    stdio: ['ignore', fd, fd]
  });
  closeSync(fd);
  const text = readFileSync(logPath, 'utf8');
  rmSync(logPath, { force: true });
  return { status: result.status ?? 1, summary: parseTapSummary(text) };
}

function sameLockfile(rev) {
  try {
    const theirs = execFileSync('git', ['show', `${rev}:package-lock.json`], { cwd: root });
    const ours = readFileSync(join(root, 'package-lock.json'));
    const hash = value => createHash('sha256').update(value).digest('hex');
    return hash(theirs) === hash(ours);
  } catch {
    return false;
  }
}

function runBaseline(rev) {
  const dir = mkdtempSync(join(tmpdir(), 'wj-base-'));
  execFileSync('git', ['worktree', 'add', '--detach', '--force', dir, rev], { cwd: root, stdio: 'inherit' });
  try {
    const linked = join(dir, 'node_modules');
    if (sameLockfile(rev) && existsSync(join(root, 'node_modules'))) {
      symlinkSync(join(root, 'node_modules'), linked, 'dir');
    } else {
      const install = spawnSync('npm', ['ci', '--ignore-scripts'], { cwd: dir, stdio: 'inherit' });
      if (install.status !== 0) throw new Error('baseline npm ci failed');
    }
    return runSuite(dir);
  } finally {
    const linked = join(dir, 'node_modules');
    try {
      if (lstatSync(linked).isSymbolicLink()) unlinkSync(linked);
    } catch { /* 没有链过来 */ }
    try {
      execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: root, stdio: 'ignore' });
    } catch { /* worktree 记录清不掉时直接删目录 */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

function summaryLine(label, summary, status) {
  if (summary.fail == null) return `- ${label}：没有解析到测试汇总（退出码 ${status}）`;
  return `- ${label}：${summary.fail} 失败 / ${summary.pass ?? '?'} 通过 / ${summary.tests ?? '?'} 总计（退出码 ${status}）`;
}

function writeOutputs(fields) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(fields).map(([key, value]) => `${key}=${value ?? ''}`).join('\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const baselineFlag = process.argv.indexOf('--baseline');
  const baselineRev = baselineFlag >= 0 ? process.argv[baselineFlag + 1] : '';
  const current = runSuite(root);
  let baseline = null;
  let baselineError = '';
  if (baselineRev) {
    try {
      baseline = runBaseline(baselineRev);
    } catch (error) {
      baselineError = error?.message || String(error);
    }
  }
  const regressed = isRegression(current.summary.fail, baseline?.summary?.fail ?? null);
  const lines = [
    '### 单元测试',
    '',
    summaryLine('本次提交', current.summary, current.status)
  ];
  if (baseline) lines.push(summaryLine(`基线 ${baselineRev}`, baseline.summary, baseline.status));
  else if (baselineRev) lines.push(`- 基线 ${baselineRev}：没跑成（${baselineError || '未知错误'}），不因此失败`);
  else lines.push('- 没有基线可比较，失败数只写入摘要');
  lines.push(regressed
    ? `- 比基线多失败了，这个任务会失败（${current.summary.fail} > ${baseline.summary.fail}）`
    : '- 失败数没有比基线更多');
  const markdown = `${lines.join('\n')}\n`;
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  writeOutputs({
    fail: current.summary.fail ?? '',
    pass: current.summary.pass ?? '',
    tests: current.summary.tests ?? '',
    baseline_fail: baseline?.summary?.fail ?? '',
    regressed: regressed ? 'true' : 'false'
  });
  if (regressed) process.exit(1);
}
