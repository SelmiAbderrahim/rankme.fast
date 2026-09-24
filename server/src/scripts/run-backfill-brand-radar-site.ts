// CLI runner for the one-shot Brand Radar site backfill.
//
// Composed for testability exactly like `run-sync-indexes.ts`: the connect →
// backfill → disconnect steps are wired through
// `runBackfillBrandRadarSiteCli(deps)` so the runner is exercised end-to-end
// against injected handles and needs no coverage exclusion.
//
// Production api/worker images are bundled `dist` on a read-only rootfs with no
// node_modules, so this never runs inside them. See
// `ops/brand-radar-site-scoping-rollout.md` for the throwaway-container
// invocation and the deploy-window ordering.
import type { Mongoose } from 'mongoose';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import { BrandRadarScan } from '../modules/brand-radar/brand-radar.model.js';
import { BrandRadarMention, BrandRadarMentionSummary, } from '../modules/brand-radar/brand-radar.rows.model.js';
import { Site } from '../modules/sites/sites.model.js';
import { backfillBrandRadarSite, type BackfillBrandRadarSiteResult, } from './backfill-brand-radar-site.js';
export interface RunBackfillBrandRadarSiteDeps {
    mongoose: Mongoose;
    mongoUri: string;
    db: Db;
    closeDb: () => Promise<void>;
    logger: Logger;
}
export async function runBackfillBrandRadarSiteCli(deps: RunBackfillBrandRadarSiteDeps): Promise<BackfillBrandRadarSiteResult> {
    await deps.mongoose.connect(deps.mongoUri);
    try {
        const result = await backfillBrandRadarSite({
            db: deps.db,
            scanModel: BrandRadarScan,
            mentionModel: BrandRadarMention,
            mentionSummaryModel: BrandRadarMentionSummary,
            siteModel: Site,
        });
        // Counts only — never a brand query, a mention snippet, or an account email.
        deps.logger.info(result, 'brand-radar site backfill complete');
        return result;
    }
    finally {
        await deps.mongoose.disconnect();
        await deps.closeDb();
    }
}
