# 01 — Preflight and Firecrawl ZDR attestation

## Preflight checklist (before any live-provider flip)

1. `docker compose config --quiet` passes against the production `.env`.
2. `make build-up` from a clean state; `make ps` shows all six services
   (`mongo`, `postgres`, `redis`, `api`, `worker`, `web`) healthy. Worker
   health (`/healthz` on `WORKER_PORT`, internal only) must report the queue
   registry — audits, ranks, content-analysis, audience-research (+ recon),
   weekly-pulse, billing-retry, prune schedulers — not merely "empty queues".
3. Migrations applied on boot (`runMigrations()` before listen); api exits
   non-zero if Postgres is unreachable — treat a crash-looping api as a
   migration failure first (check `docker compose logs api | grep -i migrat`).
4. All `PROVIDER_*` values are either `fake` or a shipped adapter name. Unknown
   values fail startup loudly — that is by design; do not "fix" it by removing
   the env validation.
5. Secrets live ONLY in the root `.env` (no `${KEY}_FILE`, no `./secrets/*`
   mounts — the empty-secret-file override incident is documented in
   `.claude/rules/environment-variables.md`).

## Firecrawl ZDR (audience research / content source)

- `PROVIDER_CONTENT_SOURCE=firecrawl` requires `FIRECRAWL_API_KEY` and
  `FIRECRAWL_ZDR_ENABLED=true`. Optional `FIRECRAWL_FALLBACK_API_KEYS` is an
  ordered comma-separated list of at most five additional accounts. Env
  validation refuses live selection unless
  the ZDR attestation is `"true"` — the adapter also sends
  `zeroDataRetention: true` per request, but the operator attestation is the
  gate.
- Verify in every configured Firecrawl Cloud account that Zero Data Retention
  is enabled BEFORE setting the attestation. The flag covers the whole pool;
  it is an attestation, not a wish.
- Every call starts with the primary. Only HTTP 401, 402, or 429 advances to
  the next credential. A 403/ZDR error stops immediately. Never weaken ZDR,
  switch provider, or restart an accepted crawl/monitor to make fallback work.
- Accepted crawls and monitors remain owned by the credential that created
  them. Keep that key configured until the resource completes or is deleted.
  Legacy monitors are primary-owned; rotate the primary only after recreating
  or removing those monitors.
- Cross-account monitoring requires one active webhook signing secret per
  configured account across `FIRECRAWL_WEBHOOK_SECRET` and
  `FIRECRAWL_WEBHOOK_SECRETS`. Keep `CONTENT_MONITORING_ENABLED=false` until
  that coverage is complete; startup enforces the unique-secret count.
- API keys disclosed in tickets, chat, logs, or shell history are exposed.
  Revoke/rotate them after validation and replace only the root `.env` value.
- If ZDR is not attestable, audience-research runs that need crawling
  terminate with the `zdr_blocked` coverage-failure reason; the superadmin
  audience-research DTO exposes a `zdrDegraded` flag over the selected window.

## Provider credential smoke

- DataForSEO: check balance via the vendor account page before enabling
  (`ai-mention` checks cost ~$0.95/prompt; SERP live depth is capped by
  `SERP_LIVE_DEPTH` ≤ 30 to stay within the `serp_checks` unit price).
- Google API key (`GOOGLE_API_KEY`) — PSI/CrUX free quotas: 25k/day, 150/min.
- AI providers: only providers with `<NAME>_ENABLED=true` AND a key AND
  operator-configured micro-dollar rates join `AI_PROVIDER_ORDER`. The
  per-account spend circuit (`AI_ACCOUNT_SPEND_LIMIT_MICROS`, default
  1,000,000 micros/hour) is the last line of defense — do not raise it during
  rollout.
