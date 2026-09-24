---
title: 'Alerts'
description: 'Which alerts fire today, how exactly-once delivery works, and why a rank-drop rule can be configured before it can deliver.'
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

You can also configure and save rank-drop rules, but they deliver from confirmed rank-drop observations that the shipped rank pipeline does not yet produce. Backlink change alerts are the channel that fires today.

## One alert per change

Each observed change is delivered exactly once, as one alert rather than one per domain. If a review adds 300 links, you get a single alert with a sample of up to 50 domains and the full count.

Your first link review has nothing to compare against, so it never triggers an alert. The delivery log records each attempt as sent, failed, or suppressed.

When a transport fails, the delivery is logged as failed instead of being retried forever. The same change is never sent as a second alert.

## Channels and rule limits

Email works on every paid tier; Slack and the generic webhook need Pro or above. You can have up to 2 alert rules on Starter, 10 on Pro, and 50 on Agency.

For Slack you paste an incoming-webhook URL. There's no RankMeFast Slack app or bot.

Generic webhooks are signed, so your receiver can check that a payload really came from RankMeFast.

## What an alert means

An alert tells you something changed between two stored snapshots. It doesn't judge link quality or predict an effect on rankings.

For units and plan limits, see [Pricing](./pricing.en.md).

[Back to the docs index](./index.en.md)
