# Content Intelligence release and rollback runbook

Owner: platform operations. This runbook changes entry/enqueue behavior; it
does not erase results or rewrite billing records.

## Before rollout

- Take compatible Mongo and Postgres backups and record the deployed migration
  journal. Database migrations are forward-applied; a flag rollback does not
  reverse a schema migration.
- Confirm root env validation on both API and worker, queue connectivity, DLQ
  visibility, reconciliation health, webhook binding coverage, and superadmin
  Intelligence access.
- Keep every Content Intelligence rollout flag off in live environments until
  its phase below. `MCP_ENABLED` is independent and follows the same rollback
  discipline.

## Enable sequence

1. Deploy migrations and application images with fake content and AI providers.
   Leave live-entry flags off.
2. Exercise the deterministic fake flow through the normal signed-in product
   path and confirm a terminal record, ledger settlement, stored reads, export,
   and cancellation behavior. This verification makes no paid call.
3. Configure only the selected Firecrawl Cloud credential pool, ZDR attestation,
   webhook bindings, selected AI providers, models, and reviewed cost rates.
4. Restart API and worker together. Verify validated startup and provider
   readiness/fixture/health metadata. Do not use a paid smoke request.
5. Set `CONTENT_INTELLIGENCE_ENABLED=true`. Starter, Pro, and Agency may now
   start single-page analyses; existing tier capacity remains authoritative.
6. Watch the existing direct-cost ceiling, AI-budget, fallback, partial, refund,
   queue-age, reconciliation, DLQ, webhook-signature, and rate-limit alerts.
7. For Pro, enable `CONTENT_INVENTORY_ENABLED`; for Agency, enable
   `COMPETITOR_CONTENT_INTELLIGENCE_ENABLED` and then
   `CONTENT_MONITORING_ENABLED`. Enable `MCP_ENABLED` separately only after the
   API-key and `mcp` bucket checks in the operator configuration guide.
8. Keep stored-result reads and billing reconciliation under observation after
   each flag change. Do not combine a provider-selector change with a tier
   expansion in the same observation window.

## Go/no-go

Proceed only when all existing superadmin/alert conditions are below their
configured thresholds: provider startup is ready, no cost-ceiling or AI-budget
breach is active, queue and DLQ age are within policy, reconciliation is current,
and the shipped fallback/partial/refund alerts are not firing. These configured
alerts—not a new success percentage in this runbook—are the release threshold.
Any webhook signature or credential-binding error is a no-go for monitoring.

## Normal rollback

1. Turn off the narrowest affected flag. A disabled start returns localized,
   retryable unavailable before capacity is reserved. The client explains the
   pause and hides the matching start form.
2. Keep API reads and workers online. Queued/running jobs continue to a
   consistent terminal state; cancellation remains available. Stored briefs,
   drafts, evidence, outcomes, exports, and billing records remain readable.
   A normal `CONTENT_MONITORING_ENABLED=false` rollback still accepts valid
   signed terminal webhooks for checks issued before the flag change.
3. If the issue is provider-specific, change the selector only after accepted
   work using the old provider is terminal. Never silently switch an accepted
   run to another vendor or to `fake`.
4. Reconcile every reservation, refund, terminal record, webhook event, and DLQ
   item before re-enabling. A flag rollback never deletes or edits the ledger.

`MCP_ENABLED=false` stops new MCP calls only. It does not revoke consumer keys,
disable the read-only public REST API, cancel an audit that MCP already started,
or affect Content Intelligence reads in the signed-in product.

## Emergency disable

Turn off all four content flags and MCP first. Preserve API read availability.
If an active security or uncontrolled-spend incident requires aborting workers,
record that emergency decision explicitly, stop only the affected consumers,
and, for monitoring, disable the persisted `firecrawl_change_monitoring`
provider switch if callbacks must also be refused. Run reconciliation plus
refund review before restarting. Merely stopping a worker is not a billing
rollback.

Webhook secrets need overlap during rollback because providers may retry signed
events created before the deployment. Do not remove an old binding until its
accepted work and retry horizon are exhausted. Do not roll back database images
below already-applied migrations; ship a forward compatibility fix instead.

## Related restricted references

- [Operator configuration](../content-intelligence-configuration.md)
- [Internal API contract](../contracts/content-intelligence-internal-api.md)
- [Evidence-first rollout index](rankme-evidence-first-roadmap/00-rollout-index.md)
