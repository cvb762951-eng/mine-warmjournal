# PR1 清简对齐 · 自审记录

> 分支：`feat/plain-alignment-pr1`  
> 范围：仅 `data-theme="plain"`；classic / sunny 未改  
> 工具：Antigravity CLI `gemini-3.8-flash-high` 起草 → 人工复核 → `node scripts/gen-plain-theme.mjs` 同步产物  
> **未**调用 Cursor CloudAgent；**未**合 main；**未**碰 android / storage / model

## 改动文件

| 文件 | 作用 |
|---|---|
| `themes-plain-light.css` | 手工源：末尾新增「二十三 · PR1 清简对齐」 |
| `themes-plain.css` | 生成产物：由 gen 脚本拼入同一节 |
| `views/ledger.js` | 「返回账本」→「返回」（符合 VISUAL_RULES，全局可改） |

未改：`styles.css`（避免牵动其他主题）、`android/`、数据层。

## 六项对照

1. **Dock 悬浮岛 + 今日不再更矮**  
   plain 下统一覆盖 `.floating-dock` 与各 `:has(*-view)` 变体：居中、缩宽、上浮、`height:60px`、`border-radius:999px`、白底无纸纹图 → 圆角不被贴底裁切；今日页按钮/字号与其它页对齐，压住 `styles.css` 的 46px/7px 特例。
2. **格言显示**  
   `.today-photo-feature .washi-tape-note { display:block !important; … }` 浅蓝胶囊，压过 `styles.css` 的 `display:none`。
3. **sub-10px 抬升**  
   今日/底栏相关辅助字号抬到 ≥10px（stack / qa / timeline / section hint / bento copy / dock small）。拍立得 caption/time 仅抬到 **10px**（人工把 Antigravity 的 13px 收回），避免挤爆 72px 相框高度。
4. **二级顶栏平顶**  
   末尾以同等/更高权重覆盖 `.subpage-nav-bar`（含 ID 选择器）：`border-radius: 0 0 16px 16px`，消除吸顶圆角漏底。
5. **返回文案**  
   `views/ledger.js` 分析页返回键改为「返回」。
6. **便当对称 + 藏水印**  
   左右 padding 统一 `12px`；`::before` A/B 水印 `content:none`。

## 风险与观察

- 早期小节仍有给 `.floating-dock` 设 `border-radius:20px` 的联合规则；PR1 节在文件末尾、选择器同等权重，后写覆盖先生效。
- 底栏上浮后，内容区仍靠既有 `--dock-clearance` 留白，未改布局 JS。
- classic / sunny 仍走 `styles.css` 纸纹底栏与今日 46px 特例，刻意未动。
- 生成器提示 light 文件有旧重复小节标题（「二十 · 私密…」），与本次无关；产物已按「保留最后一次」去重。

## 建议真机验收（清简主题）

1. 今日 ↔ 日记 ↔ 账本 ↔ 随手记：底栏高度不跳，圆角完整悬浮，无闪白。  
2. 今日画页能看到格言胶囊。  
3. 快捷入口 / 时间线小字可读（≥10px 观感）。  
4. 进习惯/账本分析等二级页上滑：顶栏角不漏字；分析页返回为「返回」。  
5. 便当左右留白对称，无 A/B 残影。  
6. 切回 classic/sunny：底栏与格言行为与改前一致。
