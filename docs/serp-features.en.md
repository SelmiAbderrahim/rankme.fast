---
title: 'SERP feature tracking'
description: 'What RankMeFast records about search-result features on every rank check, and where that data stops.'
locale: en
slug: serp-features
section: product
order: 1
---

# SERP feature tracking

Every rank check RankMeFast runs also records which search-result features showed up for that keyword. You don't pay anything extra for it, and the check doesn't ask the provider for more results than usual.

<!-- docs-truth: metric=none; unit=byproduct-of-serp_checks; cache-hits=count; refund=not-applicable; cadence=follows-rank-check; estimates=provider-observation -->

## What gets recorded

For each check, RankMeFast notes whether any of these were on the results page:

- a featured snippet
- a People Also Ask block
- a local pack
- video, image, or shopping results
- a knowledge-graph panel

It also keeps the organic results, up to 100 rows.

A feature counts as yours when its host exactly matches your site's host once both are normalized. Anything else is recorded as present, but not yours.

## History

Each tracked keyword has a check-by-check history. You can read it as a dot matrix or as a table, which holds the same data and works better with screen readers and exports.

Observations are kept for 90 days, along with the newest 30 checks per keyword. Older rows drop off and can't be rebuilt.

## Limits

Because the rank check doesn't request extra depth, a live check can come back with fewer than 100 organic rows.

RankMeFast can only say that a feature was **observed** or **not observed** on a stored check. That isn't proof Google never shows it, and gaps stay gaps: nothing is estimated to fill them.

## Availability

There's no separate allowance, since capture comes with the rank checks your plan already includes. An operator can switch it off with the `SERP_FEATURE_TRACKING_ENABLED` flag, in which case new runs are refused with a message in your language and stored results stay readable. See [Pricing](./pricing.en.md) for units and plan limits.

[Back to the docs index](./index.en.md)
