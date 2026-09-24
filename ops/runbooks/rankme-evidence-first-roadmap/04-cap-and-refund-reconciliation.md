# 04 — Cap and refund reconciliation

## The invariants

- Every vendor-spending enqueue is preceded by `assertCapacity(accountId,
  metric)` at the API layer. Cache hits still count. Reads/previews never
  reserve.
- Base tier caps drain `usage_counters` atomically; overflow drains
  `credit_ledger` (signed bigint rows) inside a `SELECT … FOR UPDATE`
  transaction. The ledger can never go negative — a negative balance in
  production is a Sev-1 data bug, not an ops cleanup task.
- Audience research adds an append-only event trail
  (`audience_research_events`: `reserved` → `consumed` | `refunded`) with a
  unique-index idempotency guarantee: exactly one terminal event per
  reservation.

## Audience-research refunds

- The ONLY refund reason is `no_usable_public_evidence` — a run that produced
  zero usable public evidence refunds its single `audience_research_runs`
  unit, exactly once, via the single refund authority
  (`audience-research.refund.ts`).
- `cost_ceiling_partial` and `processing_failure` DO NOT refund — partial
  evidence was delivered/attempted.
- The reconciliation sweep (worker scheduler on the recon queue) closes
  crashed runs to a consistent terminal state. It NEVER refunds — it only
  finalizes state so the refund authority's own idempotent path can run.

## Weekly reconciliation routine

1. `GET /api/superadmin/intelligence/audience-research?from=…&to=…` —
   compare `refundCount` against `runCounts.failed` + coverage-failure
   category `no_usable_public_evidence`. Refunds must never exceed the
   no-usable-evidence count.
2. `GET /api/superadmin/intelligence/weekly-pulse?…` — `deliveryTotals`
   should account for every completed run × its subscriber set;
   `suppressed_*` categories explain gaps. `lag.overdueSites` should be 0
   outside a deploy window; sustained lag = scheduler not registered or
   worker down.
3. `GET /api/superadmin/intelligence/costs` — per-capability micros vs the
   vendor dashboards. The configured micro rates (env) are estimates; a >20%
   sustained divergence means the operator-configured rates need updating.
4. Queue backlog (`…/intelligence` queues DTO): audience-research and
   weekly-pulse backlogs now report alongside audits/ranks/content-analysis.
   A growing `failed` count with an empty DLQ means retries are still in
   flight; DLQ rows mean terminal failures — inspect, fix cause, then requeue
   via the superadmin requeue endpoint (audience-research is requeue-allowed;
   weekly-pulse is deliberately NOT — the next scheduled pulse supersedes).

## Polar packs

- Credit grants are idempotent by `polar_order_id`; refunds post linked
  negative rows. Never hand-edit `credit_ledger` — post a compensating event
  through the billing service if a manual correction is unavoidable, and
  record why.
