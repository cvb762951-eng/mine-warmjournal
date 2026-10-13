/**
 * 是否创建 GitHub Release。
 *
 * 必须同时满足：
 * - push 到 main（pull_request / workflow_dispatch 只出产物）
 * - APK 用发布密钥签过，且证书 SHA-256 前缀是 2f0da7fe
 * - 标签 v<versionName> 还不存在
 * - 这次 push 相对 main 的上一个提交，versionName 或 versionCode 变了
 * - 当前 versionCode 严格高于最新 GitHub Release 的 versionCode
 *   （读不到已有 Release 的 versionCode 时拒绝发布，避免重复发一版）
 *
 * 因此把仍是 1.1.28 (129) 的提交合并进 main，只会上传 artifact。
 */
export function shouldCreateRelease(input) {
  const eventName = input?.eventName;
  const ref = input?.ref;
  if (eventName !== 'push' || ref !== 'refs/heads/main') {
    return { create: false, reason: '只有 push 到 main 才会发布 Release' };
  }
  if (!input.signed || !input.certOk) {
    return { create: false, reason: 'APK 没有用发布密钥签名（证书 SHA-256 须以 2f0da7fe 开头）' };
  }
  const versionName = String(input.versionName || '');
  const versionCode = Number(input.versionCode) || 0;
  if (!versionName || !versionCode) {
    return { create: false, reason: '当前版本号缺失' };
  }
  const previousName = String(input.previousVersionName || '');
  const previousCode = Number(input.previousVersionCode) || 0;
  if (!previousName && !previousCode) {
    return { create: false, reason: '读不到上一次提交的版本，拒绝发布' };
  }
  const changed = previousName !== versionName || previousCode !== versionCode;
  if (!changed) {
    return { create: false, reason: `这次 push 没有改版本（仍是 ${versionName} / ${versionCode}）` };
  }
  if (input.tagExists) {
    return { create: false, reason: `标签 v${versionName} 已存在` };
  }
  if (input.latestReleaseKnown) {
    const latest = input.latestReleaseVersionCode == null ? null : Number(input.latestReleaseVersionCode);
    if (latest == null || !Number.isInteger(latest) || versionCode <= latest) {
      const shown = latest == null ? '未知' : String(latest);
      return { create: false, reason: `versionCode ${versionCode} 没有高于最新 Release（${shown}）` };
    }
  }
  return {
    create: true,
    reason: `版本从 ${previousName} (${previousCode}) 升到 ${versionName} (${versionCode})`
  };
}
