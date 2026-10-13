import { chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法: node scripts/gradlew.mjs <gradle 任务> [...]');
  process.exit(1);
}

const androidDir = resolve(import.meta.dirname, '..', 'android');
const windows = process.platform === 'win32';
const wrapper = windows ? 'gradlew.bat' : './gradlew';
if (!windows) {
  try { chmodSync(resolve(androidDir, 'gradlew'), 0o755); } catch { /* 保持原权限 */ }
}

const result = spawnSync(wrapper, args, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: windows
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
