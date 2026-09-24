# Rollback — what refuses, what survives, what finishes

Every flag in this batch obeys one contract. Turning it false:

- **refuses** new-run entry points with the localized product-unavailable
  response — never a 500, never a silent empty result;
- **leaves stored results readable**, so a customer can still open, export, and
  print what they already produced;
- **lets already-queued and running jobs finish** to a consistent terminal
  state rather than stranding them mid-pipeline.

No flag flip requires a migration, a data edit, or a support action. Roll back
one flag, not a whole step, unless the whole step is implicated.

## Rollback control

- **Preconditions.** Record the affected flag, the known stored result used to
  prove survival, and every queued or running job for that feature before the
  flag changes.
- **Superadmin panel.** **Queues** is the canonical panel during rollback.
- **Regression metric.** Non-terminal job count after the queue drains. It must
  reach zero without deleting stored results.

## Per flag

| Flag | Refuses | Survives | Finishes |
|---|---|---|---|
| `SERP_FEATURE_TRACKING_ENABLED` | New feature capture on subsequent rank checks | All stored observations and their history views | The in-flight rank check completes; the check itself is unaffected |
| `KEYWORD_CLUSTERING_ENABLED` | New cluster runs and the preflight | Stored runs, clusters, and evidence remain openable | A running cluster job reaches `completed` or `failed` |
| `CANNIBALIZATION_ENABLED` | New report generation | Stored reports stay readable at their stored window | Reports are computed synchronously; nothing is left in flight |
| `PUBLIC_EXPORTS_ENABLED` | New `/api/v1` export and stored-read requests | Nothing to lose — exports hold no state | In-flight HTTP responses complete normally |
| `INTERNAL_LINKING_ENABLED` | New suggestion runs | Stored runs, suggestions, and CSV export of stored runs | A running job reaches `completed` or `failed`; a failed AI pass still stores deterministic suggestions |
| `ALERTS_ENABLED` | New rule creation and new detections | Existing rules, the delivery log, and frozen evidence pairs | A dispatch already reserved delivers once, then stops |
| `CLIENT_REPORTS_ENABLED` | New composition, new schedules, new portal links | Stored PDFs, the delivery log, and **already-issued portal links** | A scheduled send already in flight completes and is logged |
| `SCHEMA_GENERATOR_ENABLED` | New generations | Stored generations, their evidence, and conformance reports | Generation is synchronous; nothing is left in flight |
| `TOXIC_LINKS_ENABLED` | New reviews and new disavow builds | Stored reviews, bands, rationales, and previously exported files | A running review reaches `succeeded` or `failed` |
| `CONTENT_BRIEFS_ENABLED` | New briefs and re-scoring | Stored briefs, corpus statistics, and drafts | A running brief reaches a terminal status; a halted run stores what it had |
| `ALT_ENGINE_TRACKING_ENABLED` | New non-Google checks | Engine-tagged rank history and the engine filter | A submitted check completes and meters once |
| `GEOGRID_ENABLED` | New grid scans | Stored grids, per-cell positions, and the table fallback | A running scan finishes its remaining cells and settles its refund |

## Portal links are the one thing to decide explicitly

`CLIENT_REPORTS_ENABLED=false` stops new portal links from being issued but does
**not** revoke links already handed to a client. If the reason for rollback is
that a link should not have been shared, revoke that link in the app — the
revocation takes effect on the next request. Do not rely on the flag for that.

## After any rollback

1. Recreate `api` and `worker`, then `make ps` until both are healthy.
2. Review `docker compose logs --no-color --tail=200 api worker` for refusals
   rendering as the localized unavailable response rather than 5xx.
3. Confirm on the superadmin Queues panel that no job is stuck in a
   non-terminal state, and that the dead-letter queue did not grow.
4. Record the flag, the operator, the time, and the observed reason. Never
   record user content.
