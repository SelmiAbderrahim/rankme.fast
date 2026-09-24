# Site-scoped Google connections rollout — 2026-08-20

This release moves Search Console and GA4 resource selections from the shared
Google credential to each Site. The encrypted credential remains account-owned.
The SQL migration preserves existing snapshots under the reserved `legacy`
binding generation; the Mongo backfill assigns safe legacy selections to Sites
and queues unresolved Sites for the ordinary background matcher.

## Order

1. Deploy the new API, worker, and web images. API boot applies Drizzle migration
   `0114_burly_ted_forrester.sql`; wait for both API and worker health checks.
2. Run the Mongo backfill from the new checkout. The new worker must be live
   before this step because queued `google-site-auto-match` jobs use the new job
   contract.
3. Verify no account-level selections remain and run the backfill a second time
   to prove idempotency.

## Run the backfill

Production images are bundled and have no `tsx`, so use a throwaway Node
container attached to the Compose network. Use the root `.env`; do not create a
service-local environment file.

```bash
cd /path/to/rankme.fast
docker run --rm -it \
  --network rankme_rankme \
  -v "$PWD":/repo -w /repo/server \
  --env-file /path/to/rankme.fast/.env \
  -e MONGODB_URI='mongodb://mongo:27017/rankme' \
  -e REDIS_URL='redis://redis:6379' \
  node:20-bookworm \
  node --import tsx --input-type=module -e "
    import mongoose from 'mongoose';
    import { env } from './src/config/env.ts';
    import { logger } from './src/config/logger.ts';
    import {
      createFakeGa4Provider,
      createFakeGscProvider,
    } from './src/shared/providers/fakes.ts';
    import { createGoogleGa4Provider } from './src/shared/providers/google/ga4.ts';
    import { createGoogleGscProvider } from './src/shared/providers/google/gsc.ts';
    import { createQueueConnection, createQueues } from './src/shared/queue/index.ts';
    import {
      resolveAccessToken,
      scheduleGoogleSiteAutoMatch,
      setGscSyncQueue,
    } from './src/modules/google-connections/index.ts';
    import { runBackfillSiteGoogleBindingsCli } from './src/scripts/run-backfill-site-google-bindings.ts';

    const oauth = {
      clientId: env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    };
    const gsc = env.PROVIDER_GSC === 'google'
      ? createGoogleGscProvider({ ...oauth, logger })
      : createFakeGscProvider();
    const ga4 = env.PROVIDER_GA4 === 'google'
      ? createGoogleGa4Provider({ ...oauth, logger })
      : createFakeGa4Provider();
    if (!env.REDIS_URL) throw new Error('REDIS_URL is required for this rollout');
    const redis = createQueueConnection(env.REDIS_URL);
    const queues = createQueues(redis);
    setGscSyncQueue(queues.gscSync);
    try {
      await runBackfillSiteGoogleBindingsCli({
        mongoose,
        mongoUri: env.MONGODB_URI,
        ga4Provider: ga4,
        resolveAccessToken: async (accountId) => ({
          accessToken: await resolveAccessToken(accountId, gsc, logger),
        }),
        scheduleSiteMatch: (accountId, siteId) =>
          scheduleGoogleSiteAutoMatch(accountId, siteId, logger),
        logger,
      });
    } finally {
      setGscSyncQueue(null);
      await queues.close();
      await redis.quit();
    }
  "
```

Record these count-only fields:

```text
normalizedSiteBindings, migratedGscBindings, migratedGa4Bindings,
removedGlobalGscSelections, removedGlobalGa4Selections, queuedSites,
ga4AccountsDeferred
```

`ga4AccountsDeferred` must be zero before considering the rollout complete. A
non-zero value means token refresh or GA4 Admin discovery was unavailable; the
global GA4 selection is deliberately retained so the same command can retry.

## Verify

```bash
docker compose exec -T mongo mongosh --quiet rankme --eval '
  db.googleconnections.countDocuments({
    $or: [
      { propertyUrl: { $type: "string", $ne: "" } },
      { ga4PropertyId: { $type: "string", $ne: "" } }
    ]
  })
'
```

The result must be `0`. Run the backfill command once more; every migration
counter must be zero. Historical Postgres rows remain in place and are visible
only through each Site's current `legacy` generation until that Site switches or
unlinks its resource.
