---
title: '连接 Looker Studio'
description: '把只读 RankMeFast 连接器复制到 Apps Script，在 Looker Studio 中使用已存储的 SEO 数据。Agency 功能。'
locale: zh
slug: looker-studio
section: developers
order: 4
---

# 连接 Looker Studio

社区连接器允许 **Agency** 账户读取其自有 RankMeFast 实例已经存储的数据。它不会启动检查、调用供应商或消耗用量指标。现有的每 IP 和每密钥限流仍然生效。底层 HTTP 契约见[公共 API](./public-api.zh.md)。

## 开始之前

请运营者启用 `PUBLIC_EXPORTS_ENABLED`。在**账户 → API 密钥**中创建密钥，并在唯一一次显示时复制；之后 RankMeFast 只保存 SHA-256 摘要。还需要实例的 HTTPS 源站地址，不要包含 `/api/v1`。

## 安装和连接

1. 创建 Google Apps Script 项目。
2. 把 `tools/looker-connector/Code.gs` 复制到脚本编辑器，把 `appsscript.json` 复制到清单编辑器。
3. 创建 Community Connector 测试部署，并在 Looker Studio 中打开。
4. 在 Google 独立的 **Key** 身份验证界面输入 API 密钥，绝不要把密钥放进连接器配置或源码。
5. 输入实例 URL、选择数据集。排名历史、SERP 功能和反向链接行还需 24 位站点 ID。引擎筛选支持全部、Google、Bing、YouTube 和 Amazon。

实例 URL 在设置时提供，提交的连接器没有固定 API 源站。排名历史按 `X-Next-Cursor` 分页，每页 10 个关键词组；关键词、SERP 功能和反向链接行每页 1,000 行。每次刷新均最多 10,000 行；若游标重复，连接器会报错而不会循环。Looker 提供日期范围时，连接器会在排名历史的每一页传递包含首尾日期的边界。

## 字段映射

| 数据集 | API 路由 | Looker 字段 ID |
|---|---|---|
| 站点 | `/api/v1/sites` | `id`, `domain`, `url`, `paused`, `created_at` |
| 排名历史 | `/api/v1/sites/:siteId/rank-history` | `keyword_id`, `phrase`, `engine`, `checked_at`, `position`, `rank_absolute`, `source`, `found_url`, `ai_overview_present`, `ai_cited`, `ai_cited_url` |
| 关键词 | `/api/v1/keywords` | `id`, `site_id`, `phrase`, `location_code`, `language_code`, `device`, `active`, `created_at`, `updated_at`, `latest_position`, `previous_position`, `delta`, `last_checked_at`, `ai_overview_present`, `ai_cited`, `ai_cited_url`, `track_local_pack`, `last_failed_check_at`, `engine`, `engine_target` |
| SERP 功能 | `/api/v1/serp-features?siteId=…` | `id`, `site_id`, `keyword_id`, `engine`, `checked_at`, `source`, `features_json`, `top_results_json`, `created_at`, `source_kind` |
| 反向链接行 | `/api/v1/backlink-rows?siteId=…` | `id`, `review_id`, `site_id`, `url`, `domain`, `spam_score`, `rubric_band`, `rubric_version`, `first_seen`, `last_seen`, `dofollow`, `is_broken`, `rationale`, `rationale_status`, `captured_at`, `source_kind` |

`source_kind=provider_observation` 表示已存储的供应商观测，不是估算。JSON 字段保持文本格式；类似公式的文本仍保持安全的中和前缀。

## 故障排除与安全

`401` 表示密钥缺失或已撤销，`402` 表示套餐不是 Agency，`404` 表示站点不属于该账户，`429` 表示常规 API 限额已满，`503` 表示公共导出已关闭。请使用 HTTPS，密钥泄露后立即撤销，并为不同站点或数据集创建独立 Looker 数据源。

本工件遵循 Google 的[构建指南](https://developers.google.com/looker-studio/connector/build)、[身份验证指南](https://developers.google.com/looker-studio/connector/auth)、[API 参考](https://developers.google.com/looker-studio/connector/reference)和[清单参考](https://developers.google.com/looker-studio/connector/manifest)，检索日期为 2026-08-04。不包含图库发布或部署自动化。

[返回文档索引](./index.zh.md)
