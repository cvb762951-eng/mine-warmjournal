# AGENTS.md — 暖色生活志 Mine 本地 agent 工作手册

> 给 cvb 本机上的 agent 用：群里的几个 bot（Gemini 前端 / 软件bot 数据与审查 / 打包bot 出包）额度用完时，你要一个人把「改 → 自审 → 合 → 出包」整套流程走完。用中文沟通，称呼用户 **cvb**。

## 1. 项目概览

- App：**暖色生活志 Mine**，cvb 个人自用，主力机 **OnePlus Ace 3**（性能够，不用为低端机妥协，但别浪费内存）。
- 技术栈：**Capacitor 8 + vanilla JS + esbuild**（没有框架）。`npm run build` 把资源打进 `www/`，`npx cap sync android` 同步到 `android/`。
- 主要目录：`views/`（各页面）、`model.js`（数据模型/归一化）、`core.js`（state、存储、通用工具）、`backup.js`（加密备份）、`photo-thumbs.js` / `photo-frame.js`（缩略图与相框）、`views/private-vault.js`（私密空间）、`styles.css` + `themes-plain.css` / `themes-plain-light.css`（主题）、`tests/*.test.mjs`、`previews/`（预览页）。

## 2. 工作流程

1. 开工前 `git checkout main && git pull`，从最新 main **新建分支**（`feat/…`、`fix/…`、`perf/…`、`docs/…`）。**永远不要直接改 main。**
2. 同一件事在同一个对话里做完，别中途换对话丢上下文。
3. 小步提交，提交信息用中文写清楚改了什么。

## 3. 前端规则

- 只改 **清简主题**（`:root[data-theme="plain"] …`），除非 cvb 明确要求改暖色/经典主题。
- **禁止** `:has()` / `:is()` / `:where()`（旧版 Chromium / 厂商 WebView 不兼容）。
- 颜色一律用主题变量（`var(--ink)`、`var(--ink-muted)`、`var(--plain-surface)`、`var(--pl-blue-soft)` 等），**不写死颜色**，也不要写 `var(--x, #hex)` 这种带写死备用色的形式。`themes-plain.css` 里有测试专门检查。用之前先确认变量真的有定义。
- 照片：
  - 列表、封面、相册网格先显示 **480 缩略图**（`photo-thumbs.js`）；只有 **显示宽度 × devicePixelRatio > 480** 才升级到原图（`needsFullResolution`），虚化铺底层永远停在 480。
  - 视频封面不升级原图。
  - 照片按原比例 `contain` 显示，不裁切、不拉伸（禁止对内容图用 `object-fit: cover`）。
- 图标字体（Material Symbols）可能加载失败：不要让图标名（如 `photo_camera`）作为文字露出来，要有 `aria-hidden` 或兜底。

## 4. 数据 / 安全红线（未经 cvb 明确要求不许碰）

- 不改存储结构和迁移、加密、提醒/通知、私密空间逻辑。
- 私密空间：解密后的缓存**绝不**和普通数据混在一起，上锁时必须清空；私密内容**绝不**出现在首页或任何普通列表。
- **绝不加 FLAG_SECURE**（cvb 明确拒绝过）。
- 绝不提交密钥：keystore、`.env`、`local.properties`、签名口令都不进仓库，也不在聊天里要明文密码。
- 备份/导出/导入必须保留完整的 `state.settings`（目前是整体合并 `{...state.settings, ...raw.settings}`，新加设置项不要改成白名单）。

## 5. 自审清单（数据 / 性能）

合并前逐条过：

- [ ] 从头读一遍自己的 diff（`git diff main...HEAD`）。
- [ ] 定时器、IntersectionObserver、MutationObserver、事件监听：节点移除和离开页面时都清理了；异步回调里检查 `isConnected` / 数据是否已变。
- [ ] 图片加载有失败兜底（失败保留缩略图或占位，不出破图、不闪）。
- [ ] 不在视口外长期持有大尺寸解码图（离开视口换回缩略图）。
- [ ] 没有缩略图的旧记录照样能完整显示。
- [ ] `npm test`：基线只有 **3 个已知失败**（ai-density、ai-dock-overlap、browser media IndexedDB）。**多出任何一个失败就停下**，先修或回报 cvb。
- [ ] `npm run build` 通过。
- [ ] 在浏览器里用清简主题打开改动的页面看一眼（`previews/` 里可以做加载真实样式的预览页）。

## 6. 合并

1. 推分支，开 **草稿 PR**，描述用中文写三段：**为什么 / 改了什么 / 怎么验证**。
2. 自审清单全部通过、测试只剩基线 3 个失败后，转正式 PR，**squash 合并**到 main（`gh pr merge <号> --squash --match-head-commit <head sha>`）。
3. 注意：`main` 有 push 就会触发出包工作流（见下节），但只有 versionCode 升高的提交才会真正发 Release。

## 7. 出包（由打包bot 补充）

以下是从仓库里能确认的信息，细节待打包bot 补充：

- **版本号位置**（发版时要一起改，保持一致）：
  - `android/app/build.gradle`：`versionCode` / `versionName`
  - `package.json`：`"version"`
  - `index.html`：资源后缀 `?v=x.y.z`
  - `app-updater.js` 中的当前版本号（如有）
  - `release-notes.js`：`RELEASE_NOTES` 新加一条，key = versionCode（`tests/release-activity.test.mjs` 会检查当前版本有说明条目）
- **规则**：每次发版 patch + 1、versionCode + 1（1.1.y → versionCode = 101 + y，例如 1.1.34 → 135）。
- **工作流**：`.github/workflows/android-release.yml`（name: `Android release APK`）。触发：push 到 `main`、`pull_request`、手动 `workflow_dispatch`。只有 push 到 main、versionCode 高于最新 Release、签名证书校验通过时才创建 GitHub Release，附上 `warmjournal-<versionName>-<versionCode>.apk` 和 `version.json`；PR 只上传 artifact。签名来自仓库 Secrets（KEYSTORE_BASE64 / KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD）。
- 发版说明里列出本次合并的 PR。
- 出包后把**完整的 Release APK 下载链接**明文发给 cvb。
- 改版本号、改工作流**只在出包这一步做**，单独一个 PR，最后合；平时功能 PR 不碰版本号。
