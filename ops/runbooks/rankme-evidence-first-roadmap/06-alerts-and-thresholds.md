# 06 — Alerts and thresholds

## Transport

Failure alerts go to Resend (operator inbox) and, when set, the JSON POST
target `ALERT_WEBHOOK_URL`. Missing Resend key degrades to logged
`{ delivered: false }` — check api logs if alerts go quiet.

## What to alert on (and current sources)

| Signal | Source | Threshold guidance |
|--------|--------|--------------------|
| Service unhealthy / restart loop | `make ps`, container healthchecks | any — page |
| DLQ size growth | worker health snapshot + superadmin queues DTO | > 0 sustained 15 min — investigate; requeue only after cause fixed |
| Queue backlog (audits, ranks, content-analysis, audience-research, weekly-pulse) | superadmin queues DTO / worker `/healthz` | waiting > 50 or oldest job > 30 min — worker capacity or a poisoned job |
| Rate-limit pressure | admin overview `rate_limit_hits` (window `RATE_LIMIT_METRICS_WINDOW_MS`) | sudden spikes on `/api/auth/*` = credential stuffing; on public API = abusive client |
| AI spend circuit trips | ai-usage events / costs DTO | any account tripping the rolling circuit (`AI_ACCOUNT_SPEND_LIMIT_MICROS`) more than once/day |
| Audience-research `zdrDegraded` | superadmin audience-research DTO | true — Firecrawl account lost ZDR; stop live crawling until re-attested |
| Weekly-pulse lag | `lag.overdueSites` / `maxLagMinutes` | overdue > 0 for > 2h outside deploys |
| Vendor auth failures | provider error taxonomy (`VendorAuthError`) in logs | any — credentials expired/revoked |
| Coverage failures trending | audience-research `coverageFailures` categories | `processing_failure` growing = code bug; `cost_ceiling_partial` growing = ceilings too low for real sites |

## Not alerts

- `no_usable_public_evidence` terminals — normal product behavior (refunded).
- `unsupported_market` — user picked an unsupported market; UI explains it.
- Single vendor timeouts — BullMQ retries with backoff; only retry-exhaustion
  (DLQ arrival) is actionable.
