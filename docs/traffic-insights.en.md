---
title: 'Traffic Insights'
description: 'Compare modeled competitor traffic, with clear estimate labels, unit costs and refund rules.'
locale: en
slug: traffic-insights
section: research
order: 8
---

# Traffic Insights

Traffic Insights saves a snapshot of a competitor domain: modeled monthly organic visits, domain rank, keyword count, top countries and history. Use it to compare direction and scale. It can't replace the competitor's own analytics.

<!-- docs-truth: metric=traffic_snapshots; unit=one-target-domain-snapshot; cache-hits=count; refund=all-provider-parts-fail-zero-retained; cadence=on-demand; estimates=required -->

## What one unit covers

Each target-domain snapshot you submit uses one `traffic_snapshots` unit. If you preview several domains at once, the preview shows one unit per domain, and each confirmed domain becomes its own snapshot. Previewing, or cancelling a preview, costs nothing.

Current monthly allowances and pack prices are on [Pricing](./pricing.en.md). Opening, filtering or comparing snapshots you already have only reads saved data, so it uses no new unit.

## Every number is an estimate

Every number in Traffic Insights is labeled **Estimate**. The values are modeled from a search-data index. They aren't real visits, conversions or analytics data. Missing values stay marked as unavailable. A snapshot where only some parts succeeded can still be useful, and the interface marks it as partial.

The compare view lines up to five saved snapshots side by side. It doesn't fill gaps or guess missing country or history values.

## Cache and refunds

A cached snapshot still counts as one unit, and so does a successful snapshot that comes back empty.

Each snapshot combines several related lookups. If all of them fail and RankMeFast keeps no result, the unit is returned once. If any usable part is kept, the snapshot is saved as partial or complete and the unit stays spent. A network retry can't refund the same unit twice.

## When to refresh

Traffic Insights runs **on demand**. It doesn't watch competitors continuously, so start a new snapshot when you want a newer estimate. If an operator pauses new snapshots, you can still open your saved list, details and comparisons.

To start, open a site's **Traffic** tab, enter a public domain, check the spend preview and confirm. For caps, packs and refund rules, see [Plans, limits & credits](./plans-limits-credits.en.md).

[Back to the docs index](./index.en.md)
