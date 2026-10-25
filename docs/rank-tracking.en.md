---
title: 'Rank tracking'
description: 'Adding keywords, reading positions, weekly vs daily.'
locale: en
slug: rank-tracking
section: research
order: 1
---

# Rank tracking

Rank tracking shows where your pages appear in Google for the keywords you care about.

## Adding keywords
Open the site view, click **Add keyword** and type the phrase you want to track. RankMeFast checks it against your keyword cap (see [Plans, limits & credits](./plans-limits-credits.en.md)) and won't add duplicates.

## Reading positions
- **Position**: where your best-ranking page appears for that keyword. Position 1 is the top blue link. "Not in top 100" means we searched and didn't find you in the first hundred results.
- **Delta**: the change since the last check. **-3** means you moved up three places; **+5** means you dropped five.
- **Last checked**: when the position was last measured. Weekly checks run once a week and daily checks run every day.

## Weekly vs daily
Every plan includes **weekly** checks. **Daily** checks are a paid add-on, because checking Google's results every day costs a lot more to run.

## Adding several at once
Type or paste a list into **Add keyword**. A comma or a new line ends a keyword, so pasting `seo audit, rank tracker` adds two keywords. Up to 100 keywords go in per request. Keywords you already track are skipped, and RankMeFast tells you which ones.

## Check now
**Check now** runs a check right away instead of waiting for the next scheduled one. On a keyword row it checks that keyword; at the top of the list it checks every active keyword. A confirmation names what will be checked before anything runs. A check of the whole site runs in the background as one job: you can leave the page and come back, and the result says how many keywords were checked, how many failed and how many were not reached in time. A keyword that was never reached is not shown as a failed check.

## Trend chart
Select a keyword to see its position over time. A rising line is bad (a higher number means a worse rank) and a falling line is good. Below the chart, an accessible data table lists the same numbers.

## "Unavailable" checks
Sometimes a check comes back as unavailable. The usual reasons:
- Our search-results provider has used up its quota for the day.
- The results page only has a feature we don't measure, such as a news carousel.
- Google showed a captcha and we couldn't verify the result.

Unavailable checks don't use credit and are retried on the next scheduled run.

## Cap reached
Every plan has a keyword cap. Once you reach it, the Add form is replaced by a notice that points you to an upgrade. Your existing keywords are still checked.

The [Page performance guide](./pages-performance.en.md) covers the separate Pages fallback snapshot. Its estimated page metrics don't replace scheduled rank tracking or Search Console data.

[Back to the docs index](./index.en.md)
