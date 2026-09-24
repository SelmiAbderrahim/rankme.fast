# rankme-community-requests rollout and rollback

This runbook enables the twelve community-request surfaces in ascending order
of blast radius. It changes feature flags only. It does not add routes, alter
stored results, edit production data directly, or change a customer's
subscription.

Operator material. English-only, never served from `/docs`.

## Flip order

| Step | File | Flags | Why here |
|---|---|---|---|
| 1 | `01-zero-spend-flags.md` | `SERP_FEATURE_TRACKING_ENABLED`, `KEYWORD_CLUSTERING_ENABLED`, `CANNIBALIZATION_ENABLED`, `PUBLIC_EXPORTS_ENABLED` | No vendor budget effect at all — stored reads and byproducts of already-paid checks. |
| 2 | `02-stored-read-flags.md` | `INTERNAL_LINKING_ENABLED`, `ALERTS_ENABLED`, `CLIENT_REPORTS_ENABLED` | Own-infrastructure cost only; each has a stored-evidence precondition. |
| 3 | `03-metered-ai-flags.md` | `SCHEMA_GENERATOR_ENABLED`, `TOXIC_LINKS_ENABLED`, `CONTENT_BRIEFS_ENABLED` | Bounded AI spend under a per-run ceiling. |
| 4 | `04-vendor-spend-flags.md` | `ALT_ENGINE_TRACKING_ENABLED`, `GEOGRID_ENABLED` | Highest per-unit vendor cost. Flip last, one at a time. |
| — | `05-rollback.md` | all twelve | What refuses, what survives, what finishes. |

Never flip a later step before the previous step's canary has been observed
for a full metering period.

## Before the first flip

1. Confirm the release passed `ops/ci-gates.md` and all six services are
   healthy with `make ps`.
2. Confirm every migration is applied — `server.ts` runs `runMigrations()`
   before listen, so a healthy `api` means the schema is current.
3. Confirm all twelve flags are currently false in the root `.env`.
4. Confirm the four per-run cost ceilings are set to positive integers:
   `CONTENT_BRIEF_COST_CEILING_MICROS`, `INTERNAL_LINKING_COST_CEILING_MICROS`,
   `TOXICITY_COST_CEILING_MICROS`, and `SCHEMA_GEN_COST_CEILING_MICROS`.
5. When `PAYMENT_PROVIDER=polar`, confirm the four credit-pack product IDs
   resolve: `POLAR_CREDITS_BRIEFS_PRODUCT_ID`,
   `POLAR_CREDITS_GEOGRID_PRODUCT_ID`, `POLAR_CREDITS_TOXICITY_PRODUCT_ID`,
   and `POLAR_CREDITS_ALT_ENGINE_PRODUCT_ID`.
6. Confirm `dataforseo-pricing.md` is current — step 4 is priced from it.
7. Open the superadmin intelligence views and record a baseline:
   `/superadmin?tab=intelligence&intel=overview`,
   `/superadmin?tab=intelligence&intel=providers`,
   `/superadmin?tab=intelligence&intel=costs`,
   `/superadmin?tab=intelligence&intel=quality`,
   `/superadmin?tab=intelligence&intel=queues`, and
   `/superadmin?tab=intelligence&intel=monitors`.
8. Prepare one verified canary account at each tier a step needs. Record the
   account identifier, the operator, the start time, the expected metric
   movement, and a known stored-result identifier. Never record user content.

## How to flip one flag

1. Change only the named value in the root `.env`. Never introduce a
   `${KEY}_FILE` reader, a `./secrets/*` mount, or a compose `secrets:` block.
2. Recreate the two processes that read server environment:

   ```bash
   docker compose up -d --force-recreate api worker
   make ps
   ```

3. Wait for both services to become healthy, then review sanitized boot logs:

   ```bash
   docker compose logs --no-color --tail=200 api worker
   ```

4. Run only the canary described by that step. Check Overview, Providers,
   Costs, Quality, Queues, and Monitors before widening access.

Every flag must be present in both the `api` and the `worker` environment.
A flag set on `api` alone leaves the queue consumer dark and jobs will sit in
`queued` forever.

## The rollback rule

Any flag may be returned to false at any time without a migration, a data
edit, or a support action. Turning a flag off refuses new runs with the
localized product-unavailable response, leaves stored results readable, and
lets already-queued jobs finish to a consistent terminal state. See
`05-rollback.md` for the per-flag statement.

If a step's canary shows unexpected cost movement, roll that single flag back
first — do not roll back the whole step and do not disable a provider
capability to slow a feature down.
