# Moments 图集浏览 + 共用相框迁移

## UX 流程

1. Moments 流里点**多图马赛克 /「查看照片」** → 纸面**图集浏览层**（照片+视频缩略网格）
2. 点照片缩略 → 既有 `photoViewer`；点视频 → 既有播放器
3. 关大图/播放器后仍停在图集；关图集回到 Moments
4. **仅 1 张照片且无视频** → 仍直接大图（不插中间层）
5. 大图本身仍**无进入 FLIP**（2026-10-12）；相册是导航层，不写存储

## 相框硬规矩

图集缩略与本次迁移的内容图一律 `photo-blur-frame` + `is-edge` + `photoFrameLayersHtml`（`photo-frame.js`）：
contain 全片、纸色兜底、柔角；**无第二套 blur**。pad 层的 `object-fit:cover` 仅用于同图铺底，不算内容裁切。

## 已迁移（内容图）

| 表面 | 文件 |
|---|---|
| Moments 图集浏览层（新） | `views/snippets.js` |
| Moments 待保存照片/视频预览、多视频段落封面 | `views/snippets.js` |
| 活动卡随手拍缩略、日记网格、日历快照/事件媒体 | `views/common.js` |
| 日历日详情照片/视频条 | `views/calendar.js` |
| 日记编辑器、历史缩略、照片墙、阅读廊、素材选择缩略 | `views/journal.js` |
| 尝鲜货架/店铺/卡片/表单/详情图 | `views/taste.js` |
| 本机相册格子 | `views/local-gallery.js` |
| 私密「从 Moments 选入」预览 | `views/private-vault.js` |

今日画页、Moments 马赛克、私密封面/列表项：**此前已走共用框**，本次未改逻辑。

## 有意保留 cover / 非内容图（未迁）

- 头像（我的 / 今日 hero / AI 用户）
- 今日首页大封面、倒计时背景、我的自定义背景（全幅装饰）
- 书影音海报（传统封面构图）
- 账本票据缩略、AI 待发图预览、更新说明截图条
- 大图 filmstrip 小条（导航条，非浏览主图）
- 文档模块（文件非照片）

## 与 #30 / #31

基于 `origin/main`，**未改 `motion.js`**，避免和 P0 动效 / 日记收起 PR 打架。

## 预览

`previews/moments-album-browse.html`
