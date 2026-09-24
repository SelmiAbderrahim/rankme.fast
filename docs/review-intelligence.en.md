---
title: 'Review Intelligence'
description: 'Sync public reviews on demand, read trends and cited themes, and understand exactly when a unit is returned.'
locale: en
slug: review-intelligence
section: research
order: 10
---

# Review Intelligence

Review Intelligence collects public reviews from the Google, Trustpilot, and Tripadvisor listings you configure and keeps them in one place. It calculates rating statistics and can group repeated praise and complaints into themes, each citing the stored reviews behind it.

<!-- docs-truth: metric=review_syncs; unit=one-sync-one-to-three-sources; cache-hits=count; refund=all-sources-provider-fail-zero-new-rows; cadence=on-demand; estimates=stored-observations -->

## Know what one unit covers

One confirmed sync uses one `review_syncs` unit for the whole job. You may select one, two, or three configured sources and choose a depth up to 100 reviews per source; the cost doesn't go up with the number of sources. The theme pass is included.

Previewing or cancelling spends nothing. See [Pricing](./pricing.en.md) for current monthly allowances and pack prices.

## Understand cache, deduplication, and refunds

Public review material served from cache still counts. RankMeFast deduplicates by source and source review ID, so a successful sync that finds no new rows also counts: the source was checked and existing reviews were confirmed.

You get the unit back, once, only when **every selected source** fails and no new review is saved. A partial sync, a successful sync with nothing new, or a failed theme pass still uses the unit, because the review work ran or reviews were kept. Retrying can't refund the same unit twice.

## Read themes and statistics

Ratings, counts, source splits, and monthly trends come from stored review rows. Generated themes are optional. A theme appears only when it cites stored reviews, and theme text that can't be backed up is dropped. If theme generation fails, your reviews and statistics are still there.

Search, filter, open a stored run, and export matching rows as CSV without using another sync unit. Review text is always shown as plain text.

## Choose when to sync

Review Intelligence is **on demand**. It does not monitor listings continuously, send review alerts, reply to reviews, or draft responses. Start a new sync when you want a fresher inventory. Pausing new syncs does not hide stored sources, runs, reviews, statistics, themes, or exports.

Open a site's **Reviews** tab, configure at least one source, review the spend preview, and confirm. For caps and refunds, see [Plans, limits & credits](./plans-limits-credits.en.md).

[Back to the docs index](./index.en.md)
