---
title: 'Page performance'
description: 'How the Pages tab chooses data, compares snapshots, and counts refreshes.'
locale: en
slug: pages-performance
section: research
order: 13
---

# Page performance

Open a site and choose **Pages** to compare search performance with the latest crawl inventory. Opening the tab only reads data you already have. New data is collected only when you choose **Refresh** or **Collect fallback data**.

## Which source appears

RankMeFast uses Google Search Console when the connected property covers the site. Search Console stays the main source even while its first collection is still syncing or when the selected window has no rows. An empty but working Search Console connection is never swapped for fallback estimates.

If Search Console is not connected, needs reconnection, was revoked, or has no matching property, the tab can use the latest stored ranked-keyword snapshot. The source label says whether this is a DataForSEO snapshot or sample demo data. If neither source has stored data, the tab explains what to connect or collect.

## Metrics and date windows

Search Console clicks, impressions, CTR, and average position are observed metrics for the selected rolling window of 7, 28, or 90 days. Google reporting is delayed by three days. Search Console may sample or cap rows, so check the coverage note before comparing totals.

Fallback position, search volume, difficulty, ranking-keyword count, and estimated traffic are estimates from one point-in-time snapshot. Fallback data has no clicks, impressions, or CTR. Those fields show **Not available**, which is different from a real zero. Changing the fallback window changes the history and comparison context, not the headline snapshot.

**Since previous sync** compares the current successful snapshot with the one just before it. It doesn't compare against the previous period. Open a page to see its associated Search Console queries or fallback keywords and up to 90 stored trend points.

## Opportunities and crawl context

- **Striking distance** means the page is above position 3 and no lower than position 20, with enough observed impressions or estimated search volume to meet the rule.
- **Low CTR** applies only to Search Console rows with enough impressions, a top-ten average position, and CTR below the rule threshold.
- **Declining** and **Winning** compare position or observed clicks with the previous successful sync.
- **Visible but not crawl-indexable** means search performance exists while the latest RankMeFast crawl marked the page non-indexable.
- **Unmeasured** means the latest crawl found a crawl-indexable page but the selected performance source has no row for it.

Crawl indexability describes what RankMeFast found while crawling. It does not prove whether Google indexed a URL. A provider-visible non-indexable page remains in the list so you can investigate the conflict.

## Refresh cost and stale data

Search Console refresh reuses the connected Search Console sync and does not spend a keyword lookup. A fallback refresh costs one keyword lookup, including a cache hit, and the button makes that action explicit. Opening detail, searching, filtering, sorting, changing page size, and moving between result pages only read saved data and don't use any allowance.

If a refresh fails, the last successful snapshot stays visible and is marked stale. An old fallback snapshot can also become stale when it passes the ranked-keyword cache freshness window. Once the provider or connection is back, retry with the refresh button.

## Deletion and exports

Deleting a site, or completing an account-deletion request, removes its stored Pages snapshots. The current account export does not include Pages snapshots or GSC and rank time-series history, so do not treat that export as a backup of these trends.

## Troubleshooting

- For **Syncing**, wait for the first Search Console collection and refresh the view later.
- For **Reconnect**, restore the Google connection from the Google tab.
- For **Property does not match**, select a Search Console property that covers the site's exact URL prefix or domain.
- For **No stored source**, connect Search Console or run the fallback collection (it uses a keyword lookup).
- For **Limit reached**, review keyword-lookup usage or your plan. Existing stored snapshots remain readable.
- For **Unavailable**, retry the same source. RankMeFast does not silently switch away from usable Search Console data.

See also [Connecting Google Search Console](./google-search-console.en.md) and [Rank tracking](./rank-tracking.en.md).

[Back to the docs index](./index.en.md)
