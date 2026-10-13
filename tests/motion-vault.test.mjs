import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  VAULT_MOTION, folderBackgroundScale, unlockMode, uniformFlightScale, flightTransform,
  ghostFrameTransform, cellDelay, noteLongFrame, vaultMotionTier, sampleVaultJank,
  shieldShouldHold, visibleItemIndexes, lockGhostSpec,
} from '../motion-vault.js';

const vault = readFileSync(new URL('../views/private-vault.js', import.meta.url), 'utf8');
const motion = readFileSync(new URL('../motion-vault.js', import.meta.url), 'utf8');
const layers = readFileSync(new URL('../motion-layers.js', import.meta.url), 'utf8');
const plain = readFileSync(new URL('../themes-plain.css', import.meta.url), 'utf8');
const light = readFileSync(new URL('../themes-plain-light.css', import.meta.url), 'utf8');

test('解锁三档：rich 缝隙分开，lite 淡入，none 直接切', () => {
  assert.equal(unlockMode('rich'), 'split');
  assert.equal(unlockMode('lite'), 'fade');
  assert.equal(unlockMode('none'), 'cut');
  assert.match(motion, /scale\(\.94\)/);
  assert.match(motion, /translate3d\(0,-32px,0\) scale\(1\.03\)/);
});

test('进入文件夹不缩小背后页面', () => {
  assert.equal(VAULT_MOTION.folderDepth, false);
  assert.equal(folderBackgroundScale(), 1);
  assert.doesNotMatch(motion, /scale\(\.96\)/);
  assert.doesNotMatch(motion, /pl-folder-depth|folderDepthScale/);
});

test('照片飞行只用一个 scale，比例差超过 0.5% 就放弃', () => {
  assert.equal(uniformFlightScale({ width: 400, height: 300 }, { width: 200, height: 150 }), 0.5);
  assert.equal(uniformFlightScale({ width: 400, height: 300 }, { width: 401, height: 300 }), 401 / 400);
  assert.equal(uniformFlightScale({ width: 400, height: 300 }, { width: 160, height: 90 }), null);
  const fly = flightTransform({ left: 10, top: 20, width: 100, height: 75 }, { left: 30, top: 40, width: 200, height: 150 });
  assert.equal(fly, 'translate(20.00px, 20.00px) scale(2.0000)');
  assert.equal(flightTransform({ left: 0, top: 0, width: 400, height: 300 }, { left: 0, top: 0, width: 160, height: 90 }), null);
  assert.match(ghostFrameTransform({ left: 0, top: 0, width: 100, height: 50 }, { left: 8, top: 12, width: 40, height: 30 }), /scale\(0\.4000, 0\.6000\)/);
  assert.match(motion, /object-fit:contain|object-fit: contain/);
});

test('网格错开不超过首批 320ms，长帧超过 3 次降到 lite', () => {
  assert.equal(cellDelay(0, 2), 0);
  assert.equal(cellDelay(3, 2, 24, 0), 48);
  assert.equal(cellDelay(40, 2, 24, 90, 320), 320);
  let state = { windowStart: 0, long: 0, tier: 'rich' };
  state = noteLongFrame(state, 40, 10);
  state = noteLongFrame(state, 40, 20);
  state = noteLongFrame(state, 40, 30);
  assert.equal(state.tier, 'rich');
  state = noteLongFrame(state, 40, 40);
  assert.equal(state.tier, 'lite');
  const reset = noteLongFrame({ windowStart: 0, long: 4, tier: 'rich' }, 10, 1100);
  assert.equal(reset.long, 0);
  assert.equal(reset.tier, 'rich');
});

test('动效模块不碰加密、锁定时机、观看记录和密码本', () => {
  assert.match(layers, /installVaultMotion\(\)/);
  assert.doesNotMatch(motion, /from '\.\/(core|storage|notifications|private-vault|model)\.js'/);
  assert.doesNotMatch(motion, /lockPrivateVault|scheduleVisibilityLock|watchHistory|FLAG_SECURE|password-vault/);
  assert.match(vault, /function scheduleVisibilityLock\(\) \{/);
  assert.match(vault, /pendingVisibilityLock = setTimeout\(\(\) => \{/);
  assert.match(vault, /\}, 300\);/);
  assert.doesNotMatch(motion, /FLAG_SECURE/);
});

test('文件夹返回和封面免右滑，照片视频层不接下拉', () => {
  assert.match(vault, /class="vault-folder-open" data-no-swipe-back/);
  assert.match(vault, /id="vault-back-folders" data-no-swipe-back/);
  assert.match(vault, /id="vault-photo-viewer" data-no-swipe-back data-no-sheet-drag/);
  assert.match(vault, /modal\.vault-photo-modal'\)\?\.setAttribute\('data-no-sheet-drag'/);
  assert.match(vault, /modal\.vault-feed-modal/);
  assert.match(vault, /#warm-video-player'\)\?\.setAttribute\('data-no-swipe-back'/);
  assert.match(vault, /\.warm-video-stage'\)\?\.setAttribute\('data-no-swipe-back'/);
  assert.match(layers, /\.vault-photo-modal/);
});

test('长帧降级只留在私密空间，不写全局 data-pl-motion', () => {
  const state = { windowStart: 0, long: 0, tier: 'rich' };
  const idle = sampleVaultJank({ inVault: true, animating: false, localTier: 'rich', state, dt: 80, now: 40 });
  assert.equal(idle.localTier, 'rich');
  assert.equal(idle.state.long, 0);
  assert.equal(idle.watching, false);
  assert.equal(idle.writeGlobal, false);

  let sample = { localTier: 'rich', state, watching: true, writeGlobal: false };
  for (let i = 1; i <= 4; i += 1) {
    sample = sampleVaultJank({
      inVault: true,
      animating: true,
      localTier: sample.localTier,
      state: sample.state,
      dt: 40,
      now: i * 20,
    });
  }
  assert.equal(sample.localTier, 'lite');
  assert.equal(sample.watching, false);
  assert.equal(sample.writeGlobal, false);
  assert.equal(vaultMotionTier({ globalTier: 'rich', localTier: 'lite', inVault: true }), 'lite');
  assert.equal(vaultMotionTier({ globalTier: 'rich', localTier: 'lite', inVault: false }), 'rich');
  assert.equal(vaultMotionTier({ globalTier: 'none', localTier: 'lite', inVault: true }), 'none');

  const left = sampleVaultJank({ inVault: false, animating: true, localTier: 'lite', state: sample.state, dt: 40, now: 200 });
  assert.equal(left.localTier, 'rich');
  assert.equal(left.state.long, 0);
  assert.equal(left.writeGlobal, false);

  assert.match(motion, /function noteVaultAnimation/);
  assert.match(motion, /sampleVaultJank\(/);
  assert.match(motion, /resetVaultJank\(\)/);
  assert.doesNotMatch(motion, /plMotion\s*=\s*['"]/);
  assert.doesNotMatch(motion, /setAttribute\(\s*['"]data-pl-motion['"]/);
  assert.doesNotMatch(motion, /ensureJank/);
});

test('锁定过渡不克隆已解锁页面', () => {
  assert.deepEqual(lockGhostSpec(), { cloneContent: false, kind: 'plain-block' });
  const ghost = motion.slice(motion.indexOf('function armLockGhost'), motion.indexOf('function hideImages'));
  assert.match(ghost, /function armLockGhost/);
  assert.doesNotMatch(ghost, /cloneNode|innerHTML|<img|thumb/);
  assert.match(ghost, /pv-lock-ghost/);
  assert.match(ghost, /--plain-canvas/);
  assert.match(ghost, /createElement\('div'\)/);
  const filter = motion.slice(motion.indexOf("closest?.('[data-vault-media-filter]')"), motion.indexOf("closest?.('#vault-lock')"));
  assert.match(filter, /visibleItemIndexes\(/);
  assert.doesNotMatch(filter, /grid\.cloneNode/);
  assert.deepEqual(visibleItemIndexes([
    { top: -40, bottom: -1 },
    { top: 10, bottom: 80 },
    { top: 900, bottom: 980 },
  ], 800, 12), [1]);
  assert.equal(visibleItemIndexes(Array.from({ length: 20 }, (_, i) => ({ top: i * 10, bottom: i * 10 + 8 })), 400, 12).length, 12);
  assert.equal(shieldShouldHold({ hiddenMs: 200, locked: false, waitedMs: 0 }), false);
  assert.equal(shieldShouldHold({ hiddenMs: 300, locked: false, waitedMs: 0 }), true);
  assert.equal(shieldShouldHold({ hiddenMs: 400, locked: true, waitedMs: 0 }), false);
  assert.equal(shieldShouldHold({ hiddenMs: 400, locked: false, waitedMs: 600 }), false);
  for (const css of [plain, light]) {
    const block = css.slice(css.indexOf('三十一 · 私密空间动效'));
    assert.match(block, /blur\(8px\)/);
    assert.doesNotMatch(block, /blur\(24px\)/);
    assert.match(block, /pv-breath 1\.6s ease-in-out 3/);
    assert.doesNotMatch(block, /pv-breath[^;]*infinite/);
  }
});

test('清简多选底栏用主题变量，关键帧只动 transform / opacity', () => {
  for (const css of [plain, light]) {
    const block = css.slice(css.indexOf('三十一 · 私密空间动效'));
    assert.ok(block.length > 200, '私密空间动效样式应写进清简主题');
    assert.match(block, /\.private-vault-view \.vault-bulk-bar \{[^}]*background: var\(--plain-surface\)/);
    assert.match(block, /color: var\(--ink\)/);
    assert.match(block, /background: var\(--pl-blue-soft\)/);
    assert.match(block, /#vault-bulk-delete \{[^}]*var\(--pl-danger\)/);
    assert.doesNotMatch(block, /#[0-9A-Fa-f]{3,8}/);
    const frames = [...block.matchAll(/@keyframes (pv-[\w-]+) \{([^}]+)\}/g)];
    assert.ok(frames.length >= 6);
    for (const [, name, body] of frames) {
      assert.match(body, /opacity|transform/, name);
      assert.doesNotMatch(body, /\b(width|height|top|left|filter|box-shadow|background)\s*:/, name);
    }
  }
});
