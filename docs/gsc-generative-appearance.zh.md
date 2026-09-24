---
title: 'Search Console 中的生成式 AI 出现'
description: '直接来自 Search Console：Google 在其生成式 AI 功能中展示您网站的次数。'
locale: zh
slug: gsc-generative-appearance
section: research
order: 4
---

# Search Console 中的生成式 AI 出现

Google Search Console 会报告您的页面在 Google 生成式 AI 功能（例如 AI 概览）中出现的次数。这张卡片按 Google 发送的原样显示这些数字，我们不做任何添加或估算。

## 我们读取什么

我们使用参数 `dimensions=['searchAppearance']` 查询 Search Console API，范围是最近 28 天，截止到三天前，以配合 Google 的报告延迟。Google 返回的每一行都按照 Google 官方文档进行分类：

- 已知的生成式 AI 值会得到固定的标签。
- 未知值显示为 **其他**，并保留原始名称，方便支持团队复核。我们不会把未知值默认当作生成式。

## 状态

- **可用**：Google 至少返回了一行可识别的生成式数据。卡片按行显示 Google 发送的点击、展示、CTR 和平均排名。
- **不可用**：Google 没有为该资源和时间范围返回任何可识别的生成式数据。这和零不同，意味着 Google 根本没有报告，所以我们留空，而不是显示 0。
- **部分**：Google 返回了数据，但将响应标记为不完整（因速率限制或截断）。已收到的行仍会显示。
- **需要重新连接**：需要重新连接 Google。请打开网站的 Google 工作区，按提示重新连接。

## 与供应商指标分开

这是 Google 自己关于您网站的数据。它显示在 Google 工作区中，与其他 Search Console 卡片并列，不会与 AI 可见性工作区中的提及和话语份额图表混在一起，因为那些数据来自另一家供应商，衡量的也是别的东西。

## 它不能告诉您什么

Search Console 统计的是展示和点击，也就是 Google 把您的页面放进生成式功能的次数。它不会告诉您 AI 回答是否提到了您、链接了您、引用了您，或更偏向竞争对手。这些请使用 [AI 可见性](./ai-visibility.zh.md)。

[返回文档索引](./index.zh.md)
