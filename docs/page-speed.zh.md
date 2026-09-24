---
title: '网页速度'
description: '用简单的话说明 Core Web Vitals：真实访客数据 vs 实验室估算。'
locale: zh
slug: page-speed
section: audits
order: 1
---

# 网页速度

Google 通过 **Core Web Vitals** 评估页面。RankMeFast 会区分真实访客与实验室测量，并且只展示当前提供商实际返回的证据。

## 真实访客数据
Chrome UX Report 汇总真实访问：
- **LCP**：最大可见元素出现时间。 < 2.5 秒。
- **INP**：点击/触摸响应速度。 < 200 毫秒。
- **CLS**：布局跳动。 < 0.1。

仅当配置了 Google CrUX，且 URL 或来源拥有足够流量时，才会显示真实访客数据。生产环境的 DataForSEO Lighthouse 只提供实验室数据，因此该行会保持缺失，不会用合成测试虚构真实访客。

## 实验室估算（Lighthouse）
RankMeFast 会在受控环境中运行合成 Lighthouse 测试；生产环境通过 DataForSEO Lighthouse Live 获取该实验室信号。它仅作提示，单次运行波动约 10 分。

## 移动端
单独测量。缺 viewport 或点击目标过小时归入 **立即修复**。

[返回文档索引](./index.zh.md)
