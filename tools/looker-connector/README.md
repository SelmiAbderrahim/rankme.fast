# RankMeFast Looker Studio connector

This directory is a source artifact for a Looker Studio Community Connector.
It is intentionally outside both repository Vitest include patterns and is
never built, executed, deployed, or published by CI.

The connector reads data already stored by your own RankMeFast instance. It
does not start audits, enqueue checks, call a vendor, or create a new usage
metric. The normal per-IP and per-API-key `/api/v1` rate limits still apply.

## Prerequisites

- an Agency account;
- `PUBLIC_EXPORTS_ENABLED=true` on your RankMeFast instance;
- an HTTPS instance origin, such as `https://seo.example.org`;
- a freshly created RankMeFast API key. The key is shown once, so copy it at
  creation time.

The script contains no RankMeFast instance origin and no credential. Google
asks for the API key through its supported `KEY` authentication screen and
stores it in per-user `PropertiesService` storage. The ordinary connector
configuration collects only the instance URL, dataset, site ID, and optional
rank engine.

## Install in Apps Script

1. Create a standalone project at Google Apps Script.
2. Replace the default script with [`Code.gs`](./Code.gs).
3. Show the project manifest and replace it with
   [`appsscript.json`](./appsscript.json).
4. In **Deploy → Test deployments**, create a Community Connector test
   deployment.
5. Open the deployment in Looker Studio. Enter the API key in Google's key
   authentication prompt.
6. Enter your HTTPS instance origin. Do not include `/api/v1` or another path.
7. Choose one dataset. Rank history, SERP features, and backlink rows also
   require the 24-character site ID. The engine selector applies only to rank
   history.

Rank history requests 10 keyword groups per page (each group can contain up to
730 history points). Keywords and the two stored-row datasets request 1,000
rows per page. All four follow `X-Next-Cursor` up to a connector ceiling of
10,000 rows, and the connector rejects a repeated cursor instead of looping.
When Looker supplies a date range, rank history forwards inclusive `from` and
`to` bounds on every page. Create separate data sources when you need different
sites or datasets.

## Dataset routes and fields

The connector requests `?format=csv`, so its schema is the same stable export
contract used by direct API consumers.

| Dataset | Route | Fields |
|---|---|---|
| Sites | `GET /api/v1/sites` | `id`, `domain`, `url`, `paused`, `created_at` |
| Rank history | `GET /api/v1/sites/:siteId/rank-history` | `keyword_id`, `phrase`, `engine`, `checked_at`, `position`, `rank_absolute`, `source`, `found_url`, `ai_overview_present`, `ai_cited`, `ai_cited_url` |
| Keywords | `GET /api/v1/keywords` | `id`, `site_id`, `phrase`, `location_code`, `language_code`, `device`, `active`, `created_at`, `updated_at`, `latest_position`, `previous_position`, `delta`, `last_checked_at`, `ai_overview_present`, `ai_cited`, `ai_cited_url`, `track_local_pack`, `last_failed_check_at`, `engine`, `engine_target` |
| SERP features | `GET /api/v1/serp-features?siteId=…` | `id`, `site_id`, `keyword_id`, `engine`, `checked_at`, `source`, `features_json`, `top_results_json`, `created_at`, `source_kind` |
| Backlink rows | `GET /api/v1/backlink-rows?siteId=…` | `id`, `review_id`, `site_id`, `url`, `domain`, `spam_score`, `rubric_band`, `rubric_version`, `first_seen`, `last_seen`, `dofollow`, `is_broken`, `rationale`, `rationale_status`, `captured_at`, `source_kind` |

`source_kind=provider_observation` explicitly labels stored SERP and backlink
rows. It is not an estimate. Formula-like text remains prefixed by the API's
CSV neutralizer and is never converted back into an active spreadsheet
formula by the connector.

## Security and publication

- Use HTTPS: the bearer key travels to the instance URL you enter.
- Never place a key in `Code.gs`, the manifest, connector configuration, logs,
  screenshots, or a committed fixture.
- Revoke a key from RankMeFast immediately if it is exposed.
- The manifest has no `urlFetchWhitelist` because the instance origin is
  user-configured. An operator publishing a connector for one fixed instance
  can add an instance-specific whitelist in their own Apps Script project.
- Gallery publication is outside this artifact's scope. Before publishing,
  replace the repository metadata with the publisher's maintained 40×40
  logo, support page, connector page, privacy policy, and terms, then complete
  Google's review requirements.

## Google documentation authority

Retrieved 2026-08-04:

- [Build a Community Connector](https://developers.google.com/looker-studio/connector/build)
  — required functions and project setup; page last updated 2026-04-30.
- [Authentication](https://developers.google.com/looker-studio/connector/auth)
  — supported `KEY` flow and the warning not to collect credentials through
  `getConfig`.
- [Community Connector API reference](https://developers.google.com/looker-studio/connector/reference)
  — `getConfig`, `getSchema`, and `getData` request/response contracts.
- [Manifest reference](https://developers.google.com/looker-studio/connector/manifest)
  — public metadata and manifest properties; page last updated 2026-05-13.
