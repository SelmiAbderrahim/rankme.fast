---
title: 'Link Intelligence'
description: 'Run deeper backlink checks and compare link gaps, and know what each unit pays for.'
locale: en
slug: link-intelligence
section: research
order: 7
---

# Link Intelligence

Use Link Intelligence when the standard backlink overview doesn't go deep enough. It can pull referring domains, anchors, history or bulk domain ranks, and it can compare your site with up to three competitors.

<!-- docs-truth: metric=link_intel_checks; unit=deep-one-gap-per-competitor; cache-hits=count; refund=provider-failure-zero-retained-per-leg; cadence=on-demand; estimates=provider-observation -->

## What one unit covers

- Each deep pull you submit uses one `link_intel_checks` unit.
- A link-gap run uses one unit per competitor, so comparing three competitors uses three units.
- The preview shows the unit breakdown and costs nothing. When you confirm, your allowance is checked again.

See [Pricing](./pricing.en.md) for current plan allowances and pack prices. The deep tools need an eligible plan. Opening a result you already have only reads saved data.

## Cache and refunds

A result served from cache still counts. So does a successful check with no rows: it tells you the source had no matching links at that time.

If the source fails before RankMeFast has saved any row, that unit is returned once. In a gap run with several competitors, each competitor is settled on its own: the ones that returned data stay charged, and a failed one with no data is refunded. Previews, cancelled previews and opening saved results never use a unit.

## Reading the results

Deep results show when the data was collected. If a first-seen date is missing, it stays blank; we don't make one up. Gap percentages are calculated from the saved rows, and competitors stay in the order you entered them.

Checks run **on demand**. There's no continuous monitoring, so run a new check when you want fresher data. If the feature is turned off, you can't start new previews or runs, but saved results stay readable.

## Start a check

Open a site's Backlinks workspace. Choose **Domains**, **Anchors**, **History** or **Gap**, check the spend preview, then confirm. Use the list of saved runs to reopen an earlier result without spending again.

For monthly caps, packs and the general refund rule, see [Plans, limits & credits](./plans-limits-credits.en.md).

[Back to the docs index](./index.en.md)
