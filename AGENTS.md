# AGENTS.md — 暖色生活志 Mine 本地 agent 工作手册

> 给 cvb 本机上的 agent 用：群里的几个 bot（Gemini 前端 / 软件bot 数据与审查 / 打包bot 出包）额度用完时，你要一个人把「改 → 自审 → 合 → 出包」整套流程走完。用中文沟通，称呼用户 **cvb**。

## 1. 项目概览

- App：**暖色生活志 Mine**，cvb 个人自用，主力机 **OnePlus Ace 3**（性能够，不用为低端机妥协，但别浪费内存）。
- 技术栈：**Capacitor 8 + vanilla JS + esbuild**（没有框架）。`npm run build` 把资源打进 `www/`，`npx cap sync android` 同步到 `android/`。
- 主要目录：`views/`（各页面）、`model.js`（数据模型/归一化）、`core.js`（state、存储、通用工具）、`backup.js`（加密备份）、`photo-thumbs.js` / `photo-frame.js`（缩略图与相框）、`views/private-vault.js`（私密空间）、`styles.css` + `themes-plain.css` / `themes-plain-light.css`（主题）、`tests/*.test.mjs`、`previews/`（预览页）。

## 2. 工作流程

0. 前提：cvb 电脑上的本地 agent 需要先 `gh auth login`，账号对本仓库有 push 权限（推分支、开 PR、合并都靠它）。
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
- [ ] 没人审的改动，出包前先在真机装上点一遍改到的页面，有问题就别发版。

## 6. 合并

1. 推分支，开 **草稿 PR**，描述用中文写三段：**为什么 / 改了什么 / 怎么验证**。
2. 自审清单全部通过、测试只剩基线 3 个失败后，转正式 PR，**squash 合并**到 main（`gh pr merge <号> --squash --match-head-commit <head sha>`）。
3. 注意：`main` 有 push 就会触发出包工作流（见下节），但只有 versionCode 升高的提交才会真正发 Release。

## 7. 出包（只在功能 PR 都合完后做）
1. 先 git pull 最新 main，确认没有别的 PR 正要合（gh pr list）。发版提交之后再合别的 PR，会把发版那次构建取消掉。
2. 版本号同步改 5 处，patch +1、versionCode +1，绝不能降：
   - package.json 的 version
   - app-updater.js 的 APP_VERSION_NAME / APP_VERSION_CODE
   - android/app/build.gradle 的 versionName / versionCode
   - index.html 里所有 ?v=
   - release-notes.js 末尾加一条 { name, date, time(北京时间), title, summary, bullets, screenshots: [] }
   规则：1.1.y 的 versionCode = 101 + y。
3. 跑 node scripts/check-versions.mjs 必须显示「版本一致」，npm test 只允许原有 3 个失败。
4. 开分支提交「Release x.y.z (code)」→ 开 PR → squash 合进 main。不用手动触发：合进 main 后，android-release 工作流发现版本变了，会自动签名出 APK 并建 Release。
5. 等 Actions 跑完（约 3 分钟），确认 Release vX.Y.Z 里有 warmjournal-X.Y.Z-CODE.apk 和 version.json，把下载链接发给 cvb：
   https://github.com/cvb762951-eng/mine-warmjournal/releases/download/vX.Y.Z/warmjournal-X.Y.Z-CODE.apk
6. 如果 Release 没建出来（构建被取消、测试门禁拦了），从 Actions 那次运行的产物里手动建 Release，tag 为 vX.Y.Z，上传 apk 和 version.json。
签名密钥在仓库 Secrets 里，绝不要改签名配置、也不要生成新 keystore，不然装不上会丢数据。

补充（工作流触发条件，对照 `.github/workflows/android-release.yml` 核对）：工作流名 `Android release APK`，push 到 main、pull_request、手动 workflow_dispatch 都会跑；只有 push 到 main 且 versionCode 高于最新 Release、签名证书校验通过时才建 Release，PR 上只打包并上传 artifact，不发 Release。
