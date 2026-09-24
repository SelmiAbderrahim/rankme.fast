---
title: 'Internal linking suggestions'
description: 'How RankMeFast finds orphan and weakly-linked pages in your stored content inventory and drafts anchors that cite the evidence behind them.'
locale: en
slug: internal-linking
section: product
order: 7
---

# Internal linking suggestions

Internal linking works from two things RankMeFast already has: your completed content inventory and the Search Console queries stored for your site. It doesn't crawl anything itself.

<!-- docs-truth: metric=internal_link_runs; unit=one-run-over-stored-inventory; cache-hits=count; refund=ai-failure-keeps-deterministic-output; cadence=on-demand; estimates=first-party-inventory -->

## How candidates are found

RankMeFast looks for orphan and weakly linked pages in the inventory.

For each one, it finds likely source pages: pages that share stored Search Console queries with it, or whose headings overlap.

Each suggestion shows that evidence, so you can check the reasoning before adding a link.

## Anchor text

The AI runtime drafts anchor text and ranks it over the rule-based candidate list. Every AI anchor is labelled as an AI interpretation, and the suggestion underneath holds up without it.

If the AI step fails, you still get the rule-based suggestions with fallback anchors. A run never comes back empty because of the model.

Suggestions can be exported to CSV.

## Your inventory has to be recent

Suggestions only come from a completed content inventory that's at most seven days old. If yours is missing or older, RankMeFast asks you to refresh it rather than crawling on its own.

Every source and target is a page already in that inventory, and pages marked `noindex` are never suggested as targets.

## Limits

- Confidence reflects the evidence (how many queries are shared, how strongly headings overlap), not expected traffic or ranking gains.
- Nothing is written to your site. You get a list and add the links yourself in your CMS.

See [Pricing](./pricing.en.md) for units and plan limits.

[Back to the docs index](./index.en.md)
