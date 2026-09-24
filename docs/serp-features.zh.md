---
title: 'SERP 功能记录'
description: 'RankMeFast 在每次排名检查中记录哪些搜索结果功能，以及它绝不会声称的内容。'
locale: zh
slug: serp-features
section: product
order: 1
---

# SERP 功能记录

RankMeFast 每做一次排名检查，都会顺带记下该关键词的搜索结果里出现了哪些功能。这不另外收费，检查时也不会向供应商多要结果。

<!-- docs-truth: metric=none; unit=byproduct-of-serp_checks; cache-hits=count; refund=not-applicable; cadence=follows-rank-check; estimates=provider-observation -->

## 记录哪些内容

每次检查时，RankMeFast 会记下结果页上是否出现了以下内容：

- 精选摘要
- "用户还问"模块
- 本地组合
- 视频、图片或购物结果
- 知识图谱面板

同时保存自然结果，最多 100 行。

某项功能结果的主机名在规范化后与你站点的主机名完全一致，才算归你所有。其他情况只记为"出现过"，不归你。

## 历史记录

每个被跟踪的关键词都有逐次检查的历史。你可以用点阵视图查看，也可以用表格查看；表格数据相同，更适合屏幕阅读器和导出。

观测保留 90 天，每个关键词另保留最近 30 次检查。更早的行会被移除，无法重建。

## 限制

由于排名检查不会额外请求更深的结果，一次实时检查保存的自然结果可能不足 100 行。

RankMeFast 只能告诉你某项功能在某次已存检查中**已观测到**或**未观测到**。这并不代表 Google 从不展示它；缺失的数据就是缺失，不会用估算补上。

## 可用性

这项记录没有单独的额度，它随你套餐里已有的排名检查一起进行。运维人员可以通过 `SERP_FEATURE_TRACKING_ENABLED` 开关将其关闭，此时新的运行会被拒绝并显示本地化提示，已保存的结果仍可查看。用量单位与套餐限制见 [价格](./pricing.zh.md)。

[返回文档索引](./index.zh.md)
