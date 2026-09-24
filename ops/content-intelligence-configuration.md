# Content Intelligence operator configuration

This is restricted operator documentation. Keep all values in the root `.env`
or the deployment secret store that renders it. Never put credentials in a
subdirectory env file, a ticket, a screenshot, or this document. The tracked
`.env.example` is the field catalog and intentionally leaves secrets blank.

## Deployment modes

The safe self-host and demo configuration is `PROVIDER_CONTENT_SOURCE=fake` and
`PROVIDER_AI=fake`. It is deterministic, keyless, and makes no paid calls. Keep
fake providers during migration and cold-stack validation. Production refuses a
fake provider unless the existing `ALLOW_FAKE_PROVIDERS_IN_PRODUCTION` override
is an explicit operator choice.

A safe pre-release root-env example is intentionally keyless and keeps every
new entry point closed:

```dotenv
PROVIDER_CONTENT_SOURCE=fake
PROVIDER_AI=fake
CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS=7
CONTENT_INTELLIGENCE_ENABLED=false
CONTENT_INVENTORY_ENABLED=false
COMPETITOR_CONTENT_INTELLIGENCE_ENABLED=false
CONTENT_MONITORING_ENABLED=false
MCP_ENABLED=false
```

This example can validate migrations, configuration parsing, and fixture-backed
health metadata without a paid vendor request. Live credentials never belong in
an example block.

Live content fetching is Firecrawl Cloud only. Set
`PROVIDER_CONTENT_SOURCE=firecrawl` only after the account has Zero Data
Retention enabled, then provide `FIRECRAWL_API_KEY` through the secret store and
set `FIRECRAWL_ZDR_ENABLED=true` as the operator attestation. The env validator
rejects a non-HTTPS or non-Cloud `FIRECRAWL_BASE_URL`; it also rejects live mode
without the key or ZDR attestation.

Live structured generation uses `PROVIDER_AI=ai-sdk`. `AI_PROVIDER_ORDER`
contains a unique ordered subset of `glm,deepseek,kimi,openai,google,anthropic`.
Every enabled provider in the order needs its enabled flag, credential, model,
and non-negative input/output rates. GLM additionally requires its HTTPS base
URL. The task-profile registry under `server/src/shared/ai-profiles/` decides
which reviewed profile a task may use; runtime env cannot inject or alter
profile instructions.

## Root fields and propagation

All fields below are parsed by `server/src/config/env.ts`. Docker Compose passes
the same content/provider selection, credentials, bounds, costs, retention, and
rollout values to both `api` and `worker` where the process needs them. Rate
limits are API concerns; queue processors and reconciliation intervals are
worker concerns. Do not override a shared selector differently between the two
services.

| Area | Root fields | Requirement or meaning |
| --- | --- | --- |
| Rollout | `CONTENT_INTELLIGENCE_ENABLED`, `CONTENT_INVENTORY_ENABLED`, `COMPETITOR_CONTENT_INTELLIGENCE_ENABLED`, `CONTENT_MONITORING_ENABLED`, `MCP_ENABLED` | Operator-owned booleans; resolved state is read-only in superadmin. |
| Content source | `PROVIDER_CONTENT_SOURCE`, `FIRECRAWL_API_KEY`, `FIRECRAWL_FALLBACK_API_KEYS`, `FIRECRAWL_BASE_URL` | Live mode requires the primary key and Cloud HTTPS origin. Pool is bounded to five unique fallbacks. |
| Crawl bounds/cost | `FIRECRAWL_TIMEOUT_MS`, `FIRECRAWL_MAX_PAGE_CHARS`, `FIRECRAWL_MAX_CRAWL_PAGES`, `FIRECRAWL_COST_MICROS_PER_CREDIT` | Hard latency, payload, crawl, and direct-cost inputs. |
| Privacy/webhooks | `FIRECRAWL_ZDR_ENABLED`, `FIRECRAWL_WEBHOOK_SECRET`, `FIRECRAWL_WEBHOOK_SECRETS`, `FIRECRAWL_WEBHOOK_SECRET_BINDINGS` | ZDR is mandatory live. Binding JSON maps every active credential slot to rotating webhook secrets. Legacy scalar/list fields are migration-only. |
| Reconciliation | `CONTENT_MONITOR_RECON_INTERVAL_MS` | Worker sweep cadence for due monitor recovery. |
| Analysis economics | `CONTENT_ANALYSIS_COST_CEILING_MICROS`, `CONTENT_ANALYSIS_AI_BUDGET_MICROS` | Positive micro-USD ceilings; AI budget must not exceed the total ceiling. |
| Retention/bounds | `CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS`, `CONTENT_INVENTORY_MAX_PAGES` | Sanitized excerpt TTL (shipped policy: seven days) and hard inventory page ceiling. |
| AI router | `PROVIDER_AI`, `AI_PROVIDER_ORDER`, `AI_TOTAL_TIMEOUT_MS`, `AI_MAX_ATTEMPTS`, `AI_TELEMETRY_ENABLED` | Fake or reviewed AI SDK routing; attempts cannot exceed the provider order. |
| AI account safety | `AI_ACCOUNT_SPEND_WINDOW_MS`, `AI_ACCOUNT_SPEND_LIMIT_MICROS`, `AI_USAGE_RETENTION_DAYS` | Per-account spend circuit and usage-ledger retention. |
| GLM | `GLM_ENABLED`, `GLM_API_KEY`, `GLM_MODEL`, `GLM_BASE_URL`, `GLM_INPUT_COST_MICROS_PER_MILLION`, `GLM_OUTPUT_COST_MICROS_PER_MILLION` | All live fields required when ordered and enabled. |
| DeepSeek | `DEEPSEEK_ENABLED`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_INPUT_COST_MICROS_PER_MILLION`, `DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION` | All live fields required when ordered and enabled. |
| Kimi | `KIMI_ENABLED`, `KIMI_API_KEY`, `KIMI_MODEL`, `KIMI_INPUT_COST_MICROS_PER_MILLION`, `KIMI_OUTPUT_COST_MICROS_PER_MILLION` | All live fields required when ordered and enabled. |
| OpenAI | `OPENAI_ENABLED`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_INPUT_COST_MICROS_PER_MILLION`, `OPENAI_OUTPUT_COST_MICROS_PER_MILLION` | All live fields required when ordered and enabled. |
| Google | `GOOGLE_ENABLED`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_MODEL`, `GOOGLE_INPUT_COST_MICROS_PER_MILLION`, `GOOGLE_OUTPUT_COST_MICROS_PER_MILLION` | All live fields required when ordered and enabled. |
| Anthropic | `ANTHROPIC_ENABLED`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_INPUT_COST_MICROS_PER_MILLION`, `ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION` | All live fields required when ordered and enabled. |
| Legacy summary | `PROVIDER_SUMMARY`, `AI_SUMMARY_ENABLED`, `AI_SUMMARY_MODEL` | Compatibility adapter for audit summaries, not a second content router. |
| API limits | `RATE_LIMIT_CONTENT_CREATE_*`, `RATE_LIMIT_CONTENT_POLL_*`, `RATE_LIMIT_RECOMMENDATION_*`, `RATE_LIMIT_INVENTORY_*`, `RATE_LIMIT_COMPETITOR_*`, `RATE_LIMIT_FIRECRAWL_WEBHOOK_*`, `RATE_LIMIT_MCP_*` | Each `*` is the matching `WINDOW_MS` and `MAX` pair. |
| Commerce | `POLAR_CREDITS_CONTENT_INTELLIGENCE_PRODUCT_ID` | Optional Polar catalog id for the 20-analysis pack; keep blank unless the product exists in the same environment. |

Use blank secret placeholders in configuration review. Do not paste a live token
or provide a command that initiates a paid vendor request.

## Migrating legacy summary configuration

`PROVIDER_SUMMARY=fake` remains deterministic. `PROVIDER_SUMMARY=anthropic`
uses the Anthropic profile compatibility adapter and requires its existing key
and rates. `PROVIDER_SUMMARY=ai-sdk` requires `PROVIDER_AI=ai-sdk` and runs the
same reviewed summary profile through the ordered router. Migrate by configuring
and validating the ordered providers first, switching the summary adapter, then
removing no legacy field until all API and worker replicas run the new release.
This migration does not change the task-profile allowlist.

## Firecrawl credential and webhook rotation

1. Add the new credential to the bounded pool without removing the old one.
2. Create a new webhook secret in the provider control plane and add a binding
   for the exact credential slot. During overlap, retain both the new and old
   secrets for that slot.
3. Deploy API and worker together. Confirm startup metadata reports configured
   bindings and ZDR without exposing values.
4. Move new work to the new credential. Resource follow-ups remain pinned to
   the credential that created the crawl.
5. After all old work is terminal and webhook retries have aged out, remove the
   old credential, binding, and then old secret.

The provider advances only after `401`, `402`, or `429`; timeouts and malformed
responses do not silently move work to a different credential. Never substitute
another vendor or `fake` during an accepted live run.

## Cost, queue, and data operations

Superadmin Intelligence exposes resolved flags, provider readiness, direct-cost
ceiling breaches, AI-budget breaches, fallback use, partial/refund counts, queue
age, and DLQ state. Treat the existing alert thresholds as the go/no-go source;
do not invent a success-rate target. The worker's BullMQ queues remain the
durable execution boundary. A failed job enters the existing DLQ policy, and
reconciliation compares queue state with Mongo/Postgres reservation and run
records before any retry or refund.

Mongo stores the analysis/run documents and sanitized excerpts; the snapshot
TTL index deletes excerpts after `CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS`. Postgres
stores usage reservations/counters and ordered outcomes/correlations. Redis is
operational queue state, not the billing ledger. Backups must preserve Mongo and
Postgres at a mutually understood point; restoring Redis alone cannot recreate
billing truth. Account export includes owner-visible analyses. Purge/account
deletion must cover analyses, versions, excerpts, monitoring signatures,
provider telemetry, and the relational usage/outcome rows while retaining only
records required by the documented legal policy.

During a provider outage, disable the relevant new-run flag, leave workers
running to settle accepted work, and inspect partial/refund and DLQ records.
Quota exhaustion is handled the same way unless a reviewed credential-pool
failover is eligible. For monitoring signature or duplicate alerts, compare the
stored normalized signature, credential-bound webhook event id, and last
terminal monitor check; never delete billing rows to force a retry.

`CONTENT_MONITORING_ENABLED=false` stops monitor creation and new scheduled
checks, but the signed webhook boundary continues accepting terminal callbacks
for work already issued. The existing persisted
`firecrawl_change_monitoring` provider switch is the explicit emergency-abort
control that also refuses callbacks. Use that stronger switch only when the
incident response accepts the resulting reconciliation work.

## MCP operations

Enable MCP only after API keys, tier resolution, reverse-proxy header forwarding,
and the `mcp` rate metrics are healthy. Set `MCP_ENABLED=true`, deploy API and
worker with the same root config, and verify discovery with a read-only key.
Disabling it makes new `/api/mcp` requests return unavailable; it does not
revoke API keys, remove `/api/v1`, delete stored data, cancel audits already
started, or change billing.

Rotate a consumer key by creating a narrowly scoped replacement, updating and
verifying every consumer, then revoking the old key. Revocation is immediate.
Observe `mcp` bucket hits and `429` responses through the existing rate-limit
metrics; do not raise limits until key misuse and client retry behavior are
excluded.
