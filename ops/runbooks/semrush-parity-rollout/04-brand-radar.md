# 04 — Brand Radar

Enable `BRAND_RADAR_ENABLED` last.

## Commerce and provider preflight

1. In `/superadmin?tab=intelligence&intel=costs`, confirm the Brand Radar
   recurring add-on and one-time pack are present with the shipped catalog
   values. Confirm the payment catalog is live without copying product IDs or
   credentials into this runbook.
2. Confirm an Agency canary has its base allowance. Confirm a Pro canary
   without the add-on remains blocked, while a separate Pro canary with the
   active add-on is eligible.
3. In Providers, confirm search, page-summary, and AI digest capabilities are
   healthy. In Queues, record `brand-radar` depth and dead-letter count.
4. In Costs, record `brand_mention_scans` and the stage-cost baseline.

## Enable and verify

1. Set `BRAND_RADAR_ENABLED=true` in the root `.env` and use the common flip
   procedure in `README.md`.
2. Preview and submit one brand query. Confirm one scan moves
   `brand_mention_scans` once and the `brand-radar` queue returns to baseline.
3. Confirm retained mentions keep citations. Counts and trends must remain
   deterministic; digest prose must remain visibly AI-generated and
   citation-or-drop.
4. Exercise controlled terminal states:
   - empty success consumes;
   - retained partial search/summary output consumes;
   - digest failure or abstention consumes and does not remove evidence;
   - only a search-stage provider failure with zero retained rows refunds
     once.
5. Run Weekly Pulse over the stored scan delta. Confirm the digest reads
   stored Brand Radar results and neither starts a scan nor moves the metric.
6. Check Providers, Costs, Quality, Queues, and Overview. Stop on excess
   stage spend, unexpected refunds, evidence without citations, or queue
   growth.

Do not widen access until commerce, entitlement, provider, queue, and refund
checks all pass.

## Roll back

1. Set `BRAND_RADAR_ENABLED=false` and recreate `api` and `worker`.
2. Confirm new previews and scans return the localized unavailable response.
3. Reopen the known stored scan, mentions, deterministic trends, and stored
   Weekly Pulse delta. All stored reads must survive.
4. Leave subscription and pack state untouched. Feature rollback does not
   cancel an add-on, refund a purchase, or delete a balance.

