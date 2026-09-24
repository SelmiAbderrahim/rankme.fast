---
title: '客户报告与门户'
description: '白标 PDF 报告如何由已存快照拼装、定时任务如何投递，以及可撤销门户链接是什么、不是什么。'
locale: zh
slug: client-reports
section: product
order: 11
---

# 客户报告与门户

客户报告把已存的审计、排名和 Search Console 快照整理成带品牌标识的 PDF。你可以按计划通过电子邮件发送，也可以通过只读链接分享。

<!-- docs-truth: metric=none; unit=none-composed-from-stored-snapshots; cache-hits=not-applicable; refund=not-applicable; cadence=weekly-or-monthly; estimates=first-party-snapshots -->

## 报告包含什么

每份报告以你账户的公司名称、强调色和徽标呈现，汇总最新的审计发现以及排名和 Search Console 章节。

发送报告时不会抓取任何数据，报告完全由已存快照组成。因此每个数字旁都会印上它的观测日期。

没有已存快照的章节会标为"尚未观测"，不会用估算值填充。

## 计划发送

报告按每周或每月通过电子邮件发送。投递日志为每位收件人记录一条状态：待处理、已发送、失败或已抑制。

生成和发送报告不会调用任何供应商，也不消耗计量单位。成本由我们自己的基础设施承担，因此改用结构性上限来限制。

## 门户链接

门户链接是一个只读地址，会过期，也可以撤销。

没有登录、没有评论，也没有客户席位。任何拿到链接的人看到的都是已发布的报告。

撤销在下一次请求时生效，尚未加载页面的人会立刻无法访问。

## 套餐与上限

客户报告属于 Agency 套餐。最多可设置 20 个计划任务和 25 个门户链接。

v1 版报告不包含内容简报。用量单位与套餐限制见 [价格](./pricing.zh.md)。

[返回文档索引](./index.zh.md)
