---
title: 'Weekly Pulse'
description: 'One weekly digest per site, built from signals you have already paid for.'
locale: en
slug: weekly-pulse
section: audits
order: 7
---

# Weekly Pulse

Weekly Pulse is an opt-in email digest that summarizes what changed for your site over the last ISO week. It is off by default. Each verified team member turns it on for themselves. Nobody can turn it on for you.

## What one pulse costs

Sending a digest for a site uses **one `ai_mentions_checks` unit** for that site, however many teammates are subscribed. Reading history, re-opening a past digest, or exporting stored data costs nothing and calls no provider.

## What it contains

The digest is built only from signals already stored:

- New and lost citations across the AI engines your plan covers.
- Confirmed rank drops from your tracked keywords.
- Actions completed or regressed since the prior compatible pulse.
- Your next three open actions.
- Google Search Console generative-AI appearance, when Google returned rows.

The pulse doesn't ask AI engines for new answers or run new SERP requests.

## When it runs

Each site has a fixed weekly slot, based on the site ID and spread across Monday–Saturday, 09:00–14:00 UTC. Sunday is reserved. You can see the next slot on the AI Visibility workspace.

## States you may see

- **Completed**: every supported engine returned data and the digest is ready.
- **Partial**: some engines returned partial data. The digest still goes out with what arrived.
- **Unsupported**: none of your plan's engines support this site's market and cohort; no unit is consumed.
- **Blocked**: your `ai_mentions_checks` allowance is exhausted for the month; no provider call is made.
- **Failed**: every supported engine failed for this run. The unit is used and not refunded.

## Turning it on or off

Open the site's AI Visibility workspace, review the spend preview, then toggle **Weekly Pulse**. Turning it off stops future emails right away. Re-enabling picks up the next weekly slot.

## Privacy

Emails contain short summaries only: host, count, keyword text, rank number, action verb, appearance name. Raw AI answers, source excerpts, competitor prose, prompts, and vendor task IDs never appear in the digest.

[Back to the docs index](./index.en.md)
