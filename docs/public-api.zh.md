---
title: '公共 API'
description: '通过简单的密钥认证 API 读取你的网站、报告、排名和关键词。Agency 功能。'
locale: zh
slug: public-api
section: developers
order: 1
---

# 公共 API

公共 API 提供对 RankMeFast 已为你的账户保存的数据的只读访问：网站、最新审计报告、排名历史和已跟踪的关键词。这是 **Agency** 套餐功能（参见[套餐、限额与积分](./plans-limits-credits.zh.md)）。它不会触发新的供应商调用，只读取审计和排名检查已经产生的数据。

Content Intelligence 不属于 `/api/v1`：启动分析或更改建议只能在登录后的应用中进行。MCP 可以读取已保存的分析，但不能启动分析或更改建议。

## 认证

在 **账户 → API 密钥**（`/profile?tab=api-keys`）中创建密钥。完整密钥**只显示一次**，请立即复制；此后只能看到其前缀。你最多可以持有十个有效密钥，并可随时吊销任意一个。被吊销的密钥立即失效。

在每个请求中以 bearer 令牌形式发送密钥：

```
Authorization: Bearer rmf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

将下方示例中的 `https://your-rankme-host` 替换为你的 api 源地址（即安装的 `SERVER_URL`）。

## 响应语言和数据契约

响应语言依次由 `x-lang`、`Accept-Language` 决定，都没有时使用 `en`。`fr-CA` 等区域值会归为 `fr`。`/api/v1` 不读取浏览器 Cookie、账户语言或工作区偏好。每个响应都会在 `Content-Language` 中标明所用语言，并向 `Vary` 添加 `x-lang, Accept-Language`，同时保留现有值。

只有 RankMeFast 自己编写的文本（报告、发现、行动文案和安全错误消息）会被翻译。JSON 属性名、HTTP 状态、稳定错误代码、枚举和状态值、ID、域名、URL、关键词、时间戳、测量值、观察值、游标以及已存储的用户或供应商文本均保持不变。语言也不会改变排序或数字和日期格式。

CSV 在所有语言下逐字节一致：UTF-8 BOM、列名和顺序、行序、RFC-4180 转义、值、换行符、文件名、分页响应头和游标行为都相同。`Content-Language` 只说明所选语言，不会翻译或重命名 CSV 中的任何内容。

## 端点

### 列出你的网站

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites
```

返回 `{ "sites": [{ "id", "domain", "url", "createdAt" }] }`。

### 网站的最新审计报告

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites/<siteId>/report/latest
```

以 `{ "runId", "report" }` 形式返回最近一次**成功**的审计，与控制台显示的发现、分类和本地化文案完全一致。若该网站还没有完成的审计，返回 `404`。

### 网站的排名历史

```bash
curl -H "Authorization: Bearer rmf_..." \
  "https://your-rankme-host/api/v1/sites/<siteId>/rank-history?from=2026-06-01&to=2026-07-01"
```

返回 `{ "keywords": [{ "id", "phrase", "series": [...] }] }`。每个数据点包含排名位置、上榜 URL 以及 Google AI Overview 信号（`aiOverviewPresent`、`aiCited`、`aiCitedUrl`）。`from` 和 `to` 为可选的 ISO 日期。

### 所有已跟踪的关键词

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/keywords
```

返回你所有网站中每个已跟踪关键词的最新排名、变化值和 AI Overview 字段。

## CSV 导出和存储行

启用 `PUBLIC_EXPORTS_ENABLED` 后，可在任意列表路由使用 `?format=csv` 或 `Accept: text/csv` 请求 CSV。文件具有稳定列、UTF-8 BOM、RFC-4180 引号和公式中和保护；四个原有路由的 JSON 保持不变。排名历史接受 `engine=google|bing|youtube|amazon`；不筛选时，`engine` 列包含全部引擎。

排名历史和关键词 CSV 默认保留原有的不分页输出；只有加入 `limit` 或不透明 `cursor` 时才启用分页。排名历史每页可含 1 至 25 个关键词组（每组最多 730 个点），关键词每页可含 1 至 1,000 行。请把响应中的 `X-Next-Cursor` 值传给下一次请求；该响应头缺失即表示结束。JSON 会忽略这些 CSV 分页参数，并保持原有响应契约。

另有两个已存数据读取：`GET /api/v1/serp-features?siteId=<siteId>` 和 `GET /api/v1/backlink-rows?siteId=<siteId>`。两者接受 1 至 1,000 的 `limit` 和不透明 `cursor`，只返回密钥账户自己的行，并带有 `sourceKind=provider_observation` 标签（CSV 为 `source_kind`）。关闭开关时，新路由和 CSV 返回 `503`，原有 JSON 仍可用。连接器设置和完整字段见 [Looker Studio 指南](./looker-studio.zh.md)。

## 速率限制

默认情况下，每个密钥每分钟最多 **120 个请求**。超出后 API 返回 `429`，直到窗口重置。

## 错误

错误采用 `{ "error": { "message": "...", "details": ... } }` 形式。人类可读消息依次采用 `x-lang`、`Accept-Language` 和 `en`；状态、字段、稳定代码和详情不随语言变化：

- `401`：密钥缺失、格式错误、已吊销或未知。
- `402`：你的套餐不包含 API。
- `404`：该网站或报告不存在于你的账户中。
- `429`：超出速率限制（响应体：`{ "error": "..." }`）。

## 兼容性

此版本提供以下六个只读路由：

- `GET /api/v1/sites`
- `GET /api/v1/sites/:siteId/report/latest`
- `GET /api/v1/sites/:siteId/rank-history`
- `GET /api/v1/keywords`
- `GET /api/v1/serp-features`
- `GET /api/v1/backlink-rows`

品牌雷达、评论智能、链接智能、流量洞察和关键词趋势在 `/api/v1` 下都没有路由。它们是需要登录的控制面板功能。现有响应字段含义不变，客户端应忽略无法识别的新字段。

<!-- public-api-routes: GET /api/v1/sites; GET /api/v1/sites/:siteId/report/latest; GET /api/v1/sites/:siteId/rank-history; GET /api/v1/keywords; GET /api/v1/serp-features; GET /api/v1/backlink-rows -->

[返回文档索引](./index.zh.md)
