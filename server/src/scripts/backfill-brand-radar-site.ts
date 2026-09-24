/**
 * One-shot, idempotent backfill assigning every legacy account-scoped Brand
 * Radar scan to a site.
 *
 * Brand Radar shipped with `BrandRadarScan.siteId` reachable only from code
 * that had no production caller, so every shipped scan carries `siteId: null`.
 * Site scoping makes the field required, which means the legacy rows must be
 * resolved BEFORE the new images deploy:
 *
 *   • An account with at least one live site (`deletionStartedAt: null`;
 *     paused counts as live — pause blocks new spend, not data linkage) has
 *     its null-sited scans assigned to its OLDEST such site.
 *   • An account with zero live sites has the whole scan graph purged — the
 *     scans, their mention rows and mention summaries, and the paired
 *     Postgres `brand_radar_events` rows — mirroring exactly what the shipped
 *     site/account cascades already delete.
 *
 * Safe to re-run: the `siteId: null` filter self-excludes every row a previous
 * run already handled, so a second pass reports all-zero counts.
 *
 * Usage — see `ops/brand-radar-site-scoping-rollout.md` for the deploy-window
 * sequence (this must run against the OLD images, before deploy).
 */
import { inArray } from 'drizzle-orm';
import type { Types } from 'mongoose';
import type { Db } from '../db/client.js';
import { brandRadarEvents } from '../db/schema/brand-radar-events.js';
import type { BrandRadarScan } from '../modules/brand-radar/brand-radar.model.js';
import type { BrandRadarMention, BrandRadarMentionSummary, } from '../modules/brand-radar/brand-radar.rows.model.js';
import type { Site } from '../modules/sites/sites.model.js';
export interface BackfillBrandRadarSiteResult {
    /** Legacy scans re-pointed at their account's oldest live site. */
    assignedScans: number;
    /** Legacy scans deleted because the account has no live site left. */
    purgedScans: number;
    purgedMentionRows: number;
    purgedSummaryRows: number;
    purgedEventRows: number;
    accountsAssigned: number;
    accountsPurged: number;
}
/**
 * Every handle the backfill touches is injected: the CLI runner passes the
 * production models and the Drizzle client, the test passes the same ones
 * bound to the in-memory Mongo + PGlite harnesses.
 */
export interface BackfillBrandRadarSiteDeps {
    db: Db;
    scanModel: typeof BrandRadarScan;
    mentionModel: typeof BrandRadarMention;
    mentionSummaryModel: typeof BrandRadarMentionSummary;
    siteModel: typeof Site;
}
const EMPTY_RESULT: BackfillBrandRadarSiteResult = {
    assignedScans: 0,
    purgedScans: 0,
    purgedMentionRows: 0,
    purgedSummaryRows: 0,
    purgedEventRows: 0,
    accountsAssigned: 0,
    accountsPurged: 0,
};
export async function backfillBrandRadarSite(deps: BackfillBrandRadarSiteDeps): Promise<BackfillBrandRadarSiteResult> {
    const result: BackfillBrandRadarSiteResult = { ...EMPTY_RESULT };
    const accountIds = (await deps.scanModel.distinct('accountId', {
        siteId: null,
    })) as Types.ObjectId[];
    for (const accountId of accountIds) {
        const site = (await deps.siteModel
            .findOne({ accountId, deletionStartedAt: null })
            .sort({ createdAt: 1, _id: 1 })
            .select({ _id: 1 })
            .lean()) as {
            _id: Types.ObjectId;
        } | null;
        if (site) {
            const updated = await deps.scanModel.updateMany({ accountId, siteId: null }, { $set: { siteId: site._id } });
            result.assignedScans += updated.modifiedCount;
            result.accountsAssigned += 1;
            continue;
        }
        // Zero live sites: the scan graph has nothing to belong to. `accountIds`
        // came from a `siteId: null` distinct, so this list is never empty.
        const orphans = (await deps.scanModel
            .find({ accountId, siteId: null }, { _id: 1 })
            .lean()) as {
            _id: Types.ObjectId;
        }[];
        const scanIds = orphans.map((scan) => scan._id);
        const scanIdHexes = scanIds.map(String);
        const mentions = await deps.mentionModel.deleteMany({
            scanId: { $in: scanIds },
        });
        const summaries = await deps.mentionSummaryModel.deleteMany({
            scanId: { $in: scanIds },
        });
        const events = await deps.db
            .delete(brandRadarEvents)
            .where(inArray(brandRadarEvents.scanId, scanIdHexes))
            .returning({ id: brandRadarEvents.id });
        const scans = await deps.scanModel.deleteMany({ _id: { $in: scanIds } });
        result.purgedMentionRows += mentions.deletedCount;
        result.purgedSummaryRows += summaries.deletedCount;
        result.purgedEventRows += events.length;
        result.purgedScans += scans.deletedCount;
        result.accountsPurged += 1;
    }
    return result;
}
