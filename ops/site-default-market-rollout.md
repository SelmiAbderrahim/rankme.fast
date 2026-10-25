# Site default market rollout

Each site stores a default country, language, and device. New sites infer a starting value from their country domain, public page language, and the account interface language. An owner can select a different supported market at any time.

Existing sites have no stored default until the owner chooses one or the backfill runs. The backfill reads only stored domains, account languages, and an offline country catalog. It makes no network request and does not replace an owner choice. No Drizzle migration is needed because this field is in MongoDB.

## Run order

1. Deploy the API and web changes and verify their health checks.
2. Run the backfill with `DRY_RUN=1`. Record only the four summary counts.
3. Run it with `DRY_RUN=0`, then repeat. The second pass should report `updated: 0`.
4. Check that `errors: 0` and verify a few sites from different countries through the Sites page. The stored `source` should be `inferred`; an owner edit changes it to `owner`.

Use an isolated maintenance environment with a database URI supplied by the operator. This example runs from the checkout's `server` directory and does not read an application environment file:

```bash
cd server
DRY_RUN=1 MONGODB_URI='<maintenance MongoDB URI>' node --import tsx --input-type=module -e "
  import mongoose from 'mongoose';
  import pino from 'pino';
  import { offlineSiteMarketCatalog } from './src/modules/sites/site-market.ts';
  import { runBackfillSiteMarkets } from './src/scripts/run-backfill-site-markets.ts';

  const dryRun = process.env.DRY_RUN === '1';
  const result = await runBackfillSiteMarkets({
    mongoose,
    mongoUri: process.env.MONGODB_URI,
    catalog: offlineSiteMarketCatalog(),
    dryRun,
    logger: pino({ level: 'info' }),
  });
  console.log(JSON.stringify({ dryRun, ...result }));
"
```

Change only `DRY_RUN` for the write pass. The guarded update checks that `defaultMarket` is still empty, so an owner choice made while the backfill runs wins. A failed site remains eligible for a later pass. The log records site IDs and error classes, not site addresses or account details.
