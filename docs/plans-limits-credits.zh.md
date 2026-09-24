---
title: '方案、限额与额度'
description: 'Starter、Pro 和 Agency 的限额与超额点数。'
locale: zh
slug: plans-limits-credits
section: account
order: 2
---

# 方案、限额与额度

<!-- generated: finite-free-intro:start -->
RankMeFast 提供三个付费订阅套餐：Starter、Pro 和 Agency。
<!-- generated: finite-free-intro:end -->

## 自定义方案

除了固定方案和积分包，你还可以在**价格**页面或**账单 → 自定义方案**中组合自己的方案：选择月度额度、网站和席位数量、要开启的功能，以及排名检查频率。每个选项都有自己的最小值、最大值和步长，有些选项依赖或排斥其他选项。浏览器里的价格只是估算，实际报价由服务器生成。

自定义方案的月度额度在每月账单日（UTC）重置。年付包含 12 份这样的月度额度。网站、关键词和席位不会重置：删除一个，名额就会空出来。单次任务限额（例如每次审计的页数）按每次任务计算。

年付最多比 12 次月付便宜 20%。预览显示的是扣除最低金额、向上取整和我们的成本底线之后你实际拿到的折扣。如果全额折扣会让价格低于成本底线，你会看到较低的折扣、没有折扣，或者无法选择年付。我们不会显示你拿不到的折扣。

已登录且邮箱已验证的所有者可以锁定一份报价，有效期 30 分钟。只有服务器确认可以购买时才会出现结账按钮。价格以美元计，Polar 会在结账时加收适用税费。在沙盒环境、未配置支付、定价数据过期或暂停销售时，你仍可以预览方案，但无法购买。

自定义方案在付款确认后开始生效。没有试用、优惠券、钱包余额，也不做周期中途按比例计费。已付费的内容在本周期结束前保持不变。修改方案、在月付和年付之间切换，或在固定方案与自定义方案之间切换，都需要在已付周期结束时重新结账。如果续订需要新价格，请在显示的截止日期前接受，否则方案不会续订。取消在周期结束时生效。仍然有效的积分包余额会保留，周期性附加项不会被悄悄并入自定义限额。退款按结账时显示的条款处理。如果延迟扣款按不安全的价格扣了费，我们会自动全额退还。

## 三个方案

<!-- generated: finite-plan-table:start -->
<!-- source: tiers.ts -->
| Plan     | Monthly (USD) | Yearly (USD) | Sites | Keywords | Audits/month | Audit pages | Backlink rows | AI summaries | Seats | Audience Research runs |
|----------|---------------|--------------|-------|----------|--------------|-------------|---------------|--------------|-------|------------------------|
| Starter  | $49           | $470.40      | 2     | 250      | 10           | 1,000       | 0             | 20           | 1     | 2                      |
| Pro      | $159          | $1,526.40    | 5     | 1,000    | 30           | 3,000       | 10,000        | 100          | 3     | 10                     |
| Agency   | $499          | $4,790.40    | 50    | 2,000 | 45           | 5,000       | 100,000       | 480          | 15    | 30                 |
<!-- generated: finite-plan-table:end -->

价格为美元。年付享 20 % 折扣。每日排名追踪在所有方案中均为付费加购。

<!-- generated: finite-limit-semantics:start -->
**限额如何计算。** 网站、跟踪关键词和席位按当前数量计算，删除一项就会空出名额。审计、排名检查、反向链接行、AI 任务和其他计量单位在每个自然月初（UTC）重置。每次审计还有各自的页面上限。购买的用量包会一直保留，直到用完。订阅附加项只增加“结算”页面列出的额度。
<!-- generated: finite-limit-semantics:end -->

## 受众研究运行

<!-- source: tiers.ts -->
一次运行就是一整个研究任务，无论内部读取多少页面。Starter 每月 2 次，Pro 10 次，Agency 30 次。此指标没有额度包。达到上限后，请等待月度重置或升级。参见[受众研究](./audience-research.zh.md)。

## 关键词智能与每周脉搏的单位

<!-- source: tiers.ts -->
- 一次关键词缺口检查按比较中的每个竞品消耗一个 `keyword_lookups` 单位。
- 一次关键词概览或趋势读取按每个关键词消耗一个 `keyword_lookups` 单位。来自缓存的结果同样计费。
- 对关键词列表聚类消耗一个 `ai_summaries` 单位；对完全相同的列表重新运行免费。
- 一份每周脉搏摘要按每个网站每周消耗一个 `ai_mentions_checks` 单位，无论多少团队成员收到。

详情见[关键词智能](./keyword-intelligence.zh.md)与[每周脉搏](./weekly-pulse.zh.md)。

### 竞品分析限额

竞品分析从 Pro 开始提供。Pro 的一份关键词版图最多可包含三个已确认竞品，Agency 最多可包含十个。每个所选竞品消耗一个 `keyword_lookups` 额度。可选的竞品发现刷新需单独确认，并额外消耗一个额度。Agency 的排名页面内容比较是独立流程，每次确认后消耗一个 `competitor_content_runs` 额度。阅读已保存报告、审核页面配对、接受建议和导出都不会消耗这些额度。详情请参阅[反向链接与竞品分析](./backlinks-competitors.zh.md)。

## AI 助手消息

<!-- source: tiers.ts ai-chat -->
一个单位即向 AI 助手发送的一条消息。Starter 每月 100 条，Pro 200 条，Agency 400 条。缓存命中和被停止的回复同样计数。可在**账单 → 积分**以 19 美元一次性购买 100 条消息。

## 洞察功能限额和单位

<!-- source: tiers.ts intelligence-caps -->
| 方案 | 趋势探索 | 流量快照 | 链接检查 | 评论同步 | 品牌雷达扫描 |
|---|---:|---:|---:|---:|---:|
| Starter | 10 | 5 | 0 | 0 | 0 |
| Pro | 40 | 25 | 25 | 10 | 0 |
| Agency | 80 | 80 | 80 | 50 | 20 |

一个趋势单位包含最多五个短语。一个流量单位包含一个目标域名。一个链接单位包含一次深度查询或一个竞争对手部分。一个评论单位包含一到三个来源的完整同步。一个品牌雷达单位包含一个品牌查询及带引用摘要。

缓存结果会计入，成功但没有结果的查询也会计入。只有数据源在功能保存任何有用内容之前失败时，才会退还一个单位（仅一次）。请参阅[链接情报](./link-intelligence.zh.md)、[流量洞察](./traffic-insights.zh.md)、[关键词趋势](./keyword-trends.zh.md)、[评论洞察](./review-intelligence.zh.md)和[品牌雷达](./brand-radar.zh.md)。

## 品牌雷达附加项和用量包

<!-- source: tiers.ts intelligence-products -->
<!-- intelligence-products: brand-addon=60@1900; brand-scans-40=40@2900; link-intel-100=50@1900; review-syncs-100=50@1900; traffic-snapshots-100=100@1900; trend-explorations-200=200@1900 -->
Pro 和 Agency 可以每月 19 美元增加 60 次品牌雷达扫描。Agency 的 20 次基础扫描无需附加项；Pro 的基础限额为零。

一次性用量包包括：40 次品牌雷达扫描 29 美元、50 次链接检查 19 美元、50 次评论同步 19 美元、100 次流量快照 19 美元，以及 200 次趋势探索 19 美元。余额会保留到使用为止。请查看[定价](./pricing.zh.md)或**计费 → 额度**。

## ASO 限额、附加服务和点数包

<!-- source: tiers.ts app-seo-caps -->
| 套餐 | 应用关键词检查 | 页面审计 | 榜单检查 | 关键词研究 | 竞品发现 | 评论分析 | 应用资料 | 跟踪中的应用关键词 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Starter | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Pro | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 25 |
| Agency | 50 | 4 | 20 | 2 | 0 | 0 | 5 | 50 |

<!-- source: tiers.ts app-seo-products -->
<!-- app-seo-products: addon=app_keyword_checks:600,app_listing_audits:8,app_chart_checks:60,app_keyword_lookups:40,app_competitor_lookups:10,app_review_runs:10@2900; app-keyword-checks-500=500@1900; app-research-50=50@1900; app-competitors-20=20@1900; app-review-runs-10=10@1900 -->
Pro 和 Agency 可按每月 29 美元增加 600 次关键词检查、8 次页面审计、60 次榜单检查、40 页研究、10 次竞品发现和 10 次评论分析。Agency 的基础额度仍然保留。

Pro 和 Agency 还可购买四种一次性点数包：500 次关键词检查、50 页研究、20 次竞品发现或 10 次评论分析。每个点数包 19 美元。点数保留至用完，并且只在月度额度耗尽后扣除。

## 试用安排
试用并非所有付费方案的固定权益。如果某项优惠包含试用，确认付款前会显示试用期限和首次扣款日期。

## 达到上限
相关操作被阻止，可选择升级或购买 **超额额度包**。

## 超额额度包
按对应指标补充的小额用量，会保留在账户中直至使用。

## 取消与降级
取消后可使用至周期结束。降级在下次续订生效，多出的资源变为只读。

## 企业方案
<!-- generated: finite-enterprise-plan:start -->
Enterprise 从 100 个有效网站和 25 个席位起步。协议会以具体数值记录更高的额度，未列出的指标沿用 Enterprise 基础值。见[企业方案](./enterprise.zh.md)。
<!-- generated: finite-enterprise-plan:end -->

[返回文档索引](./index.zh.md)
