---
title: '提醒'
description: '哪些提醒会触发、恰好一次投递如何工作，以及排名下跌规则何时投递。'
locale: zh
slug: alerts
section: product
order: 6
---

# 提醒

提醒规则按站点设置，可以通过电子邮件、Slack 传入 Webhook，或经 HMAC 签名的通用 Webhook 投递。投递不计入用量。

<!-- docs-truth: metric=none; unit=none-deliveries-not-metered; cache-hits=not-applicable; refund=not-applicable; cadence=on-observed-transition; estimates=provider-observation -->

## 目前会触发什么

新增和流失引荐域名的提醒。它们在连续两次链接审查完成后触发，每条提醒都附带触发它的前后对比证据。

排名下跌规则只在下跌得到确认后才会触发：定时排名检查发现下跌，随后对同一市场中的同一关键词做一次新的第二次检查，下跌依然存在。如果关键词排名恢复，或第二次检查无法完成，该规则不会发送任何提醒。参见[确认的排名提醒](./confirmed-rank-alerts.zh.md)。

## 每次变化只发一条

每次观测到的变化只投递一次，而且是一条提醒，不会按域名逐条发送。如果一次审查新增 300 条链接，你只会收到一条提醒，其中包含最多 50 个域名的样本和完整数量。

第一次链接审查没有可对比的基线，因此不会触发提醒。投递日志会把每次尝试记为已发送、失败或已抑制。

传输失败时，投递会记为失败，不会无限重试。同一次变化也不会作为第二条提醒再发一次。

## 渠道

电子邮件、Slack 和通用 Webhook 渠道均可使用。

Slack 需要你粘贴一个传入 Webhook 地址。RankMeFast 没有 Slack 应用，也没有机器人。

通用 Webhook 带有签名，你的接收端可以据此确认负载确实来自 RankMeFast。

## 提醒代表什么

提醒只说明两份已存快照之间发生了变化。它不评判链接质量，也不预测对排名的影响。

用量单位与套餐限制见 [价格](./pricing.zh.md)。

[返回文档索引](./index.zh.md)
