import { and, desc, eq, lt } from 'drizzle-orm';
import { ga4Metrics } from '../../../db/schema/ga4-metrics.js';
import { buildObservationMeta } from '../../../shared/observations/observations.js';
import type { SourceReader, SourceReaderContext } from '../actions.registry.js';
import type { ActionEvidence, CandidateAction } from '../actions.types.js';
import { Site } from '../../sites/index.js';
import { declineSeverity, declineBand, firstPartyImpactFromBaseline, type Confidence, } from '../actions.orders.js';
// The `channel` dimension set carries the organic split — its row keys are
// GA4 default channel groups and "Organic Search" is the fixed label GA4
// assigns to organic traffic.
const GA4_DECLINE_DIMENSION = 'channel';
const GA4_DECLINE_WINDOW_DAYS = 28;
const GA4_ORGANIC_CHANNEL_KEY = 'Organic Search';
// Locked inclusion thresholds: organic sessions baseline ≥ 20,
// key events baseline ≥ 5, decline ≥ 20 percent for both. Below either
// bound: NO action — never a zero.
const GA4_MIN_ORGANIC_BASELINE = 20;
const GA4_MIN_KEY_EVENTS_BASELINE = 5;
const GA4_MIN_DECLINE_PCT = 20;
function snapshotDateToIso(snapshotDate: string): string {
    return `${snapshotDate}T00:00:00.000Z`;
}
interface Ga4ChannelRow {
    dimensionKey: string;
    sessions: number;
    keyEvents: number;
}
async function readChannelRows(ctx: SourceReaderContext, snapshotDate: string, bindingGenerationId: string): Promise<Ga4ChannelRow[]> {
    return await ctx.db
        .select({
        dimensionKey: ga4Metrics.dimensionKey,
        sessions: ga4Metrics.sessions,
        keyEvents: ga4Metrics.keyEvents,
    })
        .from(ga4Metrics)
        .where(and(eq(ga4Metrics.accountId, ctx.accountId), eq(ga4Metrics.siteId, ctx.siteId), eq(ga4Metrics.bindingGenerationId, bindingGenerationId), eq(ga4Metrics.dimensionSet, GA4_DECLINE_DIMENSION), eq(ga4Metrics.windowDays, GA4_DECLINE_WINDOW_DAYS), eq(ga4Metrics.snapshotDate, snapshotDate)));
}
interface Ga4DeclineCandidateInput {
    metric: 'organic_sessions' | 'key_events';
    latestDate: string;
    baselineDate: string;
    baseline: number;
    declinePct: number;
    confidence: Confidence;
    copyPrefix: 'actions.ga4Decline.organic' | 'actions.ga4Decline.keyEvents';
    copyVars: Record<string, number>;
}
function buildGa4Candidate(input: Ga4DeclineCandidateInput): CandidateAction {
    const observedAt = snapshotDateToIso(input.latestDate);
    const sourceId = `${GA4_DECLINE_DIMENSION}:${input.latestDate}:${input.baselineDate}:${input.metric}`;
    const evidence: ActionEvidence[] = [
        {
            sourceRef: sourceId,
            observation: buildObservationMeta({
                sourceKind: 'first_party',
                observedAt,
            }),
        },
    ];
    return {
        sourceType: 'ga4_decline',
        sourceId,
        affectedUrls: [],
        evidence,
        severity: declineSeverity(input.declinePct),
        firstPartyImpact: firstPartyImpactFromBaseline(input.baseline),
        confidence: input.confidence,
        effort: 'medium',
        sourceState: 'open',
        observedAt,
        lastVerifiedAt: observedAt,
        retestAvailable: false,
        retestReasonKey: 'actions.errors.retestUnsupported',
        copyKeys: {
            problem: `${input.copyPrefix}.problem`,
            whyItMatters: `${input.copyPrefix}.whyItMatters`,
            nextStep: `${input.copyPrefix}.nextStep`,
        },
        copyVars: { declinePct: Math.round(input.declinePct), ...input.copyVars },
    };
}
// Locked contract: GA4 emits a decline action
// for organic sessions when the baseline is at least 20 and the decline is at
// least 20 percent, or for key events when the baseline is at least five and
// the decline is at least 20 percent. Missing/incomparable data emits no
// action — absence is never inferred as zero, so the organic comparison
// requires the "Organic Search" row to be present in BOTH snapshots.
//
// The snapshot store is queried directly (deep schema import, reference:
// audience-research.adapter.ts) so every read is explicitly account+site
// scoped; the ga4-snapshots read helpers filter by site only.
//
// Deterministic mapping (no AI, locked helpers):
//   - severity         = declineSeverity(pct);
//   - confidence       = declineBand(pct) for organic sessions; fixed 'high'
//                        for key events (locked: key-event decline is high);
//   - firstPartyImpact = firstPartyImpactFromBaseline(baseline volume);
//   - effort           = 'medium' (locked source default for analytics).
export const ga4ActionAdapter: SourceReader = async (ctx) => {
    const site = await Site.findOne({
        _id: ctx.siteId,
        accountId: ctx.accountId,
        deletionStartedAt: null,
    })
        .select('ga4PropertyId ga4BindingGenerationId')
        .lean();
    if (!site?.ga4PropertyId)
        return { actions: [], status: 'available' };
    const bindingGenerationId = site.ga4BindingGenerationId ?? 'legacy';
    const scope = and(eq(ga4Metrics.accountId, ctx.accountId), eq(ga4Metrics.siteId, ctx.siteId), eq(ga4Metrics.bindingGenerationId, bindingGenerationId), eq(ga4Metrics.dimensionSet, GA4_DECLINE_DIMENSION), eq(ga4Metrics.windowDays, GA4_DECLINE_WINDOW_DAYS));
    const latestRows = await ctx.db
        .select({ snapshotDate: ga4Metrics.snapshotDate })
        .from(ga4Metrics)
        .where(scope)
        .orderBy(desc(ga4Metrics.snapshotDate))
        .limit(1);
    const latestDate = latestRows[0]?.snapshotDate;
    if (latestDate === undefined) {
        return { actions: [], status: 'available' };
    }
    const lastObservedAt = snapshotDateToIso(latestDate);
    const baselineRows = await ctx.db
        .select({ snapshotDate: ga4Metrics.snapshotDate })
        .from(ga4Metrics)
        .where(and(scope, lt(ga4Metrics.snapshotDate, latestDate)))
        .orderBy(desc(ga4Metrics.snapshotDate))
        .limit(1);
    const baselineDate = baselineRows[0]?.snapshotDate;
    if (baselineDate === undefined) {
        return { actions: [], status: 'available', lastObservedAt };
    }
    const [currentRows, baselineChannelRows] = await Promise.all([
        readChannelRows(ctx, latestDate, bindingGenerationId),
        readChannelRows(ctx, baselineDate, bindingGenerationId),
    ]);
    const actions: CandidateAction[] = [];
    // Organic sessions — requires the organic row in BOTH snapshots.
    const organicCurrent = currentRows.find((row) => row.dimensionKey === GA4_ORGANIC_CHANNEL_KEY);
    const organicBaseline = baselineChannelRows.find((row) => row.dimensionKey === GA4_ORGANIC_CHANNEL_KEY);
    if (organicCurrent !== undefined &&
        organicBaseline !== undefined &&
        organicBaseline.sessions >= GA4_MIN_ORGANIC_BASELINE) {
        const declinePct = ((organicBaseline.sessions - organicCurrent.sessions) /
            organicBaseline.sessions) *
            100;
        if (declinePct >= GA4_MIN_DECLINE_PCT) {
            actions.push(buildGa4Candidate({
                metric: 'organic_sessions',
                latestDate,
                baselineDate,
                baseline: organicBaseline.sessions,
                declinePct,
                confidence: declineBand(declinePct),
                copyPrefix: 'actions.ga4Decline.organic',
                copyVars: {
                    currentSessions: organicCurrent.sessions,
                    baselineSessions: organicBaseline.sessions,
                },
            }));
        }
    }
    // Key events — site-wide totals across every channel row of the snapshot.
    const keyEventsCurrent = currentRows.reduce((sum, row) => sum + row.keyEvents, 0);
    const keyEventsBaseline = baselineChannelRows.reduce((sum, row) => sum + row.keyEvents, 0);
    if (keyEventsBaseline >= GA4_MIN_KEY_EVENTS_BASELINE) {
        const declinePct = ((keyEventsBaseline - keyEventsCurrent) / keyEventsBaseline) * 100;
        if (declinePct >= GA4_MIN_DECLINE_PCT) {
            actions.push(buildGa4Candidate({
                metric: 'key_events',
                latestDate,
                baselineDate,
                baseline: keyEventsBaseline,
                declinePct,
                confidence: 'high',
                copyPrefix: 'actions.ga4Decline.keyEvents',
                copyVars: {
                    currentKeyEvents: keyEventsCurrent,
                    baselineKeyEvents: keyEventsBaseline,
                },
            }));
        }
    }
    return { actions, status: 'available', lastObservedAt };
};
