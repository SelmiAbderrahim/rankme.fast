# SEMrush-parity rollout and rollback

This runbook enables the five shipped intelligence surfaces in the safest
order. It changes feature flags only. It does not add routes, alter stored
results, edit production data directly, or change a customer's subscription.

## Before the first flip

1. Confirm the release passed `ops/ci-gates.md` and all six services are
   healthy with `make ps`.
2. Confirm these root `.env` flags are false:
   `LINK_INTELLIGENCE_ENABLED`, `TRAFFIC_INSIGHTS_ENABLED`,
   `KEYWORD_TRENDS_ENABLED`,
   `REVIEW_INTELLIGENCE_ENABLED`, and `BRAND_RADAR_ENABLED`.
3. Open the superadmin intelligence views and record a baseline:
   `/superadmin?tab=intelligence&intel=overview`,
   `/superadmin?tab=intelligence&intel=providers`,
   `/superadmin?tab=intelligence&intel=costs`,
   `/superadmin?tab=intelligence&intel=quality`,
   `/superadmin?tab=intelligence&intel=queues`, and
   `/superadmin?tab=intelligence&intel=monitors`.
4. Confirm the required provider capabilities are configured in Providers.
   Do not copy credentials into the rollout record.
5. Prepare one verified canary account at each tier needed by a step. Record
   its account identifier, the operator, start time, expected metric movement,
   and a known stored-result identifier. Do not record user content.

## How to flip one flag

1. Change only the named value in the root `.env`.
2. Recreate the two processes that read server environment:

   ```bash
   docker compose up -d --force-recreate api worker
   make ps
   ```

3. Wait for both services to become healthy. Review the sanitized boot logs:

   ```bash
   docker compose logs --no-color --tail=200 api worker
   ```

4. Run only the canary described by that step. Check Overview, Providers,
   Costs, Quality, Queues, and Monitors before widening access.

Do not use the superadmin dynamic feature-flag action for these five switches.
They are environment kill switches declared in `server/src/config/env.ts` and
mirrored into `api` and `worker` by `docker-compose.yml`.

## Required order and rationale

1. Follow `02-cheap-metrics.md`: set `LINK_INTELLIGENCE_ENABLED=true`, then
   `TRAFFIC_INSIGHTS_ENABLED=true`, then
   `KEYWORD_TRENDS_ENABLED=true`.
   These are bounded, lower-cost, on-demand operations. Link proves per-leg
   accounting, Traffic proves partial estimated results, and Trends proves the
   shared cache and pack path without adding a worker queue.
2. Follow `03-review-intelligence.md` and set
   `REVIEW_INTELLIGENCE_ENABLED=true`. A sync can fan out to three sources and
   then run a cited theme pass, so it follows the simpler canaries.
3. Follow `04-brand-radar.md`. Confirm the recurring add-on and one-time pack
   are live first, then set `BRAND_RADAR_ENABLED=true`. Brand Radar has the
   highest per-unit budget, a multi-stage pipeline, and a recurring commerce
   dependency, so it is last.

Do not combine flips. Record a clear pass for one surface before changing the
next flag.

## Hold and rollback criteria

Stop widening access and roll back the current flag when any of these occurs:

- the provider is unavailable, malformed, or materially slower than its
  established superadmin baseline;
- actual or estimated cost crosses the configured ceiling;
- a metric moves by more units than the canary submitted;
- a failed zero-retained run is not refunded once, or a retained/empty/cache
  result is refunded;
- the related queue accumulates failed or dead-letter jobs;
- stored reads fail, cross-account boundaries change, or logs contain a
  credential, request payload, internal hostname, or unhandled error.

Rollback one surface by setting its flag to `false` in the root `.env`,
recreating `api` and `worker`, and repeating the health checks. A new preview
or mutation must return the localized unavailable response, while a known
stored paid-feature result must remain readable. Disabling a flag never
deletes stored rows: re-enable it briefly in the same controlled window and
confirm the previous results return unchanged.

Forward-only migrations are not rolled back. Never delete or edit result,
usage, subscription, or ledger rows as a first-line response.

## Supporting procedures

- General deployment rollback conventions:
  `ops/runbooks/rankme-evidence-first-roadmap/07-rollback.md`
