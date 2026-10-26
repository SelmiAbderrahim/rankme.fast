---
title: 'Client reports and portal'
description: 'How white-label PDF reports are composed from stored snapshots, how schedules deliver, and what a revocable portal link is and is not.'
locale: en
slug: client-reports
section: product
order: 11
---

# Client reports and portal

Client reports turn stored audit, rank, and Search Console snapshots into a branded PDF. You can email it on a schedule or share it through a read-only link.

<!-- docs-truth: metric=none; unit=none-composed-from-stored-snapshots; cache-hits=not-applicable; refund=not-applicable; cadence=weekly-or-monthly; estimates=first-party-snapshots -->

## What's in a report

Each report brings together the latest audit findings with rank and Search Console sections, under your account's company name, accent color, and logo.

You set the company name, accent color and logo on the **Workspace** page under Settings (`/settings/workspace`), and only the workspace owner can change them. Upload the logo as a PNG, JPEG or SVG file of up to 256 KB. It is stored as a PNG, and an SVG that contains scripts or links to other files is refused.

Nothing is fetched when a report goes out; it's built from stored snapshots. That's why every figure is printed next to the date it was observed.

A section with no stored snapshot is marked as not yet observed. It's never filled with an estimate.

## Schedules

Reports go out by email, weekly or monthly. The delivery log has an entry per recipient: pending, sent, failed, or suppressed. You pick the time zone and the hour in that zone, and the schedule keeps that local time when clocks change for daylight saving.

Building and sending a report doesn't call any vendor or use a metered unit. The cost is our own infrastructure, so structural limits cap it instead.

## Portal links

A portal link is a read-only URL that expires and can be revoked.

There's no login, no commenting, and no client seats. Anyone with the link sees the report as published.

Revoking takes effect on the next request, so anyone who hasn't already loaded the page is locked out straight away.

## Limits

Content briefs aren't included in v1 reports. A report only contains what was already collected: a section appears once the snapshots behind it exist.

[Back to the docs index](./index.en.md)
