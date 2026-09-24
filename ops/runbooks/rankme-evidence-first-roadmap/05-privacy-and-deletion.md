# 05 — Privacy and deletion coverage

## New evidence stores in roadmap scope

| Store | Kind | Contains | Deletion path |
|-------|------|----------|---------------|
| `audited_pages`, `report_snapshots` | Mongo | crawl findings | account purge job (existing) |
| Audience research runs | Mongo | bounded public-page evidence: canonical URL, safe title, ≤500-char output-encoded excerpt, observation meta | account purge job — runs are account-scoped documents |
| `audience_research_events`, `audience_research_signal_decision_events` | Postgres | usage + decision events (ids only, no content) | account purge deletes by `account_id` |
| Weekly pulse tables | Postgres | run rows, citation identities (safe title + canonical URL), delivery events | purge by `account_id`; delivery events keep no message bodies |
| `gsc_search_appearance` snapshots | Postgres | first-party GSC metrics | purge by `account_id` |
| Keyword caches (`keyword_lookups`, cluster runs) | Postgres/Mongo | keywords + aggregate metrics | account purge; cross-user `vendor_cache` rows are provider-normalized and account-free by design |
| AI usage events | Postgres | task/model/duration/cost — never prompts or outputs | retention-pruned (`AI_USAGE_RETENTION_DAYS`, default 90) |

## Rules that hold everywhere

- Raw HTML, full page text, raw SERP payloads, prompts, and AI outputs are
  never persisted. Excerpts are bounded and output-encoded at write time
  (schema validators reject script/iframe/doctype markers).
- Deletion uses the existing data-rights flow (`legal` module):
  `ACCOUNT_DELETION_GRACE_HOURS` grace (default 720h), then the purge queue
  removes account-scoped rows across BOTH stores. New tables added by this
  roadmap are account-keyed precisely so the purge can find them.
- After a deletion completes, future scheduled work must not resurrect the
  account: the weekly-pulse scheduler skips accounts without settings rows;
  audience-research jobs re-check run ownership on load and dead-letter on
  missing accounts.
- Logs: pino redaction covers credentials/cookies/tokens; evidence excerpts
  and full URLs are not logged (adapter/pipeline logs carry ids + counts
  only). Superadmin DTOs are counts/costs/durations — the
  `scanForForbidden` test fixture proves no planted secret or excerpt string
  survives into a DTO.

## Verification

- Run the legal-module export for a staging account with roadmap data:
  the export must include audience-research runs and decisions; the purge
  must remove them (both are covered by module tests — re-run scoped suites
  if in doubt, do not hand-verify in prod).
