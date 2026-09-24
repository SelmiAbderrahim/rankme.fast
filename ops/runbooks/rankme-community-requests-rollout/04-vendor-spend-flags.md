# Step 4 — vendor-spend flags

`ALT_ENGINE_TRACKING_ENABLED` → `GEOGRID_ENABLED`

These two carry the highest per-unit vendor cost in the batch. Flip them **one
at a time**, and watch the superadmin cost plane between the two flips for a
full metering period. Do not flip both in one maintenance window.

Confirm `dataforseo-pricing.md` is current before this step. Both flags are
priced directly from it.

## Step control

- **Preconditions.** The price sheet is current, both pack product IDs resolve
  when Polar is active, and the exact target tokens and typed coordinates for
  the canaries below are ready.
- **Superadmin panel.** **Costs** is the canonical panel for this step.
- **Regression metric.** Actual cost micros per consumed unit. It must remain
  inside the priced envelope in `vendor-costs.ts` between the two flips.

## `ALT_ENGINE_TRACKING_ENABLED`

- **Preconditions.** The canary account is Pro or Agency. Have one exact
  YouTube channel handle and one exact Amazon ASIN ready — without an exact
  target token the keyword cannot be tracked on that engine, and confirming that
  refusal is part of the canary.
- **Metric.** `alt_engine_checks` — caps 0 / 0 / 20 / 240 at 2,600 micros per
  check, with `altEngineKeywordSlots` 0 / 0 / 5 / 30. The
  `alt-engine-checks-500` pack tops the allowance up.
- **Cadence.** Non-Google targets are checked once per week regardless of the
  site cadence. Expect the first week's cost to be one check per tracked
  keyword-and-engine pair, not one per day.
- **Canary.** Add one Bing keyword, one YouTube keyword with its handle, and one
  Amazon keyword with its ASIN. Confirm the engine filter round-trips through
  the URL and that sponsored Amazon blocks are absent from the stored index.
- **Watch.** Costs first, then Providers. If a provider failure retains no
  result, the unit must be returned — a failed check that still consumed a unit
  is a rollback.

## `GEOGRID_ENABLED`

- **Preconditions.** An Agency canary, or a Pro canary holding the
  `geogrid-scans-10` pack. Have typed coordinates ready — there is no map picker
  and no map-tile vendor.
- **Metric.** `geogrid_scans` — caps 0 / 0 / 0 / 6 at 98,000 micros per scan.
  One scan runs up to 49 per-coordinate Maps checks.
- **Canary.** Start with a **3×3 grid**, never 7×7. Confirm each cell resolves to
  an observed position, an explicit "not in the local pack", or a failed check,
  and that the heat grid has its accessible table beside it.
- **Refund rule.** A scan with at least one usable cell consumes its unit. Only
  an all-cell failure is refunded. Verify one deliberate all-cell failure before
  widening access.
- **Watch.** Costs continuously during the first scans. This is the single most
  expensive unit in the batch; a 7×7 grid is 49 vendor calls inside one unit.

## Exit criteria

Both flags on, one flag at a time with a full metering period between them,
observed cost per unit within the priced envelope, refunds landing only where
the refund rule says they should, and no dead-letter growth on the `ranks`
queue.
