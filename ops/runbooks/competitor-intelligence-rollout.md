# Competitor Intelligence rollout and rollback

This runbook covers the Pro and Agency Competitor Intelligence workspace. It contains operator data only. Do not paste customer domains, URLs, keywords, report rows, excerpts, prompts, provider payloads, credentials, or request headers into rollout records.

## Controls

The root `.env` is the only environment file. Apply a flag change by recreating this project's `api`, `worker`, and `web` services. Do not stop unrelated containers.

| Control | New work when false | Data that remains available |
|---|---|---|
| `COMPETITOR_INTELLIGENCE_ENABLED` | Landscape preview reports disabled and landscape start refuses | Portfolio and stored landscape history remain readable; accepted queue work drains or reconciles |
| `COMPETITOR_CONTENT_INTELLIGENCE_ENABLED` | New Agency page-content comparisons refuse | Historical content runs remain readable |
| `CONTENT_MONITORING_ENABLED` | New monitoring work refuses | Existing monitor state and history remain available according to the monitoring lifecycle |
| `PUBLIC_EXPORTS_ENABLED` | New report-export snapshots refuse | Existing source reports remain readable; disabling exports does not delete snapshots |

Changing a flag does not reverse usage, remove reports, or unapply a migration. Do not change provider selection to `fake` as an incident fallback in production.

## Staged enablement

1. Build the project images and start this Compose project.
2. Confirm the worker `/health` payload includes `competitorLandscapes.waiting`, `active`, `failed`, and `oldestPendingAt`.
3. Open Superadmin Intelligence. Check the Competitor report queue cards, the `competitorIntelligence` and `publicExports` switch states, provider cost totals, and the `competitor_manage` and `report_exports_*` rate-limit rows.
4. Enable `COMPETITOR_INTELLIGENCE_ENABLED` for Pro landscape work. Keep Agency content and monitoring controls independent.
5. Review structured events by count and state. Never add report content to a log query.

## Structured evidence

The following records are safe for operational aggregation:

- `competitor_landscape_preview`: enabled state, capacity enforcement, affordable decision, unit count, competitor count, and maximum rows.
- `competitor_landscape_enqueued`: run ID, duplicate decision, state, and reserved unit count.
- `competitor_landscape_provider_cost`: run ID, profile ID, provider ID, outcome, leg count, retained row count, safe failure code, and cost in micros.
- `competitor_landscape_settled`: terminal state, requested and usable competitor counts, succeeded, failed, and truncated legs, partial competitor count, and row count.
- `report_export.refused` audit events: report kind, format, and a low-cardinality refused status. They contain no report rows.
- `rate_limit_hits`: bounded route buckets and timestamps. Use `competitor_manage` for workspace pressure and `report_exports_create`, `report_exports_manage`, and `report_exports_download` for export pressure.

Provider cost archives and report-export refusal audits are the durable sources. Logs support short-window diagnosis. Neither source should contain a customer URL, keyword, copied prose, raw HTML, prompt, secret, or vendor payload.

## Hold and rollback conditions

Pause new landscape work when queue age grows across two observation windows, failed legs increase without usable partial reports, cost totals exceed the pinned 90,000 micros per selected competitor, cap refusals rise unexpectedly, or unsafe output reaches a stored report. Pause exports separately when integrity or formula-neutralization checks fail.

Set the narrowest affected flag to `false`, recreate this project's services, and verify the resolved state in Superadmin Intelligence. Accepted landscape jobs continue to a terminal state so a flag change does not strand a reservation. Stored reports stay readable.

## Reconciliation

The worker scheduler performs two bounded operations:

- It restores a missing BullMQ job only for a durable landscape run still in `queued`, `collecting`, or `aggregating` state.
- It replays only a missing whole-reservation refund for an enqueue failure, a zero-usable provider failure, or cancellation before the first provider dispatch.

Both sweeps are idempotent and scan at most 100 records per normal pass. Do not manually re-dispatch a provider leg. A durable dispatch marker may represent a request whose response was lost, and sending it again could exceed the three-leg cost proof. If a run remains stuck after two scheduler windows, record its run ID and safe state, leave the source data untouched, and inspect queue and checkpoint counts without copying their content.

## Post-rollback checks

Confirm that new starts refuse with a localized unavailable state, stored landscape and historical content reports still open, no new provider-cost event appears for a refused request, queue age decreases, eligible refunds settle once, and export refusals record the expected kind, format, and refused status. Re-enable one control at a time after the fault is understood.
