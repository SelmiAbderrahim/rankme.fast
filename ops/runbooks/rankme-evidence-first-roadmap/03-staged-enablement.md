# 03 — Staged enablement

Enable surfaces in dependency order. Everything ships dark-launched behind
`PROVIDER_*=fake` — the stack is fully functional on deterministic fixtures
with zero vendor spend.

## Stage order

1. **Core (already live):** audits, ranks, keyword research on the existing
   providers. No action.
2. **Observations + spend previews:** no provider flip —
   metadata only. Verify `/api/health` and the superadmin overview render.
3. **Confirmed rank alerts (04):** uses existing rank provider. Verify a
   confirmed drop appears after two consecutive observation windows; volatile
   and unconfirmed stay out of Next Actions.
4. **Next Actions (05/06):** read-only aggregation — no provider, no spend.
   The five source adapters read stored data only. Verify `?tab=actions`
   renders and reads never move usage counters.
5. **AI visibility + citations (07–09):** flip `PROVIDER_AI_VISIBILITY` only
   after DataForSEO balance check (01). Sampled cohorts spend
   `ai_mentions_checks` units.
6. **Audience research (10/11):** requires content-source (Firecrawl + ZDR,
   see 01) and AI runtime. Worker consumes `audience-research` plus the
   reconciliation sweep queue — both must appear in the worker boot log line
   and the worker health queue registry BEFORE accepting runs.
7. **Weekly pulse (12):** per-user opt-in; the scheduler enqueues due pulses.
   Global enablement = scheduler registration in worker boot; per-user state
   stays in `site_pulse_settings`/subscriptions.
8. **Keyword intelligence (13/14):** gap/overview/trends reuse the keyword
   provider; clustering uses the AI runtime (1 `ai_summaries` unit per fresh
   run, identical rerun free).
9. **Docs (15):** content-only; deploy with the same release as the features
   they describe.

## Per-stage verification

After each flip:

- `docker compose logs -f api worker` — no `error`/`unhandled`/redacted-secret
  lines.
- Superadmin intelligence: overview + providers + costs + queues DTOs show
  the new surface's counters moving.
- One end-to-end user journey on a staging account with the fake providers
  still enabled for every OTHER capability (single-variable flips).
