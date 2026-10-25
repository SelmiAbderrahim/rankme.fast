---
title: '有害链接与拒绝收录'
description: 'RankMeFast 如何用固定规则将外链分为不同风险等级、AI 何时可以对某行作出注解，以及为什么拒绝收录文件绝不会代你提交。'
locale: zh
slug: toxic-links
section: product
order: 5
---

# 有害链接与拒绝收录

有害链接审查会按固定规则为你已获取的外链行评分，然后让你生成 Google 格式的拒绝收录文件。RankMeFast 绝不会替你提交该文件。

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## 每行如何获得风险等级

规则（版本 `toxicity-rubric-v1`）读取每条已保存外链行的垃圾分值，并将其归入正常、观察或有害风险等级。失效链接和 nofollow 信号会调整该等级。

规则每次都给出相同结果：相同的已保存行和相同的垃圾分值始终得出相同的风险等级，并且每个等级都会显示其依据。

## 一次审查的成本

一次审查最多对 1000 条你已抓取的行做快照，并最多为 100 个域名购买新的垃圾分值。如果站点还没有已存的外链行，请先加载外链列表。

你可以为被标记的行请求一段 AI 说明。它要么引用这条已存行，要么不作评论。如果供应商环节出错，不会保留任何数据，单位也会退还。

## 生成拒绝收录文件

1. 逐行选择包含或排除。
2. 选择按域名还是按 URL。
3. 导出 Google 格式的纯 `.txt` 文件，被排除的行不会写入。

RankMeFast 只是把文件导出，供你自行复核并自行提交给 Google。它没有连接 Search Console 的拒绝收录工具，也无法代你上传。

## 诚实的限制

风险等级描述的是规则在链接中发现的情况，绝不是对 Google 处罚、人工处置或排名变化的预测。

AI 可以为规则已标记的行添加注解，但绝不能添加规则未标记的域名。导出中的每个域名都能追溯到一条已保存的行。

采取行动前，请将本指南与 RankMeFast 中显示的已存证据和状态进行核对。

用量单位与套餐限制见 [价格](./pricing.zh.md)。

[返回文档索引](./index.zh.md)
