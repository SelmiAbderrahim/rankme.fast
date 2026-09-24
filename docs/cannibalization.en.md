---
title: 'Keyword cannibalization'
description: 'How RankMeFast finds queries where two or more of your pages compete, using only the Search Console rows it already stores.'
locale: en
slug: cannibalization
section: product
order: 4
---

# Keyword cannibalization

A cannibalization report reads the Google Search Console `query,page` rows RankMeFast already syncs for your site. It costs nothing in vendor fees and still works while Google is disconnected.

<!-- docs-truth: metric=cannibalization_reports; unit=one-report-one-window; cache-hits=count; refund=no-stored-rows-no-unit-consumed; cadence=on-demand; estimates=first-party-gsc-rows -->

## What a report shows

For each query where two or more of your pages appear, you see the competing pages with their clicks, impressions, average position, and share of the query's total.

RankMeFast also suggests which page should be the primary one. It always picks in the same order, so the same rows give the same answer:

1. Most clicks.
2. Best average position, if clicks tie.
3. A fixed tiebreak order, if both tie.

## Windows and confidence

You can run a report over 7, 28, or 90 days of stored rows. A longer window just uses more of what's already stored; it doesn't fetch anything new.

Each finding is graded high, medium, or low confidence. The grade reflects how strong the stored evidence is (how many rows there are and how clearly the pages separate), not what will happen if you act on it.

## Before you run one

If your site has no stored `query,page` rows yet, there's nothing to report on. RankMeFast asks you to sync Search Console first and doesn't use a plan unit.

## What stays with you

The report doesn't predict ranking changes and doesn't touch your site. Whether to consolidate a page, redirect it, or leave it alone is your call.

## Plans and availability

Monthly allowances are Starter 4, Pro 20, and Agency 100. For how units work, see [Pricing](./pricing.en.md).

If an operator turns off `CANNIBALIZATION_ENABLED`, new reports are refused with a localized message. Reports you already have stay readable.

[Back to the docs index](./index.en.md)
