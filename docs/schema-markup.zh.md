---
title: 'Schema 标记生成器'
description: 'RankMeFast 如何基于已存的页面事实生成 JSON-LD、此处的"符合规范"指什么，以及为什么缺失的属性会被省略而非虚构。'
locale: zh
slug: schema-markup
section: product
order: 10
---

# Schema 标记生成器

生成器根据 RankMeFast 已掌握的事实为页面生成 JSON-LD，来源可以是已审计的页面、内容清单中的页面，或你粘贴的 URL。结果由你复制或下载。

<!-- docs-truth: metric=schema_generations; unit=one-generation-one-page-one-type; cache-hits=count; refund=missing-evidence-omitted-with-reason; cadence=on-demand; estimates=first-party-facts -->

## 类型与证据

支持七种类型：`WebPage`、`WebSite`、`Organization`、`Article`、`BreadcrumbList`、`FAQPage` 和 `HowTo`。类型由你选择，证据由 RankMeFast 收集。

输出中的每个属性都关联着它所来自的已存事实，因此在发布之前，你可以把每个值追溯到对应的页面。 `FAQPage` 和 `HowTo` 排在列表末尾，各带一条简短说明。Google 只在知名政府和健康类网站的搜索结果中展示 FAQ 答案，并且已完全不再展示 HowTo 步骤。这两种类型仍会生成有效的 schema.org 标记。

## 符合性报告

符合性检查会把结果分成两组：

- **必填缺口**：该类型需要的属性。
- **建议**：能让标记更完善的属性。

通过检查意味着输出满足你所选类型的 schema.org 要求。它绝不是 Google 会展示富媒体结果的保证。

## 属性为何缺失

如果某个属性没有已存证据，就会被省略，报告会说明原因。评分、价格、评论、作者和日期从不编造。 所以 `Article` 常会出现 `datePublished` 缺口。页面没有提供 RankMeFast 能读取的发布日期时，生成器会直接告诉你，而不会去猜。

## 你补充的名称和信息

对于 `WebSite` 和 `Organization`，名称取自页面提供的第一个来源：它的 `og:site_name` 标签，然后是页面上 `Organization` 或 `WebSite` 标记已声明的名称，然后是页面标题中的品牌部分（分隔符和“欢迎”之类的词会被去掉），然后是你给站点起的名称，最后才是域名。证据列表会显示用了哪个来源。在**我们省略的内容**下，你可以为描述、语言、日期或图片地址等属性填写值。生成器会按你写的原样添加，并标记为**由你提供**。选择**用我的信息重建**即可应用。重建会复用最初生成时已找到的事实，不会再次调用 AI，也不消耗生成次数。原件保持不变，重建结果会保存为新的生成。

## 值如何校验

由 AI 模型决定填写哪些属性。随后的校验会把每个值与其已存事实逐一比对，不是逐字复制的值会在你看到之前被拒绝。

标记需要你自己添加到站点上。RankMeFast 不会把它注入你的站点、主题或标签管理器，也没有任何能这样做的凭据。

[返回文档索引](./index.zh.md)
