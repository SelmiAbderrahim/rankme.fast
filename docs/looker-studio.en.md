---
title: 'Connect Looker Studio'
description: 'Copy the read-only RankMeFast connector into Apps Script and map stored SEO data into Looker Studio. Agency feature.'
locale: en
slug: looker-studio
section: developers
order: 4
---

# Connect Looker Studio

The community-connector source lets an **Agency** account read data already stored by its own RankMeFast instance. It only reads, so it doesn't start checks, call vendors, or count against any usage metric. The usual per-IP and per-key API limits still apply. See the [Public API](./public-api.en.md) for the underlying HTTP contract.

## Before you begin

Ask your operator to enable `PUBLIC_EXPORTS_ENABLED`. Create an API key under **Account → API keys** and copy it when it is shown; RankMeFast stores only its SHA-256 digest afterwards. You also need the HTTPS origin of your instance, without `/api/v1`.

## Install and connect

1. Create a Google Apps Script project.
2. Copy `tools/looker-connector/Code.gs` into the script editor and copy `appsscript.json` into the manifest editor.
3. Create a Community Connector test deployment and open it in Looker Studio.
4. Enter the API key in Google's separate **Key** authentication prompt. Never paste it into connector configuration or source code.
5. Enter your instance URL, choose a dataset, and enter a 24-character site ID for rank history, SERP features, or backlink rows. The optional engine filter accepts All, Google, Bing, YouTube, or Amazon.

You enter the instance URL during setup; the connector code has no RankMeFast address built in. Rank history uses `X-Next-Cursor` pages of 10 keyword groups; keywords, SERP features, and backlink rows use pages of 1,000 rows. Every dataset stops at 10,000 rows per Looker refresh, and a repeated cursor raises an error so it can't loop. When Looker supplies a date range, its inclusive dates are forwarded on every rank-history page.

## Field mappings

| Dataset | API route | Looker field IDs |
|---|---|---|
| Sites | `/api/v1/sites` | `id`, `domain`, `url`, `paused`, `created_at` |
| Rank history | `/api/v1/sites/:siteId/rank-history` | `keyword_id`, `phrase`, `engine`, `checked_at`, `position`, `rank_absolute`, `source`, `found_url`, `ai_overview_present`, `ai_cited`, `ai_cited_url` |
| Keywords | `/api/v1/keywords` | `id`, `site_id`, `phrase`, `location_code`, `language_code`, `device`, `active`, `created_at`, `updated_at`, `latest_position`, `previous_position`, `delta`, `last_checked_at`, `ai_overview_present`, `ai_cited`, `ai_cited_url`, `track_local_pack`, `last_failed_check_at`, `engine`, `engine_target` |
| SERP features | `/api/v1/serp-features?siteId=…` | `id`, `site_id`, `keyword_id`, `engine`, `checked_at`, `source`, `features_json`, `top_results_json`, `created_at`, `source_kind` |
| Backlink rows | `/api/v1/backlink-rows?siteId=…` | `id`, `review_id`, `site_id`, `url`, `domain`, `spam_score`, `rubric_band`, `rubric_version`, `first_seen`, `last_seen`, `dofollow`, `is_broken`, `rationale`, `rationale_status`, `captured_at`, `source_kind` |

`source_kind=provider_observation` means the SERP or backlink row is a stored provider observation, not an estimate. `features_json` and `top_results_json` remain JSON text. Formula-like text stays neutralized as text.

## Troubleshooting and security

A `401` means the key is missing, revoked, or incorrect; `402` means the account is not Agency; `404` means the site is not on that account; `429` means the API rate limit is reached; and `503` means public exports are disabled. Use HTTPS, revoke exposed keys immediately, and create separate Looker data sources for different sites or datasets.

The artifact follows Google's Community Connector [build guide](https://developers.google.com/looker-studio/connector/build), [authentication guide](https://developers.google.com/looker-studio/connector/auth), [API reference](https://developers.google.com/looker-studio/connector/reference), and [manifest reference](https://developers.google.com/looker-studio/connector/manifest), retrieved 2026-08-04. Gallery publication and deployment automation are not included.

[Back to the docs index](./index.en.md)
