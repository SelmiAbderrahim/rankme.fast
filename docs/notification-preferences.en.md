---
title: 'Notification preferences'
description: 'Choose which non-security emails you want to receive.'
locale: en
slug: notification-preferences
section: account
order: 4
---

# Notification preferences

You choose which non-security emails RankMeFast sends you. Open **Settings → Notifications** (`/settings/notifications`) and flip the switches you want.

The audit, rank, and alert switches default to **on**; **Product updates** defaults to **off** and is sent only after you turn it on. Changing a switch takes effect immediately: the next matching email is skipped (or sent, for a switch you turned on).

## What each toggle controls

- **Audit complete**: sent when an audit run finishes for one of your sites.
- **Rank drops**: sent when a tracked keyword dropped and a second check confirmed it.
- **Alert rules**: sent when one of your own [alert rules](./alerts.en.md) fires. This switch covers the email channel only. Slack and webhook deliveries keep working.
- **Billing**: payment receipts, failed-payment reminders, and dunning notices. Turning this off stops all billing email; you can still see receipts and past invoices in **Billing → Invoices**.
- **Product updates**: occasional welcome messages, product news, and tips.

## Rank drops and alert rules are separate

The **Rank drops** email is built in. RankMeFast sends it when a tracked keyword drops and a second check confirms the drop, and you don't set any threshold. Alert rules are rules you build yourself in **Alerts → Rules** (`/dashboard/alerts?tab=rules`). You pick the threshold and where the alert goes, including Slack or a signed webhook. Neither one replaces the other. Turning off **Rank drops** leaves your alert rules running, and deleting every rule leaves the built-in email on.

## Weekly Pulse is a separate opt-in

The [Weekly Pulse](./weekly-pulse.en.md) digest is not controlled by the switches above. Each teammate turns it on per site from the site's AI Visibility workspace, and it stays off until they do.

If a delivery is retried, you still get each digest only once. If your address cannot receive the email, other subscribed teammates still get theirs.

## Security email cannot be disabled

The following emails are always sent, regardless of the switches above:

- Password reset link.
- Email address verification.
- Password-changed confirmation.

These emails protect your account. If you get one you didn't expect, review your active sessions and reset your password from **Settings → Security**.
