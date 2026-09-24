# Brand Radar site-scoping rollout — 2026-08-07

Operator runbook for the `rankme-site-scoping` release. Brand Radar scans move
from account-scoped to site-scoped: `BrandRadarScan.siteId` becomes
`required: true`, the create/preview/list routes move under
`/api/sites/:siteId/brand-radar/*`, and the four relocated tools
(Brand Radar, Keyword Clusters, Cannibalization, Internal Links) leave the
sidebar for the site workspace.

Every shipped scan today carries `siteId: null` — the field was unreachable
from the API, so 100% of production rows are legacy. **The backfill must run
against the OLD images, before the new ones deploy.** The old code tolerates a
set `siteId` (it reads the field and serializes it); the new code cannot
hydrate or `save()` a document without one.

## Order is load-bearing

### 1. Backfill the legacy scans (old images still serving)

Production `api` / `worker` images are bundled `dist` on a read-only rootfs
with no `node_modules`, so they cannot execute `tsx`. Run the backfill from a
throwaway `node:20` container attached to the compose network, with the new
checkout and the host `node_modules` mounted (same pattern as the prior GSC
backfill):

```bash
cd /path/to/rankme.fast
docker run --rm -it \
  --network rankme_rankme \
  -v "$PWD":/repo -w /repo/server \
  --env-file /path/to/rankme.fast/.env \
  -e MONGODB_URI='mongodb://mongo:27017/rankme' \
  -e DATABASE_URL='postgres://rankme:<password>@postgres:5432/rankme' \
  node:20-bookworm \
  node --import tsx --input-type=module -e "
    import mongoose from 'mongoose';
    import { db, closeDb } from './src/db/client.ts';
    import { logger } from './src/config/logger.ts';
    import { runBackfillBrandRadarSiteCli } from './src/scripts/run-backfill-brand-radar-site.ts';
    await runBackfillBrandRadarSiteCli({
      mongoose, mongoUri: process.env.MONGODB_URI, db, closeDb, logger,
    });
  "
```

Record the reported counts:

```
{ assignedScans, purgedScans, purgedMentionRows, purgedSummaryRows,
  purgedEventRows, accountsAssigned, accountsPurged }
```

The script logs counts only — no brand query, no mention content, no account
email. It is idempotent: the `siteId: null` filter self-excludes, so a second
run reports all zeros.

Assignment rule: each account's null-sited scans go to its **oldest live site**
(`deletionStartedAt: null`; a paused site still counts as live — pause blocks
new spend, not data linkage). An account with **zero** live sites has its
whole scan graph purged: the scans, their `BrandRadarMention` and
`BrandRadarMentionSummary` rows, and the paired Postgres `brand_radar_events`
rows — exactly what the shipped site/account cascades already delete.

### 2. Verify zero legacy rows remain

```bash
docker compose exec -T mongo mongosh --quiet rankme \
  --eval 'db.brandradarscans.countDocuments({ siteId: null })'
```

Must print `0`. If it does not, re-run step 1 before continuing — deploying
with legacy rows present leaves documents that the new required-field schema
refuses to `save()` (reconciliation `markFailed` and refund writes are the
paths that would throw).

### 3. Deploy the new images

```bash
docker compose up -d --build api worker web
docker compose ps
```

This activates the required `siteId`, the site-nested routes
(`/api/sites/:siteId/brand-radar/{preview,scans}`), and the site workspace
tabs. Old top-level URLs (`/keyword-clusters`, `/cannibalization`,
`/internal-links`, the authed `/brand-radar` workspace) are hard-removed and
fall through to the catch-all 404 — there are no redirect routes by design.
The public marketing `/brand-radar` landing keeps working for everyone.

### 4. Build the new indexes

Production connects with `autoIndex: false` (`config/db.ts`), so the two new
compound indexes never build on boot. Run the synchronizer in the same
throwaway container:

```bash
docker run --rm -it \
  --network rankme_rankme \
  -v "$PWD":/repo -w /repo/server \
  --env-file /path/to/rankme.fast/.env \
  -e MONGODB_URI='mongodb://mongo:27017/rankme' \
  node:20-bookworm \
  node --import tsx --input-type=module -e "
    import mongoose from 'mongoose';
    import { logger } from './src/config/logger.ts';
    import { runSyncIndexesCli } from './src/scripts/run-sync-indexes.ts';
    await runSyncIndexesCli({ mongoose, mongoUri: process.env.MONGODB_URI, logger });
  "
```

Expected new indexes on `brandradarscans`:
`{ accountId, siteId, createdAt: -1, _id: -1 }` (site-filtered list + cursor)
and `{ accountId, siteId, queryHash, createdAt: -1 }` (site-scoped prior-scan
baseline).

## Rollback

Rolling back to the previous images is safe with no data step. The old client
and API cannot create site-nested scans, so they simply stop producing new
rows on the new path; the backfilled data needs no reversal because a set
`siteId` is inert to old code (it reads and serializes the field, and its
list filter already accepted non-null site ids).

The one irreversible part is step 1's purge branch — scans belonging to
accounts with zero live sites are deleted. Those accounts have no site
workspace to reach Brand Radar from under the new navigation, so the rows were
unreachable either way. Capture the pre-run counts if a record is needed.

## Post-deploy checks

- One Agency (or Brand Radar add-on) canary account: open
  `/sites/<siteId>?tab=brand-radar`, run a preview, then one scan. Expect the
  spend preview, the `202`, and a settled scan in the site's list.
- A second site on the same account must NOT list the first site's scans.
- Weekly Pulse brand deltas now cover only the pulse run's site; the digest
  scope note says so.
- Superadmin → Queues: `brand-radar` job count and dead-letter count must not
  rise above the pre-deploy baseline.
