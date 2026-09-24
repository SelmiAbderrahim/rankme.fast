---
title: 'Download and share reports'
description: 'Choose the right format, keep filters, and manage private share links.'
locale: en
slug: report-exports
section: product
order: 12
---

# Download and share reports

An export is a frozen copy of the report you're looking at. The downloaded file, and any public share made from that copy (the snapshot), keeps the same filters, source dates, labels, locale, and branding. Creating an export doesn't run a new check or spend credits.

## Download a report

1. Open a completed report or a saved result.
2. Set the date range, rows, engine, device, location, section, or other filters you need.
3. Select **Download or share**, then choose one of the formats offered for that report.
4. If you need the file again, open **Exports** and select the **Downloads** tab.

The menu only lists formats that fit that report. If your selection is too large to export in full, RankMeFast stops and tells you, rather than quietly dropping rows. Narrow the filters, or switch to CSV or JSON if the message suggests it.

## Formats by report type

This is the full list of report types you can export. The names in backticks also appear in JSON files and API responses.

| Formats | Report kinds |
|---|---|
| PDF, CSV, JSON | `audit.run`; `ranks.current`; `ranks.history`; `ranks.serp_features`; `google.gsc_search`; `google.gsc_sitemaps`; `google.gsc_generative_appearance`; `google.ga4`; `keyword.research_result`; `keyword.trends_run`; `keyword.ai_cluster_run`; `keyword.serp_cluster_run`; `keyword.cannibalization`; `backlinks.deep_run`; `backlinks.gap_run`; `backlinks.toxicity_run`; `competitors.organic`; `competitors.tech_stack`; `competitors.traffic_snapshot`; `competitors.traffic_comparison`; `competitors.content_run`; `competitors.landscape_run`; `actions.plan`; `ai.visibility`; `audience.research_run`; `brand.radar_scan`; `content.inventory_run`; `internal_links.run`; `local.seo_snapshot`; `local.reviews`; `local.geogrid_scan`; `pages.performance`; `app.keyword_tracking`; `app.research_result` |
| PDF, JSON | `client.composite`; `backlinks.summary`; `content.recommendation_outcome`; `weekly_pulse.run` |
| PDF, JSON, Markdown | `content.analysis`; `content.brief` |
| CSV, JSON | `backlinks.inventory`; `content.monitor_feed` |
| JSON, JSON-LD | `schema.generation` |
| Plain text | `backlinks.disavow` |

Use PDF for reading and presenting. CSV appears only when the report really is a table. JSON holds the complete, versioned report for use in other software. Markdown, JSON-LD, and disavow text are offered only for the reports that naturally produce them.

## Filters, ranges, and source dates

The snapshot records what you had selected. A rank-history export, for example, keeps the chosen keyword IDs and date range, and a review export keeps its source, rating, query, and dates. Every format includes the date or date range the data was collected, and labels what was measured, what was calculated, what is an estimate, and what was generated. Changing the screen afterwards doesn't change a snapshot you already made.

## Branding and white label

PDF files and public views use RankMeFast branding by default. An account that already has white-label PDF access may select its saved company name, accent, and supported logo. CSV, JSON, Markdown, JSON-LD, and text files carry no visual branding, but their metadata still records which branding the snapshot used. Exporting doesn't add white-label access to a plan.

## Share links

If sharing is allowed for the report, choose **Share** after creating a snapshot. Pick the allowed public formats and an expiry from one to 90 days; the default is 30 days, and a link can never outlive its snapshot. Copy the link when it appears, because RankMeFast can't show it to you again later.

Anyone who has the link can open it without signing in. Shared pages are marked noindex and no-store, but that doesn't stop a recipient from passing the link on, so choose who gets it carefully. Use **Exports → Shares** to revoke a link immediately. Expired, revoked, deleted-source, and deleted-account links return the same not-found response.

## Privacy and external use

Exports may contain site URLs, search queries, excerpts, rankings, review text, first-party analytics, and client branding. Download or share only with people authorized to see the source report. RankMeFast stores a content hash and the snapshot itself. It doesn't store provider credentials, cookies, raw share tokens, or billing data. Snapshots expire after 90 days. If the source site or account is deleted, they stop opening right away and are purged later under the normal retention schedule.

CSV files are UTF-8 with spreadsheet-friendly headers. Cells beginning with a formula marker (`=`, `+`, `-`, `@`, tab, or carriage return, including after leading spaces) are prefixed as text before CSV quoting. Keep that prefix if you edit the file in Excel or Sheets.

JSON currently uses report document `schemaVersion: 1` plus a report-specific `kindVersion`. Read both fields and reject versions your integration does not understand. Don't rely on internal database IDs or on the file name.

Disavow files, Markdown, and JSON-LD need a final check by a person. RankMeFast doesn't submit a disavow file to Google, publish Markdown, or deploy JSON-LD for you. Review the rows, statements, URLs, and required properties before you use one outside RankMeFast.

[Back to the docs index](./index.en.md)
