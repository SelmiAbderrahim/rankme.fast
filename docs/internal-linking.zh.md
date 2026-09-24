---
title: '内链建议'
description: 'RankMeFast 如何在你已保存的内容清单中找出孤立页与弱链接页，并给出引用其证据的锚文本草稿。'
locale: zh
slug: internal-linking
section: product
order: 7
---

# 内链建议

内链建议基于 RankMeFast 已有的两类数据：你已完成的内容清单，以及为你站点保存的 Search Console 查询。它本身不做任何抓取。

<!-- docs-truth: metric=internal_link_runs; unit=one-run-over-stored-inventory; cache-hits=count; refund=ai-failure-keeps-deterministic-output; cadence=on-demand; estimates=first-party-inventory -->

## 候选如何产生

RankMeFast 先在清单中找出孤立页面和内链较弱的页面。

然后为每个页面寻找合适的来源页：与它共享已存 Search Console 查询的页面，或标题有重合的页面。

每条建议都会列出这些依据，你可以先核对理由，再决定是否添加链接。

## 锚文本

AI 运行时会起草锚文本，并在基于规则的候选列表之上排序。每条 AI 锚文本都标注为 AI 解读，下面的建议即使不看它也站得住。

如果 AI 环节失败，你仍会得到基于规则的建议和后备锚文本。运行结果不会因为模型出错而为空。

建议可以导出为 CSV。

## 内容清单必须够新

建议只来自完成时间不超过七天的内容清单。如果清单缺失或已过期，RankMeFast 会请你先刷新，而不会自己去抓取。

每个来源页和目标页都必须已在该清单中，标记为 `noindex` 的页面不会被建议为目标。

## 限制

- 置信度反映的是证据（共享了多少查询、标题重合程度有多高），而不是预期的流量或排名收益。
- 不会向你的站点写入任何内容。你拿到的是一份清单，链接需要你自己在 CMS 中添加。

用量单位与套餐限制见 [价格](./pricing.zh.md)。

[返回文档索引](./index.zh.md)
