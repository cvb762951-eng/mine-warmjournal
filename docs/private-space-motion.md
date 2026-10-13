# 私密空间 · 动效方案（清简 · 设计稿）

> 分支 `grok/private-space-motion-design` · **只设计、不进 App 运行时代码**  
> 承接 #36 第 10 节 V1–V3，补全入口 / 列表 / 媒体 / 锁面 / 空态 / 与 #40 的边界  
> 演示页：`preview/private-space-motion.html`

---

## 0. 一句话

私密空间是「今日日期长按」进入的全路由（`private-vault`），不是二级页。动效只旁听 DOM 与可见性：加密、锁定、指纹、观看记录一行不改；点照片开大图仍然无入场共享转场。rich 要有深度与弹簧感，lite / none 还能用、不卡。

---

## 1. 现状入口（对着代码核对）

| 表面 | 选择器 / 路由 | 文件 |
|---|---|---|
| 入口 | 今日 `#today-date-secret` 长按 → `go('private-vault')` | `views/today.js` `bindPrivateVaultDateHold` |
| 锁面 / 首次设置 | `.vault-locked-view .vault-lock-paper`、`#vault-unlock-form` / `#vault-setup-form` | `views/private-vault.js` `vaultGate` |
| 解锁后首页 | 文件夹网格 `.vault-folder-grid` / `.vault-folder-card` | `folderHome` / `folderCard` |
| 文件夹内容 | `.vault-content-head` + `.vault-grid` / `.vault-item`；筛选条 `.vault-media-filter` | `privateVaultView` |
| 空态 | `.vault-empty` | 同上 |
| 照片大图 | `.modal.vault-photo-modal` / `#vault-photo-viewer`（已 `animation:none`） | `openVaultPhoto` |
| 视频流 | 沉浸播放器（左右进度、上下切、长按 2×） | `openVaultVideo` |
| 弹层 | 导入 / 从随手拍 / 文件夹表单 / 条目菜单 / 导出 / 恢复 / 封面选择 | 多个 `modal(...)` |
| 安全条 | `.vault-security-note`、`#vault-passwordless`、`#vault-lock` | 解锁页顶 |
| 后台锁 | `scheduleVisibilityLock` + `visibilitychange` | **逻辑不改**，动效只叠遮罩 |
| 非范围 | 「本机加密密码本」`password-vault` | 另一条路由，本方案不碰 |

实施时仍用 MutationObserver / 捕获阶段只读点击（同 #36）：不 `preventDefault`、不改 `private-vault.js` / `private-vault.js`（core）加密 API。

---

## 2. 铁律（照抄）

1. **只清简。** `:root[data-theme="plain"]` 外不加规则。  
2. **只动 `transform` / `opacity`。** 模糊只出现在「切出遮罩」一层，且淡出时只补间 opacity。  
3. **三档：** rich / lite / `prefers-reduced-motion` → none。  
4. **照片永不拉伸。** 飞行克隆摆在 contain 显示框上，单一 `scale(s)`；两端比例差 > 0.5% 则放弃飞行只淡入（同 #36 §10.0）。  
5. **点照片 / 视频开大图：无共享元素入场。** chrome 可淡入淡出；媒体本体直接到位（已有 `revealViewerImageWhenDecoded`）。  
6. **不碰：** 图集一叠牌、日记折叠、照片过渡、Photo Story 字号、`photoFrameLayersHtml` 结构、数据层、通知、加密 / 锁 / 观看记录、`FLAG_SECURE`（cvb 明确不要截图拦截）。

---

## 3. 动效清单

| # | 名称 | 何时 | rich 一句话 | 总时长预算 |
|---|---|---|---|---|
| **P0** | 入口落锁 | 从今日切到锁面 | 锁纸轻 `scale(.97→1)` + 淡入，锁徽一次极轻呼吸 | ≤ 280ms |
| **V1** | 解锁仪式 | 指纹/密码成功 → 解锁页 | 锁面中缝上下分开 + 缝光 + 内容斜向错开浮现 | ≤ **430ms，全程可点** |
| **V2** | 切出遮罩 | `visibilitychange=hidden` | 立即盖模糊锁徽遮罩；回来等两帧后淡出，锁纸 `scale(.98→1)` | 盖上 0ms；揭开 260ms |
| **V3** | 封面原位展开 | 点文件夹封面 ↔ 返回列表 | 封面照片 contain 框飞到网格同图；其余按距离浮现；返回反向 | 开 420ms / 回 340ms |
| **V4** | 空态入场 | `.vault-empty` 出现 | 图标 `scale(.92→1)` + 文案上移 8px 淡入 | 240ms |
| **V5** | 网格显影 | 解锁后 / 进文件夹 / 筛选切换后首屏 | 文件夹卡 `(行+列)×24ms` 斜向；内容格距离错开；筛选切换只淡交叉 | 首批 ≤ 320ms |
| **V6** | 媒体开合（视觉） | 开/关照片 modal、视频层 | **媒体无飞行**；chrome 120–180ms 淡入；关时 chrome 先隐 | — |
| **V7** | 主动锁定 | 点 `#vault-lock` | 内容快速压暗淡出 → 锁面到位（可与 V1 残影反向共用半套） | ≤ 300ms |
| **V8** | 弹层内容 | 导入 / 随手拍选择 / 菜单 | 复用 #40 Z3 下拉 + Z4 依次浮现；危险项略晚一拍 | 同 #40 |
| **V9** | 选择模式 | 点「选择」进多选 | 底栏 `translateY(100%→0)`；选中卡 `scale(1.02)` 轻弹 | 220ms |
| **V10** | 锁面等待 | 指纹面板弹出前 | 锁徽 1.6s 一次极慢呼吸（opacity），失败时纸面轻 nudge | 循环可打断 |

参数细节与 #36 §10.1 对齐处不重复抄；本文件只写增量与对接约定。

### 3.1 关键参数（增量）

| 项 | 参数 |
|---|---|
| P0 | 锁纸 240ms `cubic-bezier(.16,1,.3,1)`；锁徽呼吸 1 次 `scale(1→1.06→1)` 420ms，可被点击打断 |
| V4 | 图标 200ms `--pl-ease-out`；文案 delay 40ms、位移 8px |
| V5 筛选 | 旧格 120ms 淡出同时新格 160ms 淡入；不做位移，避免网格跳动 |
| V7 | 解锁区 `opacity 1→0` + `translateY(6px)` 160ms；锁面 40ms 起 `scale(.98→1)` 220ms |
| V9 | 底栏 `--pl-spring-snappy`；选中阴影用伪元素 opacity，不改 layout |
| V10 | 呼吸只改 opacity `1↔.72`；nudge 同 #40 Z8（`translateY(6px)` 半程） |

### 3.2 三档降级

| 项 | rich | lite | none |
|---|---|---|---|
| P0 | 缩放+淡入+呼吸 | 只淡入 | 直接显示 |
| V1 | 分开+缝光+浮现 | 锁面 160ms 淡出+浮现 | 直接显示 |
| V2 | 模糊遮罩 | 实色 `#EAF0F8` | 实色，回来直接移除 |
| V3 | 飞行+幽灵框+浮现 | 飞行+浮现 | 直接切页 |
| V4 / V5 | 全套 | 整块淡入 | 关 |
| V6 | chrome 淡 | chrome 淡（更短） | 无 |
| V7 | 压暗+锁面 | 只交叉淡 | 直接锁 |
| V8 | 跟 #40 | 跟 #40 lite | 跟 #40 none |
| V9 | 底栏+选中弹 | 底栏无弹 | 底栏瞬切 |
| V10 | 呼吸+nudge | 无呼吸，保留 nudge | 无 |

自适应：会话内 1s 长帧 >3 次（>32ms）切 lite（同 #36），不写存储。

---

## 4. 与 #40（二级页 / 弹层）的边界

私密空间是 **`#app > .private-vault-view` 全路由**，不是 `.subpage-layer`。

| 能力 | 是否套用 | 约定 |
|---|---|---|
| Z1 原位展开 | **否**（路由切换） | 入口用 P0，不用标题飞行 |
| Z2 右滑返回 | **路由级返回可用系统/浏览器返回**；**文件夹内「返回文件夹」走 V3，不走 Z2** | `#vault-back-folders`、`.vault-folder-open` 起手区加 `data-no-swipe-back`（防御：若将来包进 subpage） |
| Z3 弹层下拉 | **是** | 导入 / 菜单 / 表单走 Z3；**照片 modal、视频播放器禁止下拉关闭**（已有 `animation:none`，再加 `data-no-sheet-drag`） |
| Z4 内容浮现 | **是**（V8） | 与 V1/V5 cascade 共用工具函数 |
| 照片 / 视频手势 | **排除** | 舞台 `touch-action` / `data-no-swipe-back`；两指缩放、上下切视频不得被 Z2/Z3 抢走 |
| `#app` transform | 弹层打开时 #40 会缩背景 | 锁面 `position` 相关、视频 fullscreen 控件需真机看是否位移（#40 复查已记） |

**冲突结论：** 只要照片 modal / 视频层 / 文件夹封面按钮标好 `data-no-swipe-back` + `data-no-sheet-drag`，与日记牌组、图集翻牌同一策略，不会抢手势。

---

## 5. 明确不改 / 不做

- `lockPrivateVault` / `unlock*` / `scheduleVisibilityLock` / 免密 / 指纹 native 流程 / 观看记录写入  
- `FLAG_SECURE`、多任务缩略图原生遮罩（V2 只挡 WebView 回来那一闪）  
- 点照片共享元素放大、视频封面 FLIP 进播放器  
- 改文件夹数据结构、`parentId`、导入加密管线  
- 密码本（`password-vault`）动效（可另开）  
- 经典 / 暖阳主题  

---

## 6. 落地建议（给 Gemini / Grok 4.7）

1. **旁听模块**扩 `motion-layers.js`（或 `motion-vault.js` 再由 layers 挂载），零 import `model` / `storage` / `private-vault` core。  
2. 选择器表写进测试：锁纸、文件夹封面、`data-vault-cover-item`、`.vault-photo-modal`、`.vault-empty`。  
3. 顺序：V2（安全观感）→ V1 → V3 → V5/V4 → P0/V7 → V8/V9 → V6/V10。  
4. 验收：三档切换；比例飞行误差；解锁中途连点可操作；切后台再回；文件夹进退；开照片/视频无拉伸；#40 弹层在私密内下拉不误关播放器。  

---

## 7. 演示页操作说明

打开 `preview/private-space-motion.html`：

1. 顶栏切换 rich / lite / none。  
2. 「模拟长按进入」→ 锁面（P0）。  
3. 「指纹解锁」→ V1。  
4. 「切出再回来」→ V2。  
5. 点文件夹封面 → V3 展开；返回 → 飞回。  
6. 「空文件夹」→ V4；「筛选」→ V5。  
7. 点照片 → V6（无飞行，仅 chrome）；「锁定」→ V7。  
8. 「打开导入」→ V8 弹层；「选择」→ V9。

---

## 8. 待 cvb 拍板

1. V1 中缝分开是否保留（#36 已有），还是改成「锁徽溶入纸面」更克制？  
2. 文件夹内容页是否要轻微景深（背景文件夹网格 `scale(.96)`）——会动到 #app 子树，可能叠加 #40 的 transform。默认 **不做景深**，只做封面飞行。  
3. 多选底栏颜色跟清简蓝灰还是沿用现有牛皮纸质感（演示用中性条，实施跟现网 CSS）？  
4. 密码本要不要下一轮用同一套管法？默认本轮不做。  
