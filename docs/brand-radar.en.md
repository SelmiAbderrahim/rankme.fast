---
title: 'Brand Radar'
description: 'Scan one brand query on demand, inspect retained mentions, and understand the add-on and refund boundary.'
locale: en
slug: brand-radar
section: research
order: 11
---

# Brand Radar

Brand Radar searches for public mentions of one brand query, saves the mentions it keeps, and builds counts, sentiment distribution, top domains, and a comparison with the previous settled scan for the same query on the same site. It can also create a short cited digest.

Open a site and choose the **Brand Radar** tab. Every scan belongs to that site, so two sites tracking the same brand keep separate lists and separate trend baselines.

The optional **Publisher country** field is searchable. It filters by the country where the publishing website is registered, not the reader's location. Leave it on **All countries** for a worldwide scan. Older scans that stored only an unused numeric location value are shown as worldwide because that value never affected their results.

<!-- docs-truth: metric=brand_mention_scans; unit=one-scan-one-brand-query; cache-hits=not-applicable-fresh-required; refund=search-provider-failure-zero-retained; cadence=on-demand; estimates=ai-digest-labeled -->

## Know what one unit covers

One confirmed scan of one brand query uses one `brand_mention_scans` unit. The optional language and publisher-country filters and the cited digest are included. A scan cannot bundle competitor queries into the same unit.

Previewing or cancelling spends nothing. The preview always shows a fresh fetch, because mention rows belong to your account and are never cached for other accounts. Current base allowances, the optional Brand Radar add-on, and pack prices are on [Pricing](./pricing.en.md).

## Understand refunds and partial results

You get the unit back, once, only if the first mention search fails at the source and RankMeFast keeps no mention rows.

These outcomes still consume the unit:

- the search succeeds but finds no mentions;
- some mentions are retained before a later source or budget stop;
- the summary or generated digest fails;
- every generated digest sentence is dropped because its citation cannot be verified.

RankMeFast won't throw away mentions it found just to give you a refund.

## Separate measured facts from generated prose

Mention count, sentiment split, top domains, and change from the previous same-query scan are computed from stored rows. If there's no previous scan, you'll see “no comparison yet” instead of a zero.

Digest sentences are written by AI and appear only when they cite stored mention rows. If no reliable sentence survives, the interface says so. You can inspect mention rows and export them as CSV.

## Choose when to scan

Brand Radar is **on demand**, not continuous monitoring. Start a new scan when you need a new observation. Weekly Pulse may summarize deltas already stored by Brand Radar for that same site, but it does not start a scan or spend another scan unit. If new scans are paused, stored lists, details, citations, trends, and exports remain readable.

For eligibility, allowances, and refund rules, read [Plans, limits & credits](./plans-limits-credits.en.md).

[Back to the docs index](./index.en.md)
