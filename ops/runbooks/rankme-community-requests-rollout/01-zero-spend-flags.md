# Step 1 — zero-spend flags

`SERP_FEATURE_TRACKING_ENABLED` → `KEYWORD_CLUSTERING_ENABLED` →
`CANNIBALIZATION_ENABLED` → `PUBLIC_EXPORTS_ENABLED`

None of these four flags can increase vendor spend. They surface data the
product already stores, or a byproduct of a check the customer already paid
for. Flip them first and observe: they establish that the release is healthy
before any budget is at risk.

## Step control

- **Preconditions.** All four flags are false, the common README health checks
  pass, and the canary account has the stored rank and Search Console evidence
  named below.
- **Superadmin panel.** **Queues** is the canonical panel for this step.
- **Regression metric.** Dead-letter job count. It must not rise above the
  recorded pre-flip baseline during any of the four canaries.

## `SERP_FEATURE_TRACKING_ENABLED`

- **Preconditions.** At least one site with tracked Google keywords and a rank
  check inside the last day, so the first observation lands promptly.
- **Metric.** None. Capture rides along with `serp_checks`, which is already
  metered.
- **Canary.** Run one rank check on the canary account, then open the keyword's
  feature history. Expect the dot matrix and its accessible table fallback to
  agree.
- **Watch.** Queues. A regression appears as `ranks` jobs slowing down, because
  capture writes on the rank path.

## `KEYWORD_CLUSTERING_ENABLED`

- **Preconditions.** The canary account is Pro or Agency and has at least ten
  Google keywords with observations inside the seven-day freshness window.
- **Metric.** `keyword_cluster_runs` — caps 0 / 0 / 4 / 20. Vendor unit cost is
  zero; the optional label pass is bounded inside the run ceiling.
- **Canary.** Run the preflight first and confirm the blocked-keyword list
  names its reasons, then start one run.
- **Watch.** Queues, then Costs. A run that reaches the AI label pass should
  move Costs by no more than the label ceiling; deterministic grouping alone
  must not move Costs at all.

## `CANNIBALIZATION_ENABLED`

- **Preconditions.** The canary account is Starter or above and has stored
  Search Console `query,page` rows. A site with no stored rows is expected to
  be refused without consuming a unit — verify that refusal deliberately.
- **Metric.** `cannibalization_reports` — caps 0 / 4 / 20 / 100, unit cost zero.
- **Canary.** Produce one report over the 28-day window, then re-open it. The
  reopen must not consume a second unit.
- **Watch.** Overview. A regression appears as report latency, not cost.

## `PUBLIC_EXPORTS_ENABLED`

- **Preconditions.** An Agency canary with an API key. Exports are stored reads
  behind the `/api/v1` bearer path and the `api` rate bucket.
- **Metric.** None. Exports never move a usage counter.
- **Canary.** Request one list endpoint as CSV, then page the SERP-observation
  read to its second page and confirm the opaque cursor round-trips.
- **Watch.** Overview for 429 pressure on the `api` bucket. If exports are
  rate-limited more than expected, tune `RATE_LIMIT_API_MAX` rather than
  turning the flag off.

## Exit criteria

All four flags on, no Costs movement beyond the clustering label ceiling, no
new dead-letter entries, and no 5xx in `docker compose logs api worker`.
