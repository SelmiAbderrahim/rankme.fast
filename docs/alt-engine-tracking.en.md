---
title: 'Bing, YouTube, and Amazon tracking'
description: 'How RankMeFast tracks non-Google engines, what an exact target token is, and why an Amazon position is an index position.'
locale: en
slug: alt-engine-tracking
section: product
order: 3
---

# Bing, YouTube, and Amazon tracking

Keywords for other engines go through the usual add-keyword flow, with an engine picker. Rank history is tagged by engine, and the history view has an engine filter that's kept in the URL.

<!-- docs-truth: metric=alt_engine_checks; unit=one-keyword-one-engine-check; cache-hits=count; refund=provider-failure-zero-retained; cadence=weekly; estimates=provider-observation -->

## How each engine is matched

- **Bing** works like Google: a result is yours when its normalized host equals your site's host.
- **YouTube** matches on an exact channel handle.
- **Amazon** matches on an exact ASIN.

Every YouTube or Amazon result lives on the platform's own domain, so matching by host would tell you nothing, and RankMeFast doesn't attempt fuzzy brand matching either.

Without the exact handle or ASIN it won't guess. The keyword simply can't be tracked on that engine until you add one.

## Cadence and units

Non-Google targets are checked once a week, whatever cadence the site uses otherwise. Each keyword-and-engine check reserves one alternative-engine unit before the request goes out.

Cached results still count against your allowance. If the provider fails, nothing is stored and the unit comes back to you.

## Reading Amazon positions

An Amazon position is a place in the product index the provider returns, not a live shelf position. Sponsored blocks are removed before ranking.

As with every engine, a position is what was observed on a given date. It isn't a forecast.

## Plans and availability

Monthly allowances are Starter 0, Pro 20, and Agency 240. If you run out, a one-time credit pack can top you up.

An operator can switch this off with the `ALT_ENGINE_TRACKING_ENABLED` flag. New runs are then refused with a localized message, and existing history stays readable.

For units and plan limits, see [Pricing](./pricing.en.md).

[Back to the docs index](./index.en.md)
