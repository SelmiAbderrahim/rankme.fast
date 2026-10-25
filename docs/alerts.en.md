---
title: 'Alerts'
description: 'Which alerts fire, how exactly-once delivery works, and when a rank-drop rule delivers.'
locale: en
slug: alerts
section: product
order: 6
---

# Alerts

You set up alert rules per site. They can deliver by email, by Slack incoming webhook, or by a generic webhook signed with HMAC. Deliveries aren't metered.

<!-- docs-truth: metric=none; unit=none-deliveries-not-metered; cache-hits=not-applicable; refund=not-applicable; cadence=on-observed-transition; estimates=provider-observation -->

## What fires today

New and lost referring-domain alerts. They fire after two link reviews in a row have completed, and each alert carries the before-and-after evidence that triggered it.

Rank-drop rules fire only after a drop is confirmed: a scheduled rank check finds the drop, and a fresh second check of the same keyword in the same market still shows it. If the keyword recovers, or the second check can't run, the rule stays silent. See [Confirmed rank alerts](./confirmed-rank-alerts.en.md).

## One alert per change

Each observed change is delivered exactly once, as one alert rather than one per domain. If a review adds 300 links, you get a single alert with a sample of up to 50 domains and the full count.

Your first link review has nothing to compare against, so it never triggers an alert. The delivery log records each attempt as sent, failed, or suppressed.

When a transport fails, the delivery is logged as failed instead of being retried forever. The same change is never sent as a second alert.

## Channels

Email, Slack and the generic webhook are all available.

For Slack you paste an incoming-webhook URL. There's no RankMeFast Slack app or bot.

Generic webhooks are signed, so your receiver can check that a payload really came from RankMeFast.

## What an alert means

An alert tells you something changed between two stored snapshots. It doesn't judge link quality or predict an effect on rankings.

For units and plan limits, see [Pricing](./pricing.en.md).

[Back to the docs index](./index.en.md)
