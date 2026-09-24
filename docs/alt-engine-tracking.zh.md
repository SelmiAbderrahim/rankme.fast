---
title: 'Bing、YouTube 与 Amazon 排名跟踪'
description: 'RankMeFast 如何跟踪非 Google 引擎、什么是精确目标标识，以及为什么 Amazon 位次是索引内位次。'
locale: zh
slug: alt-engine-tracking
section: product
order: 3
---

# Bing、YouTube 与 Amazon 排名跟踪

其他引擎的关键词也走常规的添加流程，只是多了一个引擎选择器。排名历史按引擎打标签，历史视图里的引擎筛选会保存在 URL 中。

<!-- docs-truth: metric=alt_engine_checks; unit=one-keyword-one-engine-check; cache-hits=count; refund=provider-failure-zero-retained; cadence=weekly; estimates=provider-observation -->

## 各引擎如何匹配

- **Bing** 与 Google 相同：结果的规范化主机名与你站点的主机名相同，就算你的结果。
- **YouTube** 按精确的频道标识匹配。
- **Amazon** 按精确的 ASIN 匹配。

YouTube 和 Amazon 的结果都在平台自己的域名下，按主机名匹配没有意义，RankMeFast 也不会做模糊的品牌匹配。

没有精确的频道标识或 ASIN，它就不会猜。在你补上之前，这个关键词无法在该引擎上跟踪。

## 频率与用量单位

不论站点其他检查的频率如何，非 Google 目标每周检查一次。每次"关键词 + 引擎"检查在发出请求前都会预留一个备用引擎单位。

命中缓存的结果同样计入额度。如果供应商出错，不会保存任何数据，单位也会退还给你。

## 如何理解 Amazon 位次

Amazon 位次是供应商返回的商品索引中的位置，不是货架上的实时排位。赞助模块在排序前已被剔除。

和其他引擎一样，位次只是某个日期观测到的结果，不是预测。

## 套餐与可用性

每月额度为 Starter 0、Pro 20、Agency 240。额度用完后，可以购买一次性积分包补充。

运维人员可以通过 `ALT_ENGINE_TRACKING_ENABLED` 开关关闭此功能。关闭后，新的运行会被拒绝并显示本地化提示，已有历史仍可查看。

用量单位与套餐限制见 [价格](./pricing.zh.md)。

[返回文档索引](./index.zh.md)
