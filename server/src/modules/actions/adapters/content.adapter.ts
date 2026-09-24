import { Types } from 'mongoose';
import type { ContentRecommendationState } from '../../../db/schema/content-recommendations.js';
import { buildObservationMeta } from '../../../shared/observations/observations.js';
// Deep model import (reference: audience-research.adapter.ts). The functions
// below come from the content-intelligence PUBLIC barrel — that module has no
// import back into actions, so no cycle exists.
import { ContentAnalysis } from '../../content-intelligence/content-analysis.model.js';
import { CITATION_GAP_RECOMMENDATION_PREFIX, recommendationSchema, } from '../../content-intelligence/index.js';
import type { SourceReader } from '../actions.registry.js';
import type { ActionEvidence, ActionState, CandidateAction, } from '../actions.types.js';
import type { Confidence } from '../actions.orders.js';
import { canonicalizeAffectedUrls } from './url.js';
import { isContentCodeFixEligible } from '../../../shared/code-fix-eligibility.js';
import type { TranslationKey } from '../../../shared/i18n/index.js';
// Bounded read: the newest completed analyses; one analysis (the newest) per
// owned URL is surfaced so a regenerated page never emits near-duplicate
// candidates from older runs.
const MAX_ANALYSES = 20;
// Locked contract: Content Intelligence stays
// the state/history authority. This adapter maps its recommendation state to
// the public action state and NEVER appends `action_events` or mutates CI
// state — the actions service skips the event overlay for both source types
// emitted here, and the state route rejects them with `contentDelegation`.
const CONTENT_STATE_TO_ACTION_STATE: Record<ContentRecommendationState, ActionState> = {
    suggested: 'open',
    accepted: 'planned',
    dismissed: 'dismissed',
    applied: 'completed',
};
// Deterministic confidence tiers from the recommendation's own 0..1 score
// (no AI at list time): ≥0.75 high, ≥0.5 medium, else low.
function confidenceFromScore(score: number): Confidence {
    if (score >= 0.75)
        return 'high';
    if (score >= 0.5)
        return 'medium';
    return 'low';
}
// Surfaces two public source types from the same authority:
//   - `content_recommendation` — every schema-valid recommendation on the
//     newest completed analysis per owned URL, sourceId
//     `analysisId:recommendationId` (locked identity);
//   - `citation_gap` — citation-gap opportunities accepted into Content
//     Intelligence, recognized by the CITATION_GAP_RECOMMENDATION_PREFIX
//     recommendationId namespace, sourceId = the immutable opportunity id.
//
// Deterministic mapping (no AI):
//   - severity 'info' / firstPartyImpact 'none' — recommendations are
//     opportunities, not first-party regressions;
//   - confidence from the recommendation's stored score (citation gaps:
//     fixed 'medium' — no stored score exists for them);
//   - effort 'medium' (locked: existing recommendation effort or medium when
//     absent — the recommendation schema carries no effort field).
export const contentActionAdapter: SourceReader = async (ctx) => {
    // Non-ObjectId ids cannot own analyses; return empty instead of letting a
    // mongoose CastError mark the whole source unavailable.
    if (!Types.ObjectId.isValid(ctx.accountId) ||
        !Types.ObjectId.isValid(ctx.siteId)) {
        return { actions: [], status: 'available' };
    }
    const docs = await ContentAnalysis.find({
        accountId: ctx.accountId,
        siteId: ctx.siteId,
        status: 'completed',
    })
        .sort({ requestedAt: -1 })
        .limit(MAX_ANALYSES);
    if (docs.length === 0) {
        return { actions: [], status: 'available' };
    }
    const newestDoc = docs[0]!;
    const lastObservedAt = (newestDoc.completedAt ?? newestDoc.requestedAt).toISOString();
    const actions: CandidateAction[] = [];
    const seenOwnedUrls = new Set<string>();
    const seenCitationGapIds = new Set<string>();
    for (const doc of docs) {
        // Newest analysis per owned URL wins.
        if (seenOwnedUrls.has(doc.ownedUrl))
            continue;
        seenOwnedUrls.add(doc.ownedUrl);
        const analysisId = String(doc._id);
        const observedAt = (doc.completedAt ?? doc.requestedAt).toISOString();
        const affectedUrls = canonicalizeAffectedUrls([doc.ownedUrl]);
        // Stored state rows only. A recommendation with no row has never been
        // acted on, which Content Intelligence itself reports as the implicit
        // `suggested` state — so the `?? 'suggested'` fallback below is the real,
        // reachable "never touched" arm rather than dead defensive code.
        const stateById = new Map(doc.recommendationStates.map((s) => [s.recommendationId, s.state] as const));
        const citationById = new Map(doc.citations.map((c) => [c.sourceId, c] as const));
        for (const value of doc.recommendations) {
            const parsed = recommendationSchema.safeParse(value);
            if (!parsed.success)
                continue;
            const rec = parsed.data;
            const storedState = stateById.get(rec.id);
            const evidence: ActionEvidence[] = rec.evidenceSourceIds.flatMap((id) => {
                const citation = citationById.get(id);
                if (!citation)
                    return [];
                return [
                    {
                        sourceRef: citation.sourceId,
                        url: citation.url,
                        observation: buildObservationMeta({
                            sourceKind: 'provider_observation',
                            observedAt,
                        }),
                    },
                ];
            });
            actions.push({
                sourceType: 'content_recommendation',
                sourceId: `${analysisId}:${rec.id}`,
                affectedUrls,
                evidence,
                severity: 'info',
                firstPartyImpact: 'none',
                confidence: confidenceFromScore(rec.confidence),
                effort: 'medium',
                sourceState: CONTENT_STATE_TO_ACTION_STATE[storedState ?? 'suggested'],
                observedAt,
                lastVerifiedAt: observedAt,
                retestAvailable: false,
                retestReasonKey: 'actions.errors.retestUnsupported',
                copyKeys: {
                    problem: 'actions.content.problem',
                    whyItMatters: 'actions.content.whyItMatters',
                    nextStep: 'actions.content.nextStep',
                },
                copyVars: { url: doc.ownedUrl, keyword: doc.keyword },
                ...(isContentCodeFixEligible(rec.ruleId)
                    ? {
                        codeFixPrompt: {
                            reference: rec.ruleId,
                            recommendedFixKey: `contentIntelligence.rules.${rec.ruleId}` as TranslationKey,
                            affectedUrlCount: affectedUrls.length,
                        },
                    }
                    : {}),
            });
        }
        for (const entry of doc.recommendationStates) {
            if (!entry.recommendationId.startsWith(CITATION_GAP_RECOMMENDATION_PREFIX)) {
                continue;
            }
            // The same accepted opportunity may be tracked on several analyses of
            // the same page family — the newest analysis wins.
            if (seenCitationGapIds.has(entry.recommendationId))
                continue;
            seenCitationGapIds.add(entry.recommendationId);
            const gapObservedAt = entry.stateChangedAt.toISOString();
            actions.push({
                sourceType: 'citation_gap',
                sourceId: entry.recommendationId,
                affectedUrls,
                evidence: [
                    {
                        sourceRef: entry.recommendationId,
                        observation: buildObservationMeta({
                            sourceKind: 'first_party',
                            observedAt: gapObservedAt,
                        }),
                    },
                ],
                severity: 'info',
                firstPartyImpact: 'none',
                confidence: 'medium',
                effort: 'medium',
                sourceState: CONTENT_STATE_TO_ACTION_STATE[entry.state],
                observedAt: gapObservedAt,
                lastVerifiedAt: null,
                retestAvailable: false,
                retestReasonKey: 'actions.errors.retestUnsupported',
                copyKeys: {
                    problem: 'actions.citationGap.problem',
                    whyItMatters: 'actions.citationGap.whyItMatters',
                    nextStep: 'actions.citationGap.nextStep',
                },
                copyVars: { keyword: doc.keyword },
            });
        }
    }
    return { actions, status: 'available', lastObservedAt };
};
