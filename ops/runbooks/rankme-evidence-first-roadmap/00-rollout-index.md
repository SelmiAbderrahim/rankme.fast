# Evidence-first roadmap — operator rollout index

Private operator material. English only. Never served: the web container mounts
only `./docs:/docs:ro` (see `docker-compose.yml`), the docs runtime enumerates
flat `<slug>.<locale>.md` files inside `/docs`, and `scripts/gen-docs.mjs`
reads only `/docs`. The boundary test
(`server/src/shared/docs/boundary.test.ts`) enforces all of that.

## Runbooks in this set

| # | Runbook | Covers |
|---|---------|--------|
| 01 | `01-preflight-and-zdr.md` | Pre-rollout checks, Firecrawl ZDR attestation, provider credentials |
| 02 | `02-migrations-and-no-drift.md` | Drizzle forward migrations, journal quirks, no-drift proof |
| 03 | `03-staged-enablement.md` | Order of enabling surfaces, provider flips, worker registration |
| 04 | `04-cap-and-refund-reconciliation.md` | Usage counters, credit ledger, audience-research refunds, recon sweep |
| 05 | `05-privacy-and-deletion.md` | Data-rights coverage of the new evidence tables |
| 06 | `06-alerts-and-thresholds.md` | Queue depth, DLQ, spend circuit, superadmin observability endpoints |
| 07 | `07-rollback.md` | Rollback switches that exist today (no invented flags) |
| 08 | `08-compatibility-removal-checklist.md` | What may be removed after the one-release compatibility window |

Content Intelligence has a release-specific [enable and rollback runbook](../content-intelligence-rollout.md), [root configuration reference](../../content-intelligence-configuration.md), and [authenticated internal API contract](../../contracts/content-intelligence-internal-api.md). Those references supersede this set when their scope is more specific.

## Ground rules

- Public docs (`/docs`) never contain provider task IDs, credential names,
  queue names, `PROVIDER_*` values, per-capability money, or anything from
  these runbooks.
- Every number cited here comes from code (`server/src/shared/billing/tiers.ts`,
  `server/src/config/env.ts`) — if a runbook and the code disagree, the code
  wins and the runbook gets fixed.
- Rollout state is observable through the superadmin intelligence plane
  (`/api/superadmin/intelligence/*`) — never by psql/mongosh into production
  as a first resort.
