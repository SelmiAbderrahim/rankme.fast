---
title: '下载与分享报告'
description: '选择合适格式、保留筛选条件并管理私密分享链接。'
locale: zh
slug: report-exports
section: product
order: 12
---

# 下载与分享报告

RankMeFast 会导出当前报告的固定快照。下载文件和基于该快照创建的公开分享会保留相同的筛选条件、来源日期、标签、语言和品牌。创建导出不会重新调用供应商，也不会消耗额度。

## 下载报告

1. 打开已完成的报告或已存结果。
2. 设定所需日期范围、行、搜索引擎、设备、位置或章节。
3. 选择**下载或分享**，再选择菜单提供的格式。
4. 如需再次下载，请打开**导出 → 下载**。

菜单只显示能完整表达该报告的格式。如果所选范围过大，RankMeFast 会拒绝导出，并提示你缩小筛选范围或改用 CSV/JSON；系统不会静默丢弃任何行。

## 各报告类型支持的格式

以下标识构成完整导出目录，也会出现在带版本的 JSON 中。

| 格式 | 报告类型 |
|---|---|
| PDF、CSV、JSON | `audit.run`；`ranks.current`；`ranks.history`；`ranks.serp_features`；`google.gsc_search`；`google.gsc_sitemaps`；`google.gsc_generative_appearance`；`google.ga4`；`keyword.research_result`；`keyword.trends_run`；`keyword.ai_cluster_run`；`keyword.serp_cluster_run`；`keyword.cannibalization`；`backlinks.deep_run`；`backlinks.gap_run`；`backlinks.toxicity_run`；`competitors.organic`；`competitors.tech_stack`；`competitors.traffic_snapshot`；`competitors.traffic_comparison`；`competitors.content_run`；`competitors.landscape_run`；`actions.plan`；`ai.visibility`；`audience.research_run`；`brand.radar_scan`；`content.inventory_run`；`internal_links.run`；`local.seo_snapshot`；`local.reviews`；`local.geogrid_scan`；`pages.performance`；`app.keyword_tracking`；`app.research_result` |
| PDF、JSON | `client.composite`；`backlinks.summary`；`content.recommendation_outcome`；`weekly_pulse.run` |
| PDF、JSON、Markdown | `content.analysis`；`content.brief` |
| CSV、JSON | `backlinks.inventory`；`content.monitor_feed` |
| JSON、JSON-LD | `schema.generation` |
| 纯文本 | `backlinks.disavow` |

PDF 适合阅读和展示。CSV 只用于真正的表格数据。JSON 保留完整的版本化报告文档。Markdown、JSON-LD 与拒绝收录文本只在它们是自然输出时提供。

## 筛选、范围与来源日期

快照会记录当前选择。例如，排名历史保留所选关键词 ID 与日期范围；评论报告保留来源、评分、查询和日期。每种表示都包含观察日期或范围，并区分观察值、推导值、估算值和生成文本。创建后再修改页面不会改变已有快照。

## 品牌与白标

PDF 和公开页面默认使用 RankMeFast 品牌。已经拥有白标 PDF 权限的账户可使用保存的公司名、强调色和受支持徽标。CSV、JSON、Markdown、JSON-LD 和文本没有视觉品牌，但元数据仍记录快照的品牌模式。导出不会为套餐新增白标权限。

## 分享链接

若该报告允许分享，请选择**分享**、允许的公开格式，以及一至 90 天的有效期。默认 30 天，链接绝不会晚于快照到期。链接只显示一次，请立即复制；RankMeFast 不会保存可读链接供以后再次展示。

任何持有该链接的人都可免登录访问。分享页带有 noindex 与 no-store，但仍需谨慎选择收件人。在**导出 → 分享**中可立即撤销。过期、撤销、来源删除或账户删除的链接都会返回相同的“未找到”响应。

## 隐私与外部使用

导出可能包含网站 URL、搜索查询、摘录、排名、评论文本、第一方分析数据和客户品牌。只应下载或分享给有权查看原报告的人。RankMeFast 保存允许字段组成的快照及其内容哈希，不保存供应商凭据、Cookie、原始分享令牌或账单载荷。快照 90 天后到期；删除网站或账户后会立即拒绝访问，之后再按保留流程执行物理清理。

CSV 使用 UTF-8。以公式标记开头的单元格（`=`、`+`、`-`、`@`、制表符或回车，包括前导空格之后）会先加文本前缀，再进行 CSV 引号处理。在 Excel 或 Sheets 中编辑时请保留该保护前缀。

JSON 当前使用 `schemaVersion: 1`，并包含报告类型自己的 `kindVersion`。集成应读取两个字段并拒绝未知版本，不要依赖内部数据库 ID 或文件名文字。

拒绝收录文件、Markdown 和 JSON-LD 在外部使用前需要人工复核。RankMeFast 不会替你向 Google 提交拒绝收录文件、发布 Markdown 或部署 JSON-LD。

[返回文档索引](./index.zh.md)
