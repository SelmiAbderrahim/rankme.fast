---
title: '连接 Google Search Console'
description: '为何要连接、我们能访问什么、如何断开。'
locale: zh
slug: google-search-console
section: research
order: 3
---

# 连接 Google Search Console

Search Console 是 Google 的免费工具，展示 Google 如何看待您的网站。连接后，有三条规则会直接使用 Google 的结果，而不是估算。

## 我们访问什么
- 仅申请 **只读** 权限：`webmasters.readonly`。
- 不会访问 Gmail 或 Drive。我们只保存一个加密的刷新令牌。

## 连接步骤
1. 设置 → Google Search Console。
2. 点击 **连接 Google Search Console**。
3. 登录 Google 并授权。

## 断开或撤销
点击 **断开**，我们会立即删除令牌。也可以随时在 https://myaccount.google.com/permissions 撤销授权。

## 当 Google 要求重新连接时
如果 Google 使令牌失效（例如您修改账号密码之后），站点 **Google** 标签中的 Google Search Console 卡片会显示红色提示 **您的 Google 连接需要重新授权**，并带有**重新连接**按钮。读取 Search Console 或 Google Analytics 的卡片会显示 **Search Console 未连接** 或 **Google Analytics 未连接**，并带有**连接 Google**。在重新连接之前，这三条规则会显示“数据不足”。

## 选择资源
站点的 **Google** 标签会自动把你的站点与某个 Search Console 资源匹配。如果没有匹配项或有多个匹配项，RankMeFast 会请你选择一个。属于其他站点的资源只有在你确认后才能关联，因为它的搜索数据随后会显示在这个站点上。Google Analytics 的处理方式相同。如果最新的 Google Analytics 数据比预期的更旧，会有提示，点击**刷新**可再次同步；RankMeFast 也会每天同步一次。

## 页面标签中的搜索表现

[页面表现指南](./pages-performance.zh.md)说明页面标签如何使用已保存的 Search Analytics 记录。标签中的抓取可索引性来自最近一次 RankMeFast 抓取，并不表示 Google 已将该 URL 编入索引。

[返回文档索引](./index.zh.md)
