import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseGradleVersions, parseUpdaterVersions, parsePackageVersion, readWorkingTreeVersions } from './check-versions.mjs';
import { shouldCreateRelease } from './release-decision.mjs';

const root = resolve(import.meta.dirname, '..');

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function gitShow(rev, file) {
  return git(['show', `${rev}:${file}`], { allowFail: true });
}

function hasCommit(sha) {
  return git(['cat-file', '-e', `${sha}^{commit}`], { allowFail: true }) !== null;
}

function readRevisionVersion(rev) {
  if (!rev || /^0+$/.test(rev)) return null;
  if (!hasCommit(rev)) {
    git(['fetch', 'origin', rev], { allowFail: true });
  }
  const gradleText = gitShow(rev, 'android/app/build.gradle');
  if (gradleText) return parseGradleVersions(gradleText);
  const updaterText = gitShow(rev, 'app-updater.js');
  const packageText = gitShow(rev, 'package.json');
  if (!updaterText && !packageText) return null;
  const updater = updaterText ? parseUpdaterVersions(updaterText) : { versionName: '', versionCode: 0 };
  const pkg = packageText ? parsePackageVersion(packageText) : { versionName: '' };
  return {
    versionName: updater.versionName || pkg.versionName,
    versionCode: updater.versionCode || 0
  };
}

function tagExists(tag) {
  const remote = git(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  return Boolean(remote && remote.trim());
}

function latestRelease() {
  let tag = '';
  try {
    const raw = execFileSync('gh', ['release', 'view', '--json', 'tagName'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    tag = String(JSON.parse(raw)?.tagName || '').trim();
  } catch {
    return { known: false, versionCode: null };
  }
  if (!tag) return { known: false, versionCode: null };
  let gradleText = gitShow(tag, 'android/app/build.gradle');
  if (!gradleText) {
    git(['fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], { allowFail: true });
    gradleText = gitShow(tag, 'android/app/build.gradle');
  }
  if (!gradleText) return { known: true, versionCode: null };
  const { versionCode } = parseGradleVersions(gradleText);
  return { known: true, versionCode: versionCode || null };
}

const current = readWorkingTreeVersions();
const previous = readRevisionVersion(process.env.BEFORE_SHA || '');
const release = latestRelease();
const versionName = current.gradle.versionName;
const versionCode = current.gradle.versionCode;
const decision = shouldCreateRelease({
  eventName: process.env.GITHUB_EVENT_NAME || '',
  ref: process.env.GITHUB_REF || '',
  signed: process.env.SIGNED === 'true',
  certOk: process.env.CERT_OK === 'true',
  versionName,
  versionCode,
  previousVersionName: previous?.versionName || '',
  previousVersionCode: previous?.versionCode || 0,
  tagExists: tagExists(`v${versionName}`),
  latestReleaseKnown: release.known,
  latestReleaseVersionCode: release.versionCode
});

console.log(decision.reason);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `create=${decision.create ? 'true' : 'false'}\nreason=${decision.reason}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### GitHub Release\n\n- ${decision.reason}\n`);
}
