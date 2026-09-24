---
title: '内容简报'
description: '简报如何基于已存的前十名搜索结果与至多十次页面抓取生成，以及为什么每个大纲节点都必须引用所提供的证据。'
locale: zh
slug: content-briefs
section: product
order: 8
---

# 内容简报

每份简报针对一个被跟踪的关键词。RankMeFast 使用已存的前十名搜索结果，加上最多十次页面抓取，整理成一份可供撰写的大纲和问题集。

<!-- docs-truth: metric=content_briefs; unit=one-brief-up-to-ten-scrapes; cache-hits=count; refund=abstains-rather-than-invents; cadence=on-demand; estimates=ai-interpretation-labeled -->

## 简报包含什么

先是被抓取页面的基础统计：

- 字数区间和平均值
- 标题分布直方图
- 这些页面声明的结构化数据类型

然后由 AI 运行时生成大纲和问题集。

每个大纲节点和每个问题都必须引用所提供的内容：一份已存文档、一项统计、一条"用户还问"记录，或一个聚类词。

找不到证据支撑的节点或问题会被删掉。简报宁可留空，也不会编造来源。

## 撰写与重新评分

草稿编辑器用生成简报时的同一套统计给你的文本打分，所以分数变化时你能看到原因，背后没有隐藏的模型意见。

重新评分复用已存统计，不再消耗用量。无论搜索结果来自存储还是新的检查，一份简报都只消耗一个单位。

## 留意日期

统计描述的是在某个日期抓取的那些具体页面，日期会印在统计旁边。请把它当作一张快照，而不是对"前 10 名"的长期描述。

## 可用性

简报包含在 Agency 套餐中。Pro 需要通过 `content-briefs-10` 积分包获得，Starter 没有简报额度。用量单位与套餐限制见 [价格](./pricing.zh.md)。

简报只是撰写参考。它不评估你的排名机会，RankMeFast 也从不向你的站点发布任何内容。

[返回文档索引](./index.zh.md)
