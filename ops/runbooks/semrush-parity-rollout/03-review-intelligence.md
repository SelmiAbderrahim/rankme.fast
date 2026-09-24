# 03 — Review Intelligence

Enable `REVIEW_INTELLIGENCE_ENABLED` only after Link, Traffic, and Trends have
passed their canaries.

## Preflight

1. In Providers, confirm every source selected for the canary is configured.
2. In Queues, record the `review-sync` depth and dead-letter count.
3. In Costs, record `review_syncs` usage and the cited theme-pass cost
   baseline.

## Enable and verify

1. Set `REVIEW_INTELLIGENCE_ENABLED=true` in the root `.env` and use the
   common flip procedure in `README.md`.
2. Start with one configured source. Preview, submit one sync, and wait for a
   terminal state. Confirm the entire sync moves `review_syncs` once.
3. Repeat with two or three configured sources only after the one-source
   canary passes. A partial, empty/deduplicated, cached, or theme-pass-failed
   run consumes the unit and retains any valid reviews.
4. Under controlled fixtures, confirm a run refunds exactly once only when
   every selected source has a provider failure and no new review is retained.
5. Reopen inventory, statistics, themes, citations, and CSV. Confirm theme
   failure never removes retained source reviews.
6. Check Providers, Costs, Quality, and the `review-sync` queue after each
   canary. Stop if waiting, failed, or dead-letter jobs rise unexpectedly.

Review Intelligence is on demand. Do not describe or test it as monitoring,
automatic replies, or a scheduled sync.

## Roll back

1. Set `REVIEW_INTELLIGENCE_ENABLED=false` and recreate `api` and `worker`.
2. Confirm source mutations, previews, and new syncs return the localized
   unavailable response.
3. Reopen the known stored run, inventory, statistics, themes, and CSV.
   Stored reads must survive.
4. Confirm the queue stops accepting new work and the rollback did not change
   existing source records, usage history, packs, or subscription state.

