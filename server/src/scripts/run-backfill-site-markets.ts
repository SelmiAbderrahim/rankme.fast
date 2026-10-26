import type { Mongoose } from 'mongoose';
import type { Logger } from 'pino';
import { Site } from '../modules/sites/sites.model.js';
import { User } from '../modules/users/users.model.js';
import type { CatalogMarket } from '../modules/sites/site-market.js';
import { backfillSiteMarkets, type BackfillSiteMarketsResult } from './backfill-site-markets.js';

export interface RunBackfillSiteMarketsDeps {
    mongoose: Mongoose;
    mongoUri: string;
    catalog: readonly CatalogMarket[];
    dryRun: boolean;
    logger: Logger;
}

export async function storedAccountLocale(accountId: string): Promise<string | null> {
    const user = await User.findById(accountId).select('language').lean();
    return user?.language ?? null;
}

/** Explicitly injected connection and catalog keep the backfill operator-controlled. */
export async function runBackfillSiteMarkets(deps: RunBackfillSiteMarketsDeps): Promise<BackfillSiteMarketsResult> {
    await deps.mongoose.connect(deps.mongoUri);
    try {
        return await backfillSiteMarkets({
            siteModel: Site,
            catalog: deps.catalog,
            accountLocale: storedAccountLocale,
            dryRun: deps.dryRun,
            logger: deps.logger,
        });
    }
    finally {
        await deps.mongoose.disconnect();
    }
}
