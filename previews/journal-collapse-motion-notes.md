# 日记摊开收起对称动效

## 镜像的展开路径
`createDeckSpread` → `expand()` → `fanOut(deckRect)`：视口内小卡从牌组中心 pile（translate + rotate + scale(.6) + opacity 0）弹到网格位。

## 本次补的收起
- 点「收起」：`collapse(-1)` → `fanIn(gatherRect())`，同一套 `pileTransform`，只动 transform / opacity。
- 点小卡：仍单卡飞回 + 其余淡出；飞回目标与 gather 中心对齐，scale(.6) 与 pile 一致。
- `prefers-reduced-motion`：瞬时 `settleSpread`，不加半截动画。
- 不碰日记存储。

## 真机核对
1. 翻阅篇章 → 摊开：应有扇出。
2. 再点「收起」：小卡应收回牌组中心再露出牌组，不要瞬间消失。
3. 摊开后点某张小卡：该卡飞回，其余淡出，牌组翻到该篇。
4. 系统开「减弱动态效果」：摊开/收起都瞬时切换。
5. 收起过程不要闪白纸色。
