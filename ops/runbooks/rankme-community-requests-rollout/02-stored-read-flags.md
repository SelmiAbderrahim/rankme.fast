# Step 2 — stored-read flags

`INTERNAL_LINKING_ENABLED` → `ALERTS_ENABLED` → `CLIENT_REPORTS_ENABLED`

These three read stored first-party evidence and cost our own infrastructure
rather than vendor budget. Each has a precondition that must exist before the
surface can do anything useful, so verify the precondition first and the
refusal path deliberately.

## Step control

- **Preconditions.** Prepare a completed content inventory, two consecutive
  completed link reviews, and an Agency canary with branding configured before
  changing any flag in this step.
- **Superadmin panel.** **Queues** is the canonical panel for this step.
- **Regression metric.** Failed-or-dead-letter job count. It must not rise above
  the recorded pre-flip baseline during the three canaries.

## `INTERNAL_LINKING_ENABLED`

- **Preconditions.** The canary account is Pro or Agency and has a **completed
  content inventory no more than seven days old**. Without it the run must
  refuse and tell the operator to refresh the inventory — this feature performs
  no crawl of its own.
- **Metric.** `internal_link_runs` — caps 0 / 0 / 4 / 25, ceiling
  `INTERNAL_LINKING_COST_CEILING_MICROS`.
- **Canary.** Run once with a stale inventory and confirm the refusal. Refresh
  the inventory, run again, and confirm suggestions carry their evidence
  disclosure.
- **Watch.** Costs against the internal-linking ceiling. The AI anchor pass is
  the only spending step; a failed pass must still return the deterministic
  suggestions.

## `ALERTS_ENABLED`

- **Preconditions.** The canary has at least **two consecutive completed link
  reviews**, otherwise there is no baseline to diff and no alert can fire. Email
  works on every paid tier; Slack and generic webhook require Pro or above.
- **Metric.** None — deliveries are not metered. The structural cap is
  `alertRules` 0 / 2 / 10 / 50.
- **Canary.** Create one email rule and one signed generic-webhook rule. Trigger
  a second link review and confirm exactly one delivery per observed transition,
  with a bounded sample of up to 50 domains and the honest full count.
- **Watch.** The delivery log and Queues. A regression appears as repeated
  deliveries for one transition — that breaks the exactly-once contract and is a
  rollback, not a tuning problem.
- **Note.** Rank-drop rules are configurable but deliver from confirmed
  rank-drop observations the shipped rank pipeline does not yet produce. Do not
  raise an incident when a rank-drop rule stays silent.

## `CLIENT_REPORTS_ENABLED`

- **Preconditions.** An Agency canary with branding configured — company name,
  accent colour, and logo — plus at least one stored audit and one stored rank
  snapshot to compose from.
- **Metric.** None. Structural limits are 20 schedules and 25 portal links.
- **Canary.** Compose one report on demand, then create one weekly schedule and
  one portal link. Revoke the portal link and confirm the next request fails.
- **Watch.** Queues for the scheduler and the delivery log for per-recipient
  sent / failed / suppressed states. Composition must make no vendor request —
  any Providers movement during this canary is a defect.

## Exit criteria

All three flags on, Costs moved only by the internal-linking AI pass and only
within its ceiling, exactly-once alert delivery confirmed, and a revoked portal
link refusing on the next request.
