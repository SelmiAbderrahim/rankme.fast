/**
 * Weekly Pulse — Brand Radar deltas.
 *
 * Weekly Pulse is SITE-scoped — a run is keyed `(siteId, isoWeek)`. Brand
 * Radar is SITE-scoped too: every scan carries a
 * required `siteId`, set by the site workspace tab that created it. This
 * section therefore compares only the scans of the PULSE RUN'S OWN SITE,
 * grouped by `queryHash`, and is emitted per tracked brand query. A sibling
 * site's scans never appear. The digest copy says so
 * (`weeklyPulse.brandDeltas.scopeNote`) so a reader is not misled.
 *
 * This module is PURE and port-injected exactly like `collection.service.ts`:
 * it performs no IO of its own, and the path it drives is provably
 * read-only — no queue `add`, no `captureVendorCost`,
 * no provider call. Reading stored scans never schedules a new one.
 *
 * Honesty rules (machine-checked in `brand-deltas.service.test.ts`):
 *   • Deltas are `current − previous` (mention count as an integer,
 *     sentiment in whole percentage points).
 *   • No comparison baseline → `previousScanId === null` and BOTH delta
 *     fields are `null`, never `0`.
 *   • No settled scan inside the window for a query → `hasNewScan: false`
 *     and no fabricated delta; an account that never scanned emits nothing.
 */
import type { BrandRadarSentimentDistribution } from '../brand-radar/index.js';
/** Comparison window used by the pulse: the seven days before the run tick. */
export const WEEKLY_PULSE_BRAND_DELTA_WINDOW_DAYS = 7;
export const WEEKLY_PULSE_BRAND_DELTA_WINDOW_MS = WEEKLY_PULSE_BRAND_DELTA_WINDOW_DAYS * 24 * 60 * 60 * 1000;
// ---------------------------------------------------------------------------
// Port surface
// ---------------------------------------------------------------------------
/** Bounded, safe facts about one settled Brand Radar scan. */
export interface BrandRadarScanFacts {
    readonly scanId: string;
    readonly queryHash: string;
    /** Stored (trimmed, ≤200 chars) brand query. Never logged. */
    readonly brandQuery: string;
    readonly mentionCount: number;
    readonly sentimentDistribution: BrandRadarSentimentDistribution;
    readonly terminalAt: Date;
}
export interface LoadBrandRadarScansInput {
    readonly accountId: string;
    /** The pulse run's site — the scan reads are filtered to it. */
    readonly siteId: string;
    readonly windowStart: Date;
    readonly windowEnd: Date;
}
export interface BrandRadarScanWindow {
    /** Settled scans whose `terminalAt` falls inside [windowStart, windowEnd]. */
    readonly inWindow: readonly BrandRadarScanFacts[];
    /** Latest settled scan strictly BEFORE `windowStart`, per `queryHash`. */
    readonly baselines: readonly BrandRadarScanFacts[];
}
export interface BrandDeltaPorts {
    loadBrandRadarScans(input: LoadBrandRadarScansInput): Promise<BrandRadarScanWindow>;
}
export interface BrandDeltaPortsDeps {
    readonly ports: BrandDeltaPorts;
}
// ---------------------------------------------------------------------------
// Emitted shape
// ---------------------------------------------------------------------------
export interface BrandDeltaEntry {
    readonly queryHash: string;
    readonly brandQuerySafe: string;
    readonly currentScanId: string;
    readonly previousScanId: string | null;
    readonly hasNewScan: boolean;
    readonly newMentionCount: number | null;
    readonly sentimentShift: BrandRadarSentimentDistribution | null;
}
// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------
/**
 * Read the account's stored Brand Radar scans through the injected port and
 * project the per-query deltas. Zero spend by construction.
 */
export async function computeBrandDeltas(deps: BrandDeltaPortsDeps, input: LoadBrandRadarScansInput): Promise<BrandDeltaEntry[]> {
    const window = await deps.ports.loadBrandRadarScans(input);
    return projectBrandDeltas(window);
}
/** Pure projection — deterministic given the loaded window. */
export function projectBrandDeltas(window: BrandRadarScanWindow): BrandDeltaEntry[] {
    const inWindowGroups = groupByQueryHash(window.inWindow);
    const baselineGroups = groupByQueryHash(window.baselines);
    const entries: BrandDeltaEntry[] = [];
    for (const [queryHash, list] of inWindowGroups) {
        // `list` is non-empty by construction of `groupByQueryHash`.
        const current = list.reduce(pickLater);
        const earlier = list.filter((scan) => scan.scanId !== current.scanId);
        const baselineList = baselineGroups.get(queryHash);
        const previous = earlier.length > 0
            ? earlier.reduce(pickLater)
            : baselineList === undefined
                ? null
                : baselineList.reduce(pickLater);
        entries.push({
            queryHash,
            brandQuerySafe: current.brandQuery,
            currentScanId: current.scanId,
            previousScanId: previous === null ? null : previous.scanId,
            hasNewScan: true,
            newMentionCount: previous === null ? null : current.mentionCount - previous.mentionCount,
            sentimentShift: previous === null
                ? null
                : shiftPoints(current.sentimentDistribution, previous.sentimentDistribution),
        });
    }
    for (const [queryHash, list] of baselineGroups) {
        if (inWindowGroups.has(queryHash))
            continue;
        // No settled scan inside the window for this query — the honest
        // "no new scan this period" branch. Never a fabricated zero.
        const known = list.reduce(pickLater);
        entries.push({
            queryHash,
            brandQuerySafe: known.brandQuery,
            currentScanId: known.scanId,
            previousScanId: null,
            hasNewScan: false,
            newMentionCount: null,
            sentimentShift: null,
        });
    }
    entries.sort((a, b) => {
        const byQuery = a.brandQuerySafe.localeCompare(b.brandQuerySafe);
        if (byQuery !== 0)
            return byQuery;
        return a.queryHash.localeCompare(b.queryHash);
    });
    return entries;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function groupByQueryHash(scans: readonly BrandRadarScanFacts[]): Map<string, BrandRadarScanFacts[]> {
    const groups = new Map<string, BrandRadarScanFacts[]>();
    for (const scan of scans) {
        const list = groups.get(scan.queryHash);
        if (list === undefined)
            groups.set(scan.queryHash, [scan]);
        else
            list.push(scan);
    }
    return groups;
}
/** Latest by `terminalAt`, tie-broken by `scanId` ascending. */
function compareScans(a: BrandRadarScanFacts, b: BrandRadarScanFacts): number {
    const at = a.terminalAt.getTime();
    const bt = b.terminalAt.getTime();
    if (at !== bt)
        return at < bt ? -1 : 1;
    return a.scanId < b.scanId ? -1 : 1;
}
function pickLater(a: BrandRadarScanFacts, b: BrandRadarScanFacts): BrandRadarScanFacts {
    return compareScans(a, b) >= 0 ? a : b;
}
/** Four-way sentiment shift in whole percentage points (`current − previous`). */
function shiftPoints(current: BrandRadarSentimentDistribution, previous: BrandRadarSentimentDistribution): BrandRadarSentimentDistribution {
    return {
        positive: current.positive - previous.positive,
        neutral: current.neutral - previous.neutral,
        negative: current.negative - previous.negative,
        unknown: current.unknown - previous.unknown,
    };
}
