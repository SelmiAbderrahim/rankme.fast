import { and, desc, eq, lt } from 'drizzle-orm';
import { gscSearchAnalytics } from '../../../db/schema/gsc.js';
import { buildObservationMeta } from '../../../shared/observations/observations.js';
import type { SourceReader, SourceReaderContext } from '../actions.registry.js';
import type { CandidateAction } from '../actions.types.js';
import { declineBand, declineSeverity, firstPartyImpactFromBaseline, } from '../actions.orders.js';
import { canonicalizeAffectedUrls } from './url.js';
import { Site } from '../../sites/index.js';
// The `page` dimension set is the canonical decline surface: its per-row keys
// are page URLs (affected-URL evidence for free) and its summed clicks match
// the 28-day report totals the user already sees. Emitting per-dimension-set
// duplicates of the same decline is exactly what the locked
// `dimensionSet:snapshotDate:baselineSnapshotDate:metric` identity forbids.
const GSC_DECLINE_DIMENSION = 'page';
const GSC_DECLINE_WINDOW_DAYS = 28;
// Locked inclusion thresholds: baseline ≥ 20 clicks AND decline
// ≥ 20 percent. Below either bound: NO action — never a zero.
const GSC_MIN_BASELINE_CLICKS = 20;
const GSC_MIN_DECLINE_PCT = 20;
function snapshotDateToIso(snapshotDate: string): string {
    return `${snapshotDate}T00:00:00.000Z`;
}
async function readSnapshotRows(ctx: SourceReaderContext, snapshotDate: string, bindingGenerationId: string): Promise<Array<{
    dimensionKey: string;
    clicks: number;
}>> {
    return await ctx.db
        .select({
        dimensionKey: gscSearchAnalytics.dimensionKey,
        clicks: gscSearchAnalytics.clicks,
    })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.accountId, ctx.accountId), eq(gscSearchAnalytics.siteId, ctx.siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, GSC_DECLINE_DIMENSION), eq(gscSearchAnalytics.windowDays, GSC_DECLINE_WINDOW_DAYS), eq(gscSearchAnalytics.snapshotDate, snapshotDate)));
}
// Locked contract: a `gsc_decline` action
// exists only when comparable 28-day snapshots show a prior baseline of at
// least 20 clicks and current clicks declined by at least 20 percent.
// Missing or incomparable data emits no action — absence is never zero.
//
// The snapshot store is queried directly (deep schema import, reference:
// audience-research.adapter.ts) so every read is explicitly account+site
// scoped; the gsc-snapshots read helpers filter by site only.
//
// Deterministic mapping (no AI, all three locked helpers):
//   - severity          = declineSeverity(pct)  (≥40% critical, else warning);
//   - confidence        = declineBand(pct)      (≥40 high / 25–39.99 medium /
//                         20–24.99 low) — the band IS the strength of the
//                         decline signal;
//   - firstPartyImpact  = firstPartyImpactFromBaseline(baseline clicks);
//   - effort            = 'medium' (locked source default for analytics).
export const gscActionAdapter: SourceReader = async (ctx) => {
    const site = await Site.findOne({
        _id: ctx.siteId,
        accountId: ctx.accountId,
        deletionStartedAt: null,
    })
        .select('gscPropertyUrl gscBindingGenerationId')
        .lean();
    if (!site?.gscPropertyUrl)
        return { actions: [], status: 'available' };
    const bindingGenerationId = site.gscBindingGenerationId ?? 'legacy';
    const scope = and(eq(gscSearchAnalytics.accountId, ctx.accountId), eq(gscSearchAnalytics.siteId, ctx.siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, GSC_DECLINE_DIMENSION), eq(gscSearchAnalytics.windowDays, GSC_DECLINE_WINDOW_DAYS));
    const latestRows = await ctx.db
        .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics)
        .where(scope)
        .orderBy(desc(gscSearchAnalytics.snapshotDate))
        .limit(1);
    const latestDate = latestRows[0]?.snapshotDate;
    if (latestDate === undefined) {
        return { actions: [], status: 'available' };
    }
    const lastObservedAt = snapshotDateToIso(latestDate);
    const baselineRows = await ctx.db
        .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics)
        .where(and(scope, lt(gscSearchAnalytics.snapshotDate, latestDate)))
        .orderBy(desc(gscSearchAnalytics.snapshotDate))
        .limit(1);
    const baselineDate = baselineRows[0]?.snapshotDate;
    if (baselineDate === undefined) {
        // First snapshot ever — nothing comparable yet.
        return { actions: [], status: 'available', lastObservedAt };
    }
    const [currentRows, baselinePageRows] = await Promise.all([
        readSnapshotRows(ctx, latestDate, bindingGenerationId),
        readSnapshotRows(ctx, baselineDate, bindingGenerationId),
    ]);
    const currentClicks = currentRows.reduce((sum, row) => sum + row.clicks, 0);
    const baselineClicks = baselinePageRows.reduce((sum, row) => sum + row.clicks, 0);
    if (baselineClicks < GSC_MIN_BASELINE_CLICKS) {
        return { actions: [], status: 'available', lastObservedAt };
    }
    const declinePct = ((baselineClicks - currentClicks) / baselineClicks) * 100;
    if (declinePct < GSC_MIN_DECLINE_PCT) {
        return { actions: [], status: 'available', lastObservedAt };
    }
    // Affected URLs = the pages that lost clicks between the two snapshots,
    // biggest loss first. A page absent from the current snapshot lost every
    // click it had (Search Console omits zero rows), so baseline-only pages
    // count as fully declined for evidence-listing purposes.
    const currentByKey = new Map(currentRows.map((row) => [row.dimensionKey, row.clicks]));
    const decliningPages = baselinePageRows
        .map((row) => ({
        url: row.dimensionKey,
        lost: row.clicks - (currentByKey.get(row.dimensionKey) ?? 0),
    }))
        .filter((page) => page.lost > 0)
        .sort((a, b) => (a.lost !== b.lost ? b.lost - a.lost : a.url < b.url ? -1 : 1));
    const sourceId = `${GSC_DECLINE_DIMENSION}:${latestDate}:${baselineDate}:clicks`;
    const action: CandidateAction = {
        sourceType: 'gsc_decline',
        sourceId,
        affectedUrls: canonicalizeAffectedUrls(decliningPages.map((p) => p.url)),
        evidence: [
            {
                sourceRef: sourceId,
                observation: buildObservationMeta({
                    sourceKind: 'first_party',
                    observedAt: lastObservedAt,
                }),
            },
        ],
        severity: declineSeverity(declinePct),
        firstPartyImpact: firstPartyImpactFromBaseline(baselineClicks),
        confidence: declineBand(declinePct),
        effort: 'medium',
        sourceState: 'open',
        observedAt: lastObservedAt,
        lastVerifiedAt: lastObservedAt,
        retestAvailable: false,
        retestReasonKey: 'actions.errors.retestUnsupported',
        copyKeys: {
            problem: 'actions.gscDecline.problem',
            whyItMatters: 'actions.gscDecline.whyItMatters',
            nextStep: 'actions.gscDecline.nextStep',
        },
        copyVars: {
            declinePct: Math.round(declinePct),
            currentClicks,
            baselineClicks,
        },
    };
    return { actions: [action], status: 'available', lastObservedAt };
};
