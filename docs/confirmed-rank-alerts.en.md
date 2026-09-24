---
title: 'Confirmed rank alerts'
description: 'How a rank change gets confirmed, and what the observation labels mean.'
locale: en
slug: confirmed-rank-alerts
section: audits
order: 8
---

# Confirmed rank alerts

A drop only turns into an alert after we've seen it twice. That keeps one-off wobbles out of your inbox.

## How a change gets confirmed

1. A scheduled rank check finds that one of your top keywords fell by several positions.
2. We check that keyword again, in the same market, with a fresh request. We never reuse a cached result for this.
3. If the second check still shows the drop, it's a **confirmed rank change**, and only then do we alert you.

## Volatile and unconfirmed changes

- **Volatile**: the second check shows the keyword has recovered. We keep the record in the history and don't send anything.
- **Unconfirmed**: we couldn't run the second check, because your monthly allowance ran out or the provider failed. It stays for information only and never triggers an alert.

All three outcomes stay visible next to the keyword's rank history.

## Observation labels

Each entry shows what we saw and when:

- **Market**: the country, language and device used for the check.
- **Window**: when the first and second checks ran.
- **Freshness of the observation**: how current the data is. Stale data is labeled as stale and never shown as real-time.
- **Source**: which provider service the data came from.

## Where alerts go

A confirmed rank change appears in [Next Actions](./next-actions.en.md) with a link to the keyword's drop record. You can dismiss or reopen it there, and every decision is kept in the history.

## Reading is free

Opening the alert list, a drop record or the history only reads saved data. It never sends a new SERP request or uses a unit from your plan.

[Back to the docs index](./index.en.md)
