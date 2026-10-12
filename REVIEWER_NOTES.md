# 审查笔记 · Antigravity 前端下一步方案抽查

> 模型：`gemini-3.8-flash-high`（agy `--mode plan --effort high`）  
> 抽查人：执行子代理（对照 `styles.css` / `themes-plain.css` / `themes-plain-light.css` / `performance.css` / 相关 `views/*`）  
> 结论：三份中文报告整体可用；**核心对齐问题大多属实**；若干行号偏移或张冠李戴，落地前以选择器为准、勿死抄行号。

---

## 一、已核实为真的重点问题（可优先做）

| 问题 | 证据 | 判定 |
|---|---|---|
| Today 底栏被压成 46px，其它页约 64px/变量高 | `styles.css:3209-3212`；全局覆盖 `3381-3384`（`bottom:0;width:100%;height:64px`）；根变量 `--dock-height:72px` | **属实（P0）** |
| 清简 Dock 只加了 24px 圆角，未恢复悬浮几何 | `themes-plain.css:1504-1508` / `themes-plain-light.css:87-91`；与 `styles.css:3381` 的满宽贴底冲突 | **属实（P0）** |
| 今日格言被 `display:none` | DOM 在 `views/today.js:112`；隐藏在 `styles.css:3204` | **属实（P0）** |
| 大量 sub-10px 字号 | 如 `5.5px`（`3203`）、`5.8px`/`6.5px`（`3180`/`3186`/`3208`）、`6px`（`3200`）等 | **属实（P0）** |
| Sticky 二级顶栏被套 20px 圆角 | `themes-plain.css:2360-2370` 把 `.subpage-nav-bar` 与卡片一起 `border-radius:20px` | **属实（P0，穿帮风险）** |
| 账本返回「返回账本」过长 | `views/ledger.js:618` | **属实（P0/P1）** |
| 首页拍立得区锁死 72px 高 | `styles.css:3195-3197` | **属实（观感问题；是否算「拉伸」取决于内部 object-fit，但矮条裁切感明确）** |
| 便当左右 padding 不对称 + A/B 水印 | `styles.css:2760-2786`；清简**未**覆盖 `bento-card::before`（已搜 plain 无此规则） | **属实（P1）** |
| 天气卡 `margin-left:-14px` | `styles.css:3096`；清简另加左边蓝线 `themes-plain.css:1516-1520` | **属实（P2）** |
| 账本 stream 负边距 | `styles.css:2184` `margin:14px -16px -116px` | **属实（边距体系不齐，P1）** |
| `installMagneticDock` 已存在 | `motion.js:972` | **属实**（创意 1 可复用，不必从零写磁吸） |
| `views/moments.js` 不存在 | 随手拍在 `views/snippets.js` | **属实**（报告已注明） |
| 冷启动壳 | `index.html` 有 `#early-theme-shell` 与 plain `#EAF0F8` | **属实** |

---

## 二、行号/归因错误（勿照抄行号）

| 报告写法 | 实际 | 影响 |
|---|---|---|
| `styles.css:5120-5200` → 我的 KPI | 该段是**日历** `.cal-cell`（约 `5118+`）；KPI 在 `1116+` 与 `.mine-view` 覆盖 `8161+` | 行号幻觉；选择器 `.mine-kpi-row` 本身存在 |
| `styles.css:4150-4220` → 日记 hero 顶栏 | `4150` 是 `.journal-polaroid-frame`；hero 顶栏在 `2038` / `.journal-view` 覆盖 `3974`；画布卡约 `4177`/`5995` | 行号错位 |
| `styles.css:4580` → `.ledger-accounts-track` | `4580` 附近是别的颜色规则；track 在 `2168` 与 `4617` | 行号错位 |
| 创意 3 引用 `styles.css:610-640` 为日记阅读器 | 该段是 **modal-layer / .modal**，与画报阅读无关 | 文件锚点错误 |
| `views/journal.js:597-644` | 画报阅读器主体约在 **605–644**（含 deck mount）；597 附近是前一段素材逻辑收尾 | 大致对，起点略偏 |

---

## 三、需要降调或补充上下文的条目

1. **图注「压图」（问题 04）**  
   - 报告指向 `views/common.js:182-184` 正确（meta 打进 chrome）。  
   - 真正样式在 **`performance.css:180-194`**：`position:absolute` 叠在画面上，但有意用文字投影、无满宽遮罩，且 `max-height:4.5em`。  
   - 与护栏「图注在照片下方」存在产品张力；改前先定是「严格流式下方」还是「保留轻量叠字」。勿当成明显 bug 盲改。

2. **日记顶栏基线（问题 07）**  
   - 基础规则是 `align-items:baseline`（`2038`），**不是** `flex-start`。  
   - `.journal-view .journal-hero-top-row` 已设 `align-items:center`（`3974`）。问题可能被夸大。

3. **日记输入框 20px 套 14px**  
   - plain 确有 `#journal-title-input { border-radius:14px !important }`（`themes-plain.css:2373-2375`）。  
   - 但 `.journal-view .journal-canvas-card #journal-title-input` 后续有 `border-radius:0!important`（约 `5996`），特异性更高时圆角已是 0。落地前用 DevTools 确认最终计算值。

4. **我的 KPI 窄屏**  
   - `.mine-view .mine-kpi-num` **已有** `clamp(14px,4.4vw,18px)`（`8182`）。报告建议的 clamp 部分已存在；仍需看标签 9px 与四列在 360px 是否够用。

5. **创意 1「折叠岛底栏」**  
   - 早期 `.floating-dock`（`487+`）本来就是悬浮胶囊（`width:calc(100%-28px)`、`bottom:var(--dock-edge)`、`border-radius:999px`），后被纸质满宽层盖掉。更准确表述是：**清简主题恢复并统一岛形态 + 复用已有磁吸**，而非全新发明。

6. **拍立得 72px**  
   - 更像今日页「极度压缩密度」策略副作用，不一定违反 object-fit 不拉伸；验收应看虚化底+完整居中是否仍在。

---

## 四、对落地顺序的审查意见

同意报告推荐：

1. **PR1**：Dock 高度统一 + 清简悬浮几何、恢复格言、清掉 sub-10px、二级 sticky 顶栏圆角、账本「返回」文案。  
2. **PR2**：便当对称与清简去 A/B 水印、账本横向基准、天气负边距、我的设置行对齐（KPI clamp 已部分完成则做回归即可）。  
3. **PR3**：创意 1（岛底栏+磁吸 pill）+ 创意 2（冷光底纸）——工作量合理、护栏风险低。  
4. **PR4**：账本光带筛选（创意 4）——注意只做展示过滤，不改存储。

创意 3（双轨排版，L）与创意 6（胶卷 masonry，中风险碰照片护栏）建议等对齐稳定后再开。

---

## 五、总评

- Antigravity **读到了真实代码**（选择器大多存在，护栏表完整，moments→snippets 也写对了）。  
- **不要信赖所有行号**；以选择器 + 本地再搜为准。  
- 未改任何 app 业务源码；仅新增方案 Markdown + 本审查文件。
