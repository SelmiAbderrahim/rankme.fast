---
title: '疑难解答'
description: '常见问题及解决方法。'
locale: zh
slug: troubleshooting
section: start
order: 3
---

# 疑难解答

## 审计失败或不可用
- 检查防火墙 / Cloudflare。
- 确保 robots.txt 未屏蔽 `RankMeFastBot`。
- 稍后重试。

## 排名检查不可用
通常是暂时的；下一次调度会自动重试。

## Search Console 提示需要重新连接
Google 使我们的令牌失效了。在站点的 **Google** 标签中，Google Search Console 卡片会显示**您的 Google 连接需要重新授权**；请选择**重新连接**。如果您修改过 Google 密码或撤销了应用授权，就可能出现这种情况。读取 Search Console 或 Google Analytics 的卡片，在 Google 重新连接之前会显示 **Search Console 未连接** 或 **Google Analytics 未连接**，之后在下次读取时恢复。

## 达到上限
参见 [方案、限额与额度](./plans-limits-credits.zh.md)。

## 未收到验证邮件
检查垃圾箱；链接 24 小时后过期。

## AI 摘要显示"已缩短"
长审计在发送前会缩短，点击 **重新生成** 换一版。

## 报告页面卡在加载
硬刷新（⌘/Ctrl + Shift + R）。仍不行请联系支持。

[返回文档索引](./index.zh.md)
