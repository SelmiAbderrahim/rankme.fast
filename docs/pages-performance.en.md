---
title: 'Page performance'
description: 'How the Pages tab shows stored search data, crawl context, and page metrics.'
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

## Stored data and refresh

The Pages table keeps the page column visible while you scroll. Use **Columns** to show or hide other fields. Empty values appear as a dash; a zero means the source measured zero. Pages without a title are named by their path. If a measured URL matches a crawled page under a language prefix, **Crawled as** shows that path.

For Search Console, the date note gives the exact days behind the page totals. Google may count an impression for each page shown in one search, including searches whose query text is private, so page totals can exceed the site totals on the Google tab. **Too little data** marks a page with few impressions and no clicks; it has no movement label yet. The crawl note reports how many URLs the last audit fetched and why it stopped, when that evidence was recorded.

Opening details, searching, filtering, sorting and changing columns or result pages read stored data. **Refresh** requests new source data. If it fails, the last successful snapshot remains visible and is marked stale. Try again when the connection is available.

## Deletion and exports

Deleting a site, or completing an account-deletion request, removes its stored Pages snapshots. The current account export does not include Pages snapshots or GSC and rank time-series history, so do not treat that export as a backup of these trends.

## Troubleshooting

- For **Syncing**, wait for the first Search Console collection and refresh the view later.
- For **Reconnect**, restore the Google connection from the Google tab.
- For **Property does not match**, select a Search Console property that covers the site's exact URL prefix or domain.
- For **No stored source**, connect Search Console or choose **Get ranking data**.
- For **Unavailable**, retry the same source. RankMeFast does not silently switch away from usable Search Console data.

See also [Connecting Google Search Console](./google-search-console.en.md) and [Rank tracking](./rank-tracking.en.md).

[Back to the docs index](./index.en.md)
