---
title: '有害链接与拒绝收录'
description: 'RankMeFast 如何用确定性评分规则对外链分档、AI 何时可以对某行作出注解，以及为什么拒绝收录文件绝不会代你提交。'
locale: zh
slug: toxic-links
section: product
order: 5
---

# 有害链接与拒绝收录

有害性审查用一套固定的评分规则，给你已抓取的外链行打分。之后你可以生成 Google 格式的拒绝收录文件。RankMeFast 从不替你提交。

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## 行如何分档

评分规则 `toxicity-rubric-v1` 读取每条已存外链行上的供应商垃圾分值，把它归入干净、观察或有害档位。失效链接和 nofollow 信号可能让档位上下浮动。

同样的行、同样的垃圾分值，总会得到同样的档位，每个档位旁边都会列出它依据的证据。

## 一次审查的成本

一次审查最多对 1000 条你已抓取的行做快照，并最多为 100 个域名购买新的垃圾分值。如果站点还没有已存的外链行，请先加载外链列表。

你可以为被标记的行请求一段 AI 说明。它要么引用这条已存行，要么不作评论。如果供应商环节出错，不会保留任何数据，单位也会退还。

## 生成拒绝收录文件

1. 逐行选择包含或排除。
2. 选择按域名还是按 URL。
3. 导出 Google 格式的纯 `.txt` 文件，被排除的行不会写入。

RankMeFast 只是把文件导出，供你自行复核并自行提交给 Google。它没有连接 Search Console 的拒绝收录工具，也无法代你上传。

## 档位代表什么

档位只是评分规则对一条链接的判断。它不预测 Google 处罚、人工操作或排名变化。

AI 可以为规则已标记的行添加注解，但不能加入规则没有标记的域名。导出文件里的每个域名都能追溯到一条已存行。

用量单位与套餐限制见 [价格](./pricing.zh.md)。

[返回文档索引](./index.zh.md)
