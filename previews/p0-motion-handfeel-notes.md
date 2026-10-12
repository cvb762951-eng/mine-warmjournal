# P0 动效手感修复（对照 Grok 4.7 动效分析）

基于 `origin/main` @ `208b173`（#28 / #29 已合入）。只动 P0，不改数据/存储。

## 为什么

1. 照片/私密照片弹窗仍跑 `modalSlideUp`，和全屏查看器叠在一起；FLIP 回退用非等比缩放套 `object-fit: contain`，落点会偏。
2. 源图淡出用了 `fill: forwards`，关大图后缩略图可能一直空着；目标是实况视频时还不该走共享过渡。
3. 翻牌飞出超过阈值后，新手势会 `cancelRise` 并把顶牌 `offset.set` 拉回来，连滑会瞬移；升牌起点用过 matrix，和顶牌姿势交接会抖。
4. 打卡后整页 `render()` + `autoStagger`，勾的轻反馈几乎看不见，画报还可能闪纸色。

## 改了什么

- **P0-1** `styles.css` / `performance.css`：`.photo-modal` / `.vault-photo-modal` 与视频层一样 `animation:none`；黑底由 layer 自己淡。
- **P0-1/2** `motion.js` `beginSharedElement`：按 contain 内接矩形做**等比** `scale`；不动画 `border-radius`；交接后 `cancel` 源淡出；目标/源是 `VIDEO` 时跳过共享过渡，不写内联 `opacity:1` 压过 `is-awaiting-frame`。
- **P0-3** 牌组：飞出中同方向只 `queuedCut`；按钮连点排队；反向可取消但从当前位移接着走；升牌起点用 CSS depth 字符串（`DEPTH_POSE`），不用 `getComputedStyle` matrix。
- **P0-4** `commitHabitProgress`：优先就地更新今日习惯行，只在勾上 `celebrateHabitCheck`；找不到行时才 `render(false, { skipStagger: true })`。

随手拍点图仍按 main 上用户要求**直接开大图、不做进入动效**；本次只修 FLIP 基础设施与照片弹窗入场。

## 真机怎么核对

1. 随手拍 / 日历 / 私密空间点静图：应直接出大图，不要整页上滑一下；关窗后缩略图立刻还在。
2. 实况照片：不要先飞静帧再闪白；等首帧再出画面。
3. 日记翻阅篇章：连续快滑或连点「切下一篇」，应排队翻、不要把飞出去的牌拉回来瞬移；减弱动效时仍瞬时换篇。
4. 今日习惯小圆勾：点一下只弹勾，画报/列表不要整页淡入或闪纸色。
5. 回归：牌组点照片仍只轮换本篇；习惯档案卡片→详情共享过渡仍可用。
