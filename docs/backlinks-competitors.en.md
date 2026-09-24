---
title: 'Backlinks and Competitor Intelligence'
description: 'Compare backlinks, keyword landscapes, ranking pages, and stored competitor reports.'
locale: en
slug: backlinks-competitors
section: audits
order: 6
---

# Backlinks and Competitor Intelligence

Backlink data and Competitor Intelligence answer different questions. Backlinks show which sites link to a domain. Competitor Intelligence compares the search terms and ranking pages of sites you have confirmed for one of your own sites.

<!-- generated: finite-backlink-limits:start -->
Backlink rows are metered monthly. Pro includes up to 10,000 rows per month and Agency includes up to 100,000. Saved reports stay readable after you reach the monthly cap.
<!-- generated: finite-backlink-limits:end -->

## The site workspace

Open a site and choose **Competitors**. The workspace keeps the portfolio, keyword landscapes, content comparisons, monitoring, traffic estimates, and stored reports together. Pro can select up to three confirmed competitors for one landscape report. Agency can select up to ten. A site can retain up to ten active competitors.

Starter accounts can read the upgrade explanation. If an operator pauses new work, stored reports remain readable. A plan downgrade can also leave stored data in read-only mode.

## Units and confirmation

A landscape report uses one `keyword_lookups` unit for each selected competitor. Comparing three competitors uses three units. Before you confirm, RankMeFast shows how many units and rows the report will use. Cache hits still count. A discovery refresh is optional. It uses one more `keyword_lookups` unit, and only after its own preview and confirmation.

The comparison runs three keyword checks for each selected competitor: shared terms, terms only your site ranks for, and terms only the competitor ranks for. Each check keeps at most 100 rows, so an Agency report with ten competitors holds at most 3,000 keyword rows.

## Reading a landscape

The report uses five classes:

- `missing`: the competitor ranks and your site was not observed.
- `owned_only`: your site ranks and the competitor was not observed.
- `shared_behind`: both rank and your position is lower.
- `shared_ahead`: both rank and your position is higher.
- `shared_even`: both have the same observed position.

Ranks, ranking URLs, and observation dates come straight from the data source. Search volume and difficulty are provider estimates. Classes, confidence, and recommendations are worked out from the rows the report kept. A missing value stays missing; RankMeFast doesn't fill it with a guess. Partial reports show how many competitors and source steps returned usable data.

## Ranking pages and content

Agency reports can suggest pairs of ranking pages. Review both URLs before starting a content comparison. You may replace a suggested competitor URL with another public URL on the same confirmed domain. A suggestion never starts a crawl by itself, and RankMeFast won't quietly swap in a homepage.

The confirmed content comparison uses a separate `competitor_content_runs` unit. Reviewing a page match does not use that unit. Monitoring is also a separate, explicit action.

Recommendations stay inside the report until you accept one. Accepting one adds a single item to Next Actions. It doesn't publish content or start another paid job.

## Stored reports and exports

Reopening a landscape or an older content run doesn't call the provider or use another unit. PDF, CSV, and JSON exports use the stored snapshot. PDF refuses a selection above 1,000 keyword rows and points you to CSV or JSON. CSV and JSON keep the complete selected set within the 3,000-row report limit and the shared download size limit.

Old competitor bookmarks open the Competitors tab. The old Content Intelligence competitor link opens the Content view, and the standalone Keyword Gap keeps its own history and per-competitor `keyword_lookups` accounting.

Backlink scores and traffic figures are estimates based on provider coverage. Compare observations from the same source and date, and don't read them as your own analytics.

See [Plans, limits and credits](./plans-limits-credits.en.md) for current allowances and [Content Intelligence](./content-intelligence.en.md) for the separate content workflow.

[Back to the docs index](./index.en.md)
