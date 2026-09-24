# Step 3 — metered AI flags

`SCHEMA_GENERATOR_ENABLED` → `TOXIC_LINKS_ENABLED` → `CONTENT_BRIEFS_ENABLED`

These three spend bounded AI budget under a per-run ceiling. Flip them in this
order: cheapest ceiling first, and the one with an external scrape last.

Before flipping any of the three, confirm its ceiling is a positive integer in
the root `.env` and matches the vendor unit-cost row in
`server/src/shared/billing/vendor-costs.ts`. A ceiling and a unit cost that
disagree will halt runs mid-flight or overspend a metric — both are release
blockers, not tuning.

When `PAYMENT_PROVIDER=polar`, also confirm all four rollout product IDs resolve
before the first flip: `POLAR_CREDITS_BRIEFS_PRODUCT_ID`,
`POLAR_CREDITS_GEOGRID_PRODUCT_ID`, `POLAR_CREDITS_TOXICITY_PRODUCT_ID`, and
`POLAR_CREDITS_ALT_ENGINE_PRODUCT_ID`.

## Step control

- **Preconditions.** The three ceilings above are positive and reconciled with
  `vendor-costs.ts`; when Polar is active, all four product IDs above resolve.
- **Superadmin panel.** **Costs** is the canonical panel for this step.
- **Regression metric.** Actual cost micros per completed canary. It must stay
  at or below that feature's configured per-run ceiling.

## `SCHEMA_GENERATOR_ENABLED`

- **Preconditions.** `SCHEMA_GEN_COST_CEILING_MICROS` set. The canary account is
  Starter or above with at least one audited page.
- **Metric.** `schema_generations` — caps 0 / 5 / 10 / 60, ceiling per run.
- **Canary.** Generate `Article` for a page with no publication date and confirm
  the conformance report states the `datePublished` gap rather than inventing a
  value. Then generate `FAQPage` for a page that has questions.
- **Watch.** Costs and Quality. The verbatim-copy post-check rejects any value
  that does not match its stored fact; a rise in rejected generations is a
  provider or profile regression, not a customer problem.

## `TOXIC_LINKS_ENABLED`

- **Preconditions.** `TOXICITY_COST_CEILING_MICROS` set. The canary account is
  Pro or Agency and has **stored backlink rows** — a site with none must be
  refused and told to load its backlink list first. Confirm the
  `toxicity-reviews-10` pack resolves before relying on pack capacity.
- **Metric.** `toxicity_reviews` — caps 0 / 0 / 1 / 12. One review snapshots at
  most 1,000 stored rows and pays for at most 100 fresh domain spam scores.
- **Canary.** Run one review, confirm the band distribution, then build a
  disavow file with one row excluded and verify the excluded row is absent from
  the export.
- **Watch.** Costs and Providers. The spam-score call is the spending step; the
  AI rationale must cite a stored row or abstain. An AI-added domain that the
  rubric did not flag is a rollback.

## `CONTENT_BRIEFS_ENABLED`

- **Preconditions.** `CONTENT_BRIEF_COST_CEILING_MICROS` set and the content
  source configured, because a brief performs up to ten page scrapes. An Agency
  canary, or a Pro canary holding the `content-briefs-10` pack.
- **Metric.** `content_briefs` — caps 0 / 0 / 0 / 8, Pro is pack-only.
- **Canary.** Build one brief for a tracked keyword, confirm the corpus
  statistics print their capture date, then re-score a draft and confirm the
  re-score consumes no additional unit.
- **Watch.** Costs hardest of the three — this run has the largest ceiling.
  Confirm the rolling halt fires before the ceiling is exceeded rather than
  after.

## Exit criteria

All three flags on, every run inside its own ceiling, no generation or brief
that cites evidence it was not supplied, and no halt that left a partial run in
a non-terminal state.
