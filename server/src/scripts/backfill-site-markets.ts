import type { Logger } from 'pino';
import type { Site } from '../modules/sites/sites.model.js';
import { inferSiteMarket, type CatalogMarket } from '../modules/sites/site-market.js';

export interface BackfillSiteMarketsResult {
    inspected: number;
    updated: number;
    unchanged: number;
    errors: number;
}

export interface BackfillSiteMarketsDeps {
    siteModel: typeof Site;
    catalog: readonly CatalogMarket[];
    accountLocale: (accountId: string) => Promise<string | null>;
    dryRun?: boolean;
    logger?: Logger;
}

/** Idempotent stored-data repair. It never probes pages or calls a vendor. */
export async function backfillSiteMarkets(deps: BackfillSiteMarketsDeps): Promise<BackfillSiteMarketsResult> {
    const result: BackfillSiteMarketsResult = { inspected: 0, updated: 0, unchanged: 0, errors: 0 };
    const sites = await deps.siteModel.find({ deletionStartedAt: null })
        .select('_id accountId domain defaultMarket').lean();
    for (const site of sites) {
        result.inspected += 1;
        if (site.defaultMarket) {
            result.unchanged += 1;
            continue;
        }
        try {
            const inferred = inferSiteMarket({
                domain: site.domain,
                catalog: deps.catalog,
                accountLocale: await deps.accountLocale(String(site.accountId)),
            });
            if (deps.dryRun) {
                result.updated += 1;
                continue;
            }
            const write = await deps.siteModel.updateOne(
                { _id: site._id, defaultMarket: null },
                { $set: { defaultMarket: { ...inferred, source: 'inferred' } } },
            );
            if (write.modifiedCount === 1) result.updated += 1;
            else result.unchanged += 1;
        }
        catch (error) {
            result.errors += 1;
            deps.logger?.warn({ siteId: String(site._id), failure: error instanceof Error ? error.name : 'unknown' },
                'site market backfill failed for one site');
        }
    }
    deps.logger?.info({ ...result, dryRun: deps.dryRun === true }, 'site market backfill complete');
    return result;
}
