---
title: 'Public API'
description: 'Read your sites, reports, rankings, and keywords over a simple key-authenticated API. Agency feature.'
locale: en
slug: public-api
section: developers
order: 1
---

# Public API

The public API gives you read-only access to the data RankMeFast already holds for your account: sites, the latest audit report, rank history, and tracked keywords. It's an **Agency** feature (see [Plans, limits & credits](./plans-limits-credits.en.md)). It never starts new vendor work; it only reads what your audits and rank checks have already produced.

Content Intelligence isn't part of `/api/v1`: starting an analysis or changing a recommendation only works in the signed-in app. MCP can read stored analyses, but it can't start one or change a recommendation.

## Authentication

Create a key under **Account → API keys** (`/profile?tab=api-keys`). The full key is shown **exactly once**, so copy it right away. Afterwards, only its prefix is visible. You can hold up to ten active keys and revoke any of them at any time. A revoked key stops working immediately.

Send the key as a bearer token on every request:

```
Authorization: Bearer rmf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Replace `https://your-rankme-host` in the examples below with your api origin (the `SERVER_URL` of your install).

## Response language and data contract

Pick the response language with `x-lang`, then `Accept-Language`; the API falls back to `en`. Regional values such as `fr-CA` resolve to `fr`. `/api/v1` ignores browser cookies, account language, and workspace preferences. Every response states the language used in `Content-Language` and adds `x-lang, Accept-Language` to `Vary`, keeping any existing values.

Only text written by RankMeFast (report, finding, and action copy, plus safe error messages) is translated. JSON property names, HTTP statuses, stable error codes, enum and status values, IDs, domains, URLs, keywords, timestamps, measurements, observations, cursors, and stored user or provider text stay the same. Language never changes sorting or number and date formats.

CSV output is byte-for-byte identical in every language: the UTF-8 BOM, header names and order, row order, RFC-4180 escaping, values, line endings, filename, pagination headers, and cursor behavior. `Content-Language` reports the selected language but doesn't translate or rename anything in the CSV.

## Endpoints

### List your sites

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites
```

Returns `{ "sites": [{ "id", "domain", "url", "createdAt" }] }`.

### Latest audit report for a site

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites/<siteId>/report/latest
```

Returns the most recent **succeeded** audit as `{ "runId", "report" }`, with the same findings, buckets, and localized copy the dashboard shows. Responds `404` when the site has no finished audit yet.

### Rank history for a site

```bash
curl -H "Authorization: Bearer rmf_..." \
  "https://your-rankme-host/api/v1/sites/<siteId>/rank-history?from=2026-06-01&to=2026-07-01"
```

Returns `{ "keywords": [{ "id", "phrase", "series": [...] }] }`. Each series point carries the position, the URL that ranked, and the Google AI Overview signals (`aiOverviewPresent`, `aiCited`, `aiCitedUrl`). `from` and `to` are optional ISO dates.

### All tracked keywords

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/keywords
```

Returns every tracked keyword across your sites with its latest position, delta, and AI Overview fields.

## CSV exports and stored rows

When `PUBLIC_EXPORTS_ENABLED` is on, request CSV from any list route with `?format=csv` or `Accept: text/csv`. CSV files use stable columns, a UTF-8 BOM, RFC-4180 quoting, and formula-safe text. JSON on the four original routes is unchanged. Rank history accepts `engine=google|bing|youtube|amazon`; without it, CSV includes every engine in the `engine` column.

Rank-history and keyword CSV keep their legacy unpaged output unless you add `limit` or an opaque `cursor`. Explicit rank-history pages accept 1 to 25 keyword groups (each group is capped at 730 points); keyword pages accept 1 to 1,000 rows. Send the returned `X-Next-Cursor` value on the next request and stop when that header is absent. JSON ignores these CSV paging parameters and keeps its original response contract.

Two additional stored-data reads are available: `GET /api/v1/serp-features?siteId=<siteId>` and `GET /api/v1/backlink-rows?siteId=<siteId>`. Both accept `limit` from 1 to 1,000 and an opaque `cursor`, return only rows owned by the key account, and label observations with `sourceKind=provider_observation` (`source_kind` in CSV). When the flag is off, these routes and CSV return `503`, while the original JSON routes remain live. Follow the [Looker Studio guide](./looker-studio.en.md) for the connector and complete field mapping.

## Compatibility

This release exposes exactly six read-only routes:

- `GET /api/v1/sites`
- `GET /api/v1/sites/:siteId/report/latest`
- `GET /api/v1/sites/:siteId/rank-history`
- `GET /api/v1/keywords`
- `GET /api/v1/serp-features`
- `GET /api/v1/backlink-rows`

Brand Radar, Review Intelligence, Link Intelligence, Traffic Insights, and Keyword Trends have no `/api/v1` routes. They are dashboard features that need a signed-in account. Existing response fields keep their meaning, and clients should ignore new fields they don't recognize.

<!-- public-api-routes: GET /api/v1/sites; GET /api/v1/sites/:siteId/report/latest; GET /api/v1/sites/:siteId/rank-history; GET /api/v1/keywords; GET /api/v1/serp-features; GET /api/v1/backlink-rows -->

## Rate limits

By default each key may make **120 requests per minute**. Above that the API answers `429` until the window resets.

## Errors

Errors use the shape `{ "error": { "message": "...", "details": ... } }`. The human-readable message follows `x-lang`, then `Accept-Language`, then `en`; statuses, fields, stable codes, and details don't change with language:

- `401`: the key is missing, malformed, revoked, or unknown.
- `402`: your plan does not include the API.
- `404`: the site or report does not exist on your account.
- `429`: rate limit exceeded (body: `{ "error": "..." }`).

[Back to the docs index](./index.en.md)
