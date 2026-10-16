import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const iconBackground = await readFile(new URL('../android/app/src/main/res/values/ic_launcher_background.xml', import.meta.url), 'utf8');
const launchTheme = await readFile(new URL('../android/app/src/main/res/values/styles.xml', import.meta.url), 'utf8');
const androidStrings = await readFile(new URL('../android/app/src/main/res/values/strings.xml', import.meta.url), 'utf8');
const capacitor = await readFile(new URL('../capacitor.config.json', import.meta.url), 'utf8');
const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('custom launch animation is removed and the app shell renders directly', () => {
  assert.doesNotMatch(html, /id="launch-overlay"|class="launch-film"|launch-ink-logo-v1\.webm/);
  assert.match(html, /<div class="phone-shell">/);
  assert.match(app, /async function boot\(\)/);
  assert.match(app, /boot\(\);/);
});

test('startup has no artificial film wait or watchdog', () => {
  assert.doesNotMatch(app, /launchTimelineReady|launch-playing|launch-done|warmLaunchWatchdog/);
  assert.doesNotMatch(html, /warmLaunchWatchdog|launch-done/);
  const escapedVersion = packageInfo.version.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  assert.match(html, new RegExp(`app\\.js\\?v=${escapedVersion}`));
});

test('native startup keeps a minimal transparent system transition', () => {
  assert.match(iconBackground, /#F2E8D8/);
  assert.match(launchTheme, /windowSplashScreenAnimatedIcon">@drawable\/splash_transparent_icon/);
  assert.match(launchTheme, /postSplashScreenTheme">@style\/AppTheme\.NoActionBar/);
});

test('visible app name is unified without changing the Android application identity', () => {
  assert.match(html, /<title>Nook<\/title>/);
  assert.match(androidStrings, /<string name="app_name">Nook<\/string>/);
  assert.equal(JSON.parse(capacitor).appName, 'Nook');
  assert.equal(JSON.parse(capacitor).appId, 'com.mine.warmjournal');
});
