---
title: '关键词聚类'
description: 'RankMeFast 如何按共享结果 URL 对被跟踪关键词分组，以及为什么这是算术而非相似度评分。'
locale: zh
slug: keyword-clustering
section: product
order: 2
---

# 关键词聚类

聚类按关键词之间共享的结果 URL 数量，把你跟踪的关键词分组。它只使用 RankMeFast 已保存的 SERP 观测，从不为了补缺口去跑排名检查。

<!-- docs-truth: metric=keyword_cluster_runs; unit=one-run-up-to-200-keywords; cache-hits=count; refund=none-blocked-keywords-are-reported; cadence=on-demand; estimates=shared-url-arithmetic -->

## 聚类如何形成

1. 对每个关键词，RankMeFast 取其最近一次已存观测中排名前 10 的结果 URL。
2. 两个关键词至少共享其中 3 个 URL 时，就建立连接。
3. 连接可以传递：A 连着 B、B 连着 C，三者就归入同一个聚类。

一次运行最多覆盖 200 个关键词。归属只取决于共享 URL 的简单计数，所以同样的已存观测总会得出同样的聚类。

## 哪些关键词能参与

只有最近 7 天内有观测的 Google 关键词才会参与。运行开始前，预检会告诉你哪些关键词符合条件。

不能参与的关键词会列出原因（缺失、过期或为空），不会被悄悄丢掉。运行一旦开始就会消耗用量单位，被排除的关键词不退还。

## 标签

AI 运行时可能为每个聚类建议一个名称，并带有 AI 标记。如果命名失败，聚类就没有名称，但分组本身不受影响，因为分组从不依赖模型。

共享 3 个 URL 只是一个门槛，不是相似度评分，聚类也不说明搜索意图。RankMeFast 从不为了凑齐分组而编造关键词、URL 或观测。

## 套餐与可用性

各套餐每月额度：

- Starter：0
- Pro：4
- Agency：20

运维人员可以通过 `KEYWORD_CLUSTERING_ENABLED` 开关关闭聚类。关闭后，新的运行会被拒绝并显示本地化提示，已有的聚类仍可查看。用量单位的计算方式见 [价格](./pricing.zh.md)。

[返回文档索引](./index.zh.md)
