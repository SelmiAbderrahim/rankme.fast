# 07 — Rollback

No new rollback flags were invented for this roadmap. Rollback
uses only mechanisms that already ship. Data migrations are forward-only —
rollback never un-applies SQL or restores rows.

## Switches that exist today

| Surface | Rollback mechanism | Effect |
|---------|--------------------|--------|
| Any live vendor capability | set the matching `PROVIDER_*` back to `fake`, restart api + worker (env parity in BOTH compose blocks) | new runs use deterministic fixtures; stored results stay readable |
| AI runtime | remove provider from `AI_PROVIDER_ORDER` or set `<NAME>_ENABLED=false` | ordered fallback skips it; keyless order → fake |
| MCP endpoint | `MCP_ENABLED=false` | new MCP entry points return the localized product-unavailable response; reads stay available |
| Content Intelligence family | `CONTENT_INTELLIGENCE_ENABLED` / `CONTENT_INVENTORY_ENABLED` / `COMPETITOR_CONTENT_INTELLIGENCE_ENABLED` / `CONTENT_MONITORING_ENABLED` = false | same pattern: new-run entry points blocked, results readable, in-flight jobs finish |
| Audience research | superadmin intelligence kill-switch surface (existing `FEATURE_FLAG_KEYS` mechanism) or `PROVIDER_CONTENT_SOURCE=fake` + `PROVIDER_AI=fake` | new runs blocked or fixture-backed; queued jobs finish to terminal state |
| Weekly pulse | per-user opt-in is already the default-off surface; global stop = do not register the scheduler (worker deploy without the pulse scheduler) — the `upsertJobScheduler` id is stable so re-enabling resumes cleanly | no new digests; stored digests readable |
| Sampled AI visibility | `PROVIDER_AI_VISIBILITY=fake` | cohorts run on fixtures, zero vendor spend |
| Legacy sync compatibility routes | leave registered (they share auth/metering/provider with queued paths); removal is a NEXT-release decision (see 08) | none |

## Rollback procedure

1. Change the env value(s) in the root `.env` only.
2. `docker compose up -d api worker` (web only if `VITE_*` changed — those
   require an image rebuild, see the stale-image gotcha: an old image with a
   new env can crash-loop on env validation).
3. `make ps` healthy ×6; check worker boot log lists the expected queue
   registry.
4. Verify via superadmin intelligence that the surface stopped moving
   (counters flat) and no error-rate spike followed.

## What rollback does NOT do

- It does not delete user-visible history (runs, digests, decisions,
  actions). Product truth stays truthful.
- It does not pause billing state — packs/subscriptions continue; caps keep
  enforcing (a rolled-back surface simply stops consuming its metric).
