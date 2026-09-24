/**
 * Weekly Pulse — Brand Radar scan reader.
 *
 * Thin adapter over the Brand Radar module's PUBLIC API (`BrandRadarScan` +
 * `BRAND_RADAR_SETTLED_STATUSES`) — never a reach into brand-radar
 * internals. Stored-data reads ONLY: no queue `add`, no
 * `captureVendorCost`, no provider call, and no new scan is ever scheduled.
 */
import { BRAND_RADAR_SETTLED_STATUSES, BrandRadarScan, } from '../brand-radar/index.js';
import type { BrandDeltaPorts, BrandRadarScanFacts, BrandRadarScanWindow, LoadBrandRadarScansInput, } from './brand-deltas.service.js';
/**
 * Hard ceiling on the rows either read pulls. Brand scans are paid units, so
 * a single account's settled scans are bounded well below this in practice;
 * the cap exists so a pathological account can never unbound the pulse read.
 */
export const WEEKLY_PULSE_BRAND_SCAN_READ_LIMIT = 500;
interface LeanScanRow {
    _id: unknown;
    queryHash: string;
    brandQuery: string;
    mentionCount: number;
    sentimentDistribution: {
        positive: number;
        neutral: number;
        negative: number;
        unknown: number;
    };
    terminalAt: Date | null;
}
/**
 * Read the SITE's settled scans inside the window plus, per `queryHash`, the
 * most recent settled scan strictly BEFORE the window start. Both filters
 * carry `siteId` so one site's pulse never ingests a
 * sibling site's brand scans.
 */
export async function loadBrandRadarScans(input: LoadBrandRadarScansInput): Promise<BrandRadarScanWindow> {
    const settled = [...BRAND_RADAR_SETTLED_STATUSES];
    const inWindowRows = (await BrandRadarScan.find({
        accountId: input.accountId,
        siteId: input.siteId,
        status: { $in: settled },
        terminalAt: { $gte: input.windowStart, $lte: input.windowEnd },
    })
        .sort({ terminalAt: 1, _id: 1 })
        .limit(WEEKLY_PULSE_BRAND_SCAN_READ_LIMIT)
        .lean()) as unknown as LeanScanRow[];
    const priorRows = (await BrandRadarScan.find({
        accountId: input.accountId,
        siteId: input.siteId,
        status: { $in: settled },
        terminalAt: { $lt: input.windowStart },
    })
        .sort({ terminalAt: -1, _id: -1 })
        .limit(WEEKLY_PULSE_BRAND_SCAN_READ_LIMIT)
        .lean()) as unknown as LeanScanRow[];
    // `priorRows` is newest-first, so the FIRST row seen per hash is that
    // query's baseline. Later (older) rows for the same hash are dropped.
    const baselines: BrandRadarScanFacts[] = [];
    const seen = new Set<string>();
    for (const row of priorRows) {
        if (seen.has(row.queryHash))
            continue;
        seen.add(row.queryHash);
        baselines.push(toFacts(row));
    }
    return { inWindow: inWindowRows.map(toFacts), baselines };
}
/** Ready-to-inject port bag for the processor / renderer. */
export function createBrandRadarScanPort(): BrandDeltaPorts {
    return { loadBrandRadarScans };
}
function toFacts(row: LeanScanRow): BrandRadarScanFacts {
    return {
        scanId: String(row._id),
        queryHash: row.queryHash,
        brandQuery: row.brandQuery,
        mentionCount: row.mentionCount,
        sentimentDistribution: {
            positive: row.sentimentDistribution.positive,
            neutral: row.sentimentDistribution.neutral,
            negative: row.sentimentDistribution.negative,
            unknown: row.sentimentDistribution.unknown,
        },
        // Both queries filter on a `terminalAt` range, so every returned row has
        // one; the schema types the column nullable for the pre-settlement rows
        // those filters exclude.
        terminalAt: row.terminalAt as Date,
    };
}
