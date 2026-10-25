---
title: 'Local grid tracking'
description: 'How per-coordinate local-pack grids are collected, how to choose the center of the grid, and what a failed cell means.'
locale: en
slug: geogrid
section: product
order: 9
---

# Local grid tracking

A grid scan checks the local pack from many points around a location in one go. You see how visibility shifts across a neighborhood instead of from a single spot.

<!-- docs-truth: metric=geogrid_scans; unit=one-grid-scan-up-to-49-cells; cache-hits=count; refund=all-cell-failure-only; cadence=on-demand; estimates=provider-observation -->

## Running a scan

Pick a grid size (3×3, 5×5, or 7×7), a spacing, and a zoom level. RankMeFast runs one Maps check per cell, and the whole grid counts as one metered scan.

For every cell it stores the position it saw, how big the local pack was, and when the check ran. Results appear as a heat grid, always with an accessible table beside it.

## Reading a cell

Each cell shows one of three things:

- an observed position
- "not in the local pack"
- a failed check, which stores no position and is never drawn as a rank

Every cell has its own capture time. A grid is a set of checks taken close together, not one instant snapshot of the whole area.

## Units and refunds

A scan with at least one usable cell uses its unit. You're refunded only if every cell fails, since a partial grid still has usable observations.

## Choosing the center

The **Grid center** picker starts from **My business**, the location saved with the site's business in [Local SEO](./local-seo.en.md). Using it costs nothing, and without a saved business the picker links to Local SEO setup. **Search for a place** looks up a business name or street address. Each search asks your local listings provider once, and picking a result only fills in the center: it leaves your Local SEO business unchanged. **Enter coordinates** is the advanced option, with the last scan's center one click away (**Use last scan's center**). Spacing offers preset distances or a custom distance in kilometers.

## Limits

There's no interactive map to click on, because RankMeFast doesn't use a map-tile vendor.

A grid shows what the provider saw from those coordinates at that time. It isn't a prediction, and it doesn't tell you what any particular searcher will see.

[Back to the docs index](./index.en.md)
