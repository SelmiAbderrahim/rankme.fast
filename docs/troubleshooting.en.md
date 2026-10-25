---
title: 'Troubleshooting'
description: 'Common problems and how to fix them.'
locale: en
slug: troubleshooting
section: start
order: 3
---

# Troubleshooting

## Audit failed or unavailable
An audit fails when we can't reach your site or the crawl provider times out. Common causes:
- Your site is behind a Cloudflare "under attack" rule blocking crawlers.
- Robots.txt blocks user-agent `RankMeFastBot` or "`*`".
- Your server returned a 5xx error for our first requests.

Try again in a few minutes. If it keeps failing, change your firewall or robots.txt to let our bot in.

## Rank check unavailable
A single keyword can come back unavailable if the search-results provider is rate-limited or Google showed a captcha. This is temporary and the next scheduled run tries again, so you don't need to do anything.

## Search Console asks you to reconnect
Google invalidated our token. On the site's **Google** tab, the Google Search Console card shows **Your Google connection needs to be reconnected**; select **Reconnect**. This can happen if you changed your Google password or revoked the app.

## Cap reached
See [Plans, limits & credits](./plans-limits-credits.en.md). You can upgrade, buy a small credit pack, or wait for the next billing period.

## Cap reached on a research tool (402)
The message names the unit that ran out, for example `keyword_lookups` or `audience_research_runs`. Wait for the monthly reset, buy a credit pack if there is one, or upgrade. Audience Research runs have no pack.

## Partial results on a research tool
Some engines or sources answered and others didn't. You get what arrived, labeled **partial results**, and the missing part is named instead of being filled with zeros.

## Unsupported for this engine / market
The check can't run for that engine or market, so that part is left out of the result. It is never shown as a zero.

## Unavailable (not zero)
No data came back for the period. `unavailable ≠ 0`: read it as unknown rather than a drop to zero. You will see this on share-of-voice and Search Console generative-AI cards.

## "Search Console isn't connected" on analytics or generative-AI cards
Cards that read Search Console or Google Analytics show **Search Console isn't connected** or **Google Analytics isn't connected** until Google is connected again, then recover on the next read.

## Verification email missing
Check spam. The link expires after 24 hours. If it really didn't arrive:
- Check that you typed the address correctly. Typos are the most common cause.
- Try Google sign-in instead if your address is Gmail.
- Contact support if it's a company address, since your mail server may be filtering it.

## AI summary shows "shortened"
Long audits are shortened before we send them to the model. The summary is still valid; it's just based on the shorter version. Click **Regenerate** if you want another take.

## Report screen loops loading
Hard-refresh the page (⌘/Ctrl + Shift + R). If that doesn't help, clear your browser cache. If it still loops, the report and an audit that is still running are usually out of sync, and support can refresh it from their side.

[Back to the docs index](./index.en.md)
