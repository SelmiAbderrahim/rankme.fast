---
title: 'Connecting Google Search Console'
description: 'Why connect, what we access, how to disconnect.'
locale: en
slug: google-search-console
section: research
order: 3
---

# Connecting Google Search Console

Search Console is Google's free tool that shows how Google sees your site. Once you connect it, three audit rules use Google's own answer instead of an estimate:
- **Not indexed by Google**: is a given page actually in search results?
- **Rich results issues**: is your structured data valid?
- **Indexed with warnings**: has Google flagged a canonical or duplicate-content problem?

## Why connect
Without a connection, these rules show under **Not evaluated** in the report. They are not counted as Watch issues and do not appear in Next actions. Once connected, they land in the right tab and list the pages you need to fix.

## What we can access
- We ask Google for the **read-only** Search Console scope, `webmasters.readonly`. It's the smallest scope that lets us call the URL Inspection API.
- We can't see Gmail, Drive or anything else in your Google account. The only thing we store is an encrypted refresh token, which we use to renew the short-lived access token.

## Connecting
1. Open Settings → Google Search Console.
2. Click **Connect Google Search Console**.
3. Sign in to Google and grant the read-only scope.
4. RankMeFast matches the connected property to your site.

## Disconnecting or revoking
Click **Disconnect** in the same panel and confirm. We delete the stored token right away. You can also revoke our access at any time from https://myaccount.google.com/permissions.

## When Google asks you to reconnect
If Google invalidates the token (for example after you change your account password), the Google Search Console card on the site's **Google** tab shows a red alert, **Your Google connection needs to be reconnected**, with a **Reconnect** button. Cards that read Search Console or Google Analytics show **Search Console isn't connected** or **Google Analytics isn't connected**, with **Connect Google**. Until you reconnect, the three rules go back to "insufficient data".

## Choosing the property
The site's **Google** tab matches your site to a Search Console property automatically. If none matches, or several do, RankMeFast asks you to choose one. A property that belongs to a different site can be linked only after you confirm it, because its search data then appears on this site. Google Analytics works the same way. If the newest Google Analytics data is older than expected, a notice says so and **Refresh** syncs it again; RankMeFast also syncs it once a day.

## Search performance in Pages

The [Page performance guide](./pages-performance.en.md) explains how the Pages tab uses saved Search Analytics rows. Its crawl-indexability label comes from the latest RankMeFast crawl. It doesn't tell you whether Google has indexed the URL.

[Back to the docs index](./index.en.md)
