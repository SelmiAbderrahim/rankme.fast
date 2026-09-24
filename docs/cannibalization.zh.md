---
title: '关键词自相蚕食'
description: 'RankMeFast 如何仅凭已存储的 Search Console 行，找出你有两个以上页面相互竞争的查询。'
locale: zh
slug: cannibalization
section: product
order: 4
---

# 关键词自相蚕食

蚕食报告读取的是 RankMeFast 已为你站点同步的 Google Search Console `query,page` 行。它不产生供应商费用，即使 Google 已断开连接也能运行。

<!-- docs-truth: metric=cannibalization_reports; unit=one-report-one-window; cache-hits=count; refund=no-stored-rows-no-unit-consumed; cadence=on-demand; estimates=first-party-gsc-rows -->

## 报告展示什么

对于你有两个及以上页面出现的每个查询，报告会列出这些相互竞争的页面，以及它们的点击、展示、平均位次和在该查询总量中的占比。

RankMeFast 还会建议哪个页面应作为主页面。它始终按同样的顺序挑选，所以同样的数据总会得出同样的答案：

1. 点击最多。
2. 点击相同时，平均位次最好。
3. 两者都相同时，按固定顺序决定。

## 时间窗与置信度

报告可以基于最近 7 天、28 天或 90 天的已存行运行。时间窗越长，只是用到更多已存数据，不会抓取任何新数据。

每条发现会标注高、中或低置信度。它反映的是已存证据有多充分（行数多少、页面之间差距多明显），而不是你采取行动后会发生什么。

## 运行之前

如果你的站点还没有已存的 `query,page` 行，就没有可报告的内容。RankMeFast 会提示你先同步 Search Console，并且不消耗套餐用量。

## 由你决定的部分

报告不预测排名变化，也不会改动你的站点。某个页面是合并、重定向还是保持不动，由你决定。

## 套餐与可用性

每月额度为 Starter 4、Pro 20、Agency 100。用量单位的计算方式见 [价格](./pricing.zh.md)。

如果运维人员关闭了 `CANNIBALIZATION_ENABLED`，新的报告会被拒绝并显示本地化提示，已有的报告仍可查看。

[返回文档索引](./index.zh.md)
