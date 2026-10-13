# 暖色生活志 · 视觉规范（给 AI 助手的强制约束）

> **本文件是本项目的视觉宪法。** 任何 AI 助手（Gemini / Claude / Codex 等）在本项目内
> 修改界面样式前，必须先完整读完本文件，并逐条遵守「五条硬规矩」。
>
> ⚠️ 如果你认为某条规矩「不合理」或「过时」——**不要自行推翻**。
> 先向用户说明你的理由，得到明确同意后再改。用户是这套视觉体系的设计者。

---

## 0. 一句话定位

这是一个**暖色纸张画报系统**（warm paper editorial system）——
纸质拼贴 + 杂志画报感。

**它不是**：冷调极简、Material Design、Fluent Design、扁平化、暗黑模式。

---

## 1. 五条硬规矩

### 规矩 1 · 装饰必须是真实图片素材

- 装饰性元素（撕边、麻绳、蕨叶、印章、邮戳、胶带、回形针、干花、纸纹）
  **全部是生成好的 PNG 素材**，用 CSS `background-image` 叠加。
- **CSS 只负责**：布局、尺寸、颜色值、交互状态。
- **禁止**用 CSS 画装饰：`border-radius` 假装撕边、`radial-gradient` 假装纸纹、
  `::after` 画胶带、`box-shadow` 假装纸张厚度。
- 素材清单见 §4。**这些文件不能删、不能替换成 CSS。**

### 规矩 2 · 禁止「通用现代感」组件

明确禁止出现：

| 禁止 | 正确做法 |
|---|---|
| 大圆角卡片（`border-radius: 16~28px`） | 直角纸面（`border-radius: 0`），边缘靠素材自身撕边轮廓 |
| `backdrop-filter: blur()` 玻璃态 | 纸张磨砂质感用低强度模糊（≤8px）或直接用纸纹素材 |
| `background: rgba(255,255,255,.8)` 半透明白卡 | 纸白 `#fdfcf9` + 内容纸素材叠加 |
| 纯灰卡片（`#fff` + 冷调阴影） | 暖调纸面 + `--warm-shadow-ambient` |
| emoji 作为功能图标 | Material Symbols 图标字体 |

> **注意**：`border-radius: 999px` 的**胶囊**（如返回按钮）在本项目里是**允许**的，
> 因为它被当作一枚「纸签」使用。但必须配暖色描边与纸面阴影，不能是纯白玻璃。

### 规矩 3 · 字体双轨

| 用途 | 字体 |
|---|---|
| 标题、页码、数字、统计数值 | `'Newsreader', 'Noto Serif SC', serif` |
| 手写感中文、日期、正文 | `'LXGW WenKai', 'Noto Serif SC', serif` |
| 数字对齐（表格、时间戳） | `ui-monospace, monospace`（等宽，防止跳动） |

**禁止**引入项目未内置的字体。

### 规矩 4 · 颜色只用设计令牌

```css
--warm-canvas:       #f5f1e8   /* 画布暖白 */
--warm-sheet:        #fdfcf9   /* 纸白 */
--warm-ink:          #181614   /* 墨迹黑 */
--warm-ink-secondary:#4a453f
--warm-ink-muted:    #878177
--warm-sage:         #7e9d86   /* 鼠尾草绿 */
--warm-sage-strong:  #4d7056
--warm-terracotta:   #c47e68   /* 砖红 */
--warm-card-border:  1px solid rgba(220,212,198,.65)
--warm-shadow-ambient: 0 2px 10px rgba(32,24,15,.035), 0 10px 28px rgba(32,24,15,.045)
--warm-shadow-floating: 0 18px 48px rgba(32,24,15,.13), 0 2px 8px rgba(0,0,0,.03)
```

**报头深绿**（页首大色块）：`#174536`，配 `today-paper-texture.png` 以 `multiply` 叠加。

**语义色例外**（仅用于错误/删除）：砖红 `#c47e68` 或更深的 `#A34534`。
**不要**用纯蓝、纯紫、霓虹色。

**禁止**：渐变背景（除报头纸纹的 multiply 叠加）、霓虹色、纯黑 `#000`、纯白 `#fff` 作背景。

### 规矩 5 · 移动端必须无横向溢出

必须验证 **360 / 395 / 412 / 540 / 567** 五种宽度。
任何新布局都要保证 `Horizontal overflow = 0`。

长文本处理：单行用 `text-overflow: ellipsis`，多行用 `-webkit-line-clamp`。

---

## 2. 最核心的理念：统一 ≠ 一样

**这是用户最在意的一点，请务必理解。**

你的目标不是「让所有页面长得一样」，而是：

> **同一套版式语言下，不同栏目有不同角色。**
>
> 就像同一本杂志：版式规范统一，但日记是期刊装帧感、账本是票据黄铜夹、
> 习惯档案是蕨叶标本、专注复盘是黄铜刻度、书影音是藏书票。

**推论（必须遵守）**：

- ✅ 允许：各页有专属装饰素材、专属配色气质、专属标题排版
- ✅ 允许：同一体系内合理的视觉变化
- ❌ 禁止：把某个页面的专属装饰换成通用样式
- ❌ 禁止：为了「看起来整齐」而把所有卡片改成完全相同的样式
- ❌ 禁止：看到某页「不一致」就抹平

**判断标准**：改动后，这一页还是不是「它自己」？
如果一个页面的装饰素材被移除后没人认得出这是哪一页，那就是改错了。

---

## 3. 六个二级页的专属身份

**这些素材是各页的「身份标识」，删掉等于毁掉页面。**

| 页面 | 专属素材 | 气质 |
|---|---|---|
| 日记阅读 | `secondary-journal-accent-v1.png` | 期刊装订拼贴、OPENING NOTE 题签、厚纸照片装帧 |
| 账本分析 | `secondary-ledger-accent-v1.png` | 票据与黄铜夹拼贴、三项指标分栏、砖红操作纸 |
| 习惯档案 | `secondary-habit-accent-v1.png` | 蕨叶标本与打卡印记、森林绿状态纸、纸面热力图 |
| 专注复盘 | `secondary-focus-accent-v1.png` | 黄铜计时刻度拼贴、深绿会话题签、纸面报告卡 |
| 书影音档案 | `secondary-media-accent-v1.png` | 书页、胶片、黄铜藏书票拼贴、纸面层级 |
| 课表 | `timetable-campus-collage.png` | 撕纸报头、森林绿周历纸、五张 weekday 纸签、校园窗景页脚 |

---

## 4. 素材清单

### 通用纸张（可复用于任何二级页）

| 文件 | 用途 |
|---|---|
| `assets/secondary-page-canvas-v1.png` | 整页底纸 |
| `assets/secondary-content-paper-v1.png` | 内容块 / 卡片纸面 |
| `assets/secondary-header-paper-v1.png` | 顶栏头部纸 |
| `assets/today-paper-texture.png` | 纸纹（配 multiply 叠加） |

### 快速记录组件

`quick-photo-paper-v1.png`、`quick-memo-paper-v1.png`、`quick-control-ivory-v1.png`、
`quick-control-kraft-v1.png`、`quick-control-sage-v1.png`、`quick-control-terracotta-v1.png`、
`quick-memo-collage-v1.png`、`quick-photo-collage-v1.png`、`quick-photo-dropzone-v1.png`、
`quick-memo-writing-sheet-v1.png`

### 首页

`today-paper-texture.png`、`today-dock-paper.png`、`today-dock-active-paper.png`、
`today-bento-paper-thick.png`、`today-actions-paper-thick.png`、`today-course-paper-thick.png`、
`today-weather-paper-thick.png`、`today-photo-kraft-frame.png`、`today-cover-single-tear-v3.png`、
`today-botanical-print.png`、`today-utility-postmark.png`、`today-weather-illustration.png`、
`today-dock-feather.png`

### AI 页

`ai-companion-canvas-v1.png`、`ai-composer-paper-v1.png`、`ai-message-paper-v1.png`、`ai-tabs-paper-v1.png`

### 其他

`editorial-mine-seal.png`、`editorial-paperclip-corner.png`、`editorial-torn-paper-strip.png`、
`editorial-torn-paper-vertical.png`、`journal-photo-frame-v2.png`、`journal-source-slip-v1.png`、
`journal-archive-drawer-v1.png`、`focus-page-canvas-v1.png`、`focus-timer-dial-v1.png`、
`focus-control-strip-v1.png`、`focus-settings-sheet-v1.png`、`library-page-canvas-v1.png`、
`library-shelf-sheet-v1.png`、`ledger-budget-meter-v1.png`、`moments-day-ribbon-v1.png`、
`calendar-ai-summary-paper-v1.png`、`vault-video-copy-paper-v2.png`

> **引用格式**：`background: rgba(253,252,249,.86) url('assets/xxx.png') center/100% 100% no-repeat;`
> 纸面块通常叠一层半透明纸白 + 素材本身，保证文字可读。

---

## 5. 二级页通用规范

### 头部（`.subpage-nav-bar`）

```css
position: sticky; top: 0; z-index: 20;
display: grid; grid-template-columns: minmax(74px,1fr) auto minmax(74px,1fr);
padding: calc(12px + var(--app-safe-top)) var(--space-page-inline) 12px;
background: rgba(245,241,232,.90) url('assets/secondary-header-paper-v1.png') center/100% 100% no-repeat;
backdrop-filter: blur(8px) saturate(120%);   /* ≤8px，不得用 20px */
```

- 返回按钮：**统一 `arrow_back` 图标 + 「返回」文案**（不要写「返回账本」这类具体位置）
- 返回键是「纸签」：`background: rgba(253,252,249,.96)` + `1px solid rgba(220,212,198,.85)` 描边
- 标题：`font-family: 'Newsreader', serif; font-size: 16px; font-weight: 800;`
  超长必须 `text-overflow: ellipsis`

### 二级页打开时

自动隐藏底部 Dock、滚动置顶；关闭后恢复。这由 `openSubpage` / `closeSubpage` 负责。

---

## 6. 参考还原记录

每个页面的 1:1 还原过程记录在 `design-qa.md`。
**在改动任何页面之前，先去读 `design-qa.md` 里对应页面的那一段** ——
那里记录了「P1/P2 问题是怎么修的」「哪些差异是有意保留的」。

---

## 7. 验收清单

任何视觉改动完成后，逐条确认：

- [ ] 没有引入 CSS 绘制的装饰
- [ ] 没有新增大圆角卡片 / 玻璃态 / 半透明白卡
- [ ] 所有颜色来自 §4 的设计令牌（或明确的语义色）
- [ ] 六个二级页的专属装饰素材**一个都没少**
- [ ] 360 / 395 / 412 / 540 / 567 五种宽度横向溢出为 0
- [ ] 长标题、长分类名、长书名都有省略号处理
- [ ] 动效克制（无弹跳过度）
- [ ] `npx esbuild app.js --bundle --format=iife --global-name=Mine --outfile=www/app.js` 零报错
- [ ] `node tests/*.test.mjs` 全部通过

---

## 8. 改动的边界

**可以改**：`performance.css` / `styles.css` / `views/*.js` 的模板与样式
**不要改**（除非用户明确要求）：

- `model.js` / `storage.js` / `core.js` —— 数据模型与内核
- `ai-key-vault.js` / `ai-key-vault.js` 对应的原生加密逻辑
- `tests/secondary-paper-system.test.mjs` —— 它锁定了纸张契约
- 版本号（`package.json` / `app-updater.js` / `build.gradle` / `index.html` 的 `?v=` / `release-notes.js`）——由用户统一升版

**如果视觉改动需要改数据结构**（比如新增持久化字段），先停下来问用户。

---

*最后更新：2026-10-07。维护者：本项目 AI 助手。*
