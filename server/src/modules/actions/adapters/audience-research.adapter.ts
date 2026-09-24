import { and, desc, eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { audienceResearchSignalDecisionEvents } from '../../../db/schema/audience-research-signal-decision-events.js';
import type { ObservationMeta } from '../../../shared/observations/types.js';
// Deep model import (not the audience-research barrel): the barrel re-exports
// decisions.ts, whose deep-link contract points back at this adapter's source
// ids — importing it here would create a module cycle.
import { AudienceResearchRun } from '../../audience-research/audience-research.model.js';
import type { SourceReader } from '../actions.registry.js';
import type { ActionEvidence, CandidateAction } from '../actions.types.js';
// Bounded read: newest accepted decisions first. An account keeps at most a
// handful of accepted product/seo signals per site; 200 is a hard safety lid.
const MAX_ACCEPTED_DECISIONS = 200;
interface RunSignalLean {
    signalId: string;
    title: string;
    confidence: 'high' | 'medium' | 'low';
    citedSourceIds?: readonly string[];
    mostRecentSourceObservedAt?: string | null;
}
interface RunSourceLean {
    sourceId: string;
    canonicalUrl: string;
    observationMeta: ObservationMeta;
}
interface RunLean {
    _id: Types.ObjectId;
    signals?: RunSignalLean[];
    sources?: RunSourceLean[];
}
// Accepted product/seo audience-research signals become Next Actions
// candidates. The immutable audience-research run stays the evidence authority and the
// decision event's persisted `downstreamId` IS the source id — the digest is
// never recomputed here, so the deep link minted at accept time and the listed
// action agree byte-for-byte.
export const audienceResearchActionAdapter: SourceReader = async (ctx) => {
    const events = await ctx.db
        .select()
        .from(audienceResearchSignalDecisionEvents)
        .where(and(eq(audienceResearchSignalDecisionEvents.accountId, ctx.accountId), eq(audienceResearchSignalDecisionEvents.siteId, ctx.siteId), eq(audienceResearchSignalDecisionEvents.decision, 'accepted'), inArray(audienceResearchSignalDecisionEvents.destination, [
        'product',
        'seo',
    ])))
        .orderBy(desc(audienceResearchSignalDecisionEvents.decidedAt))
        .limit(MAX_ACCEPTED_DECISIONS);
    if (events.length === 0) {
        return { actions: [], status: 'available' };
    }
    const runIds = [...new Set(events.map((e) => e.runId))].filter((id) => Types.ObjectId.isValid(id));
    const runs = await AudienceResearchRun.find({
        _id: { $in: runIds },
        accountId: ctx.accountId,
        siteId: ctx.siteId,
    }, { signals: 1, sources: 1 }).lean<RunLean[]>();
    const runById = new Map(runs.map((run) => [String(run._id), run]));
    const actions: CandidateAction[] = [];
    for (const event of events) {
        // The accepted-shape DB check guarantees downstreamId, but the column is
        // nullable — skip defensively instead of emitting an unlinkable action.
        if (!event.downstreamId)
            continue;
        const run = runById.get(event.runId);
        if (!run)
            continue;
        const signal = (run.signals ?? []).find((s) => s.signalId === event.signalId);
        if (!signal)
            continue;
        const citedIds = new Set(signal.citedSourceIds ?? []);
        const evidence: ActionEvidence[] = (run.sources ?? [])
            .filter((source) => citedIds.has(source.sourceId))
            .map((source) => ({
            sourceRef: source.sourceId,
            url: source.canonicalUrl,
            observation: source.observationMeta,
        }));
        actions.push({
            sourceType: 'audience_research',
            sourceId: event.downstreamId,
            affectedUrls: evidence.map((e) => e.url!),
            evidence,
            severity: 'info',
            firstPartyImpact: 'none',
            confidence: signal.confidence,
            effort: 'medium',
            sourceState: 'open',
            observedAt: event.decidedAt.toISOString(),
            lastVerifiedAt: signal.mostRecentSourceObservedAt ?? null,
            retestAvailable: false,
            retestReasonKey: 'actions.errors.retestUnsupported',
            copyKeys: {
                problem: 'actions.audienceResearch.problem',
                whyItMatters: 'actions.audienceResearch.whyItMatters',
                nextStep: 'actions.audienceResearch.nextStep',
            },
            copyVars: { title: signal.title },
        });
    }
    return {
        actions,
        status: 'available',
        lastObservedAt: events[0]!.decidedAt.toISOString(),
    };
};
