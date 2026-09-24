import { and, desc, eq, inArray } from 'drizzle-orm';
import { keywords } from '../../../db/schema/keywords.js';
import { rankDropConfirmations } from '../../../db/schema/rank-drop-confirmations.js';
import { buildObservationMeta } from '../../../shared/observations/observations.js';
import type { SourceReader } from '../actions.registry.js';
import type { CandidateAction } from '../actions.types.js';
// Bounded read: a site tracks a bounded keyword set and confirmations are one
// row per candidate ranking; 100 newest confirmed drops is a hard safety lid.
const MAX_CONFIRMED_DROPS = 100;
// Locked contract: ONLY `confirmed`
// drops become actions. `volatile` and `unconfirmed` rows stay evidence /
// history and are suppressed here by the state filter in the query itself.
//
// Deterministic mapping (no AI):
//   - severity   = 'warning' (locked: confirmed rank drops surface as warning
//     — no stronger deterministic severity exists for this source);
//   - confidence = 'high' (locked: a confirmed two-observation drop);
//   - firstPartyImpact = 'none' — SERP positions are vendor observations,
//     not first-party analytics volume;
//   - effort = 'low' (locked source default for rank);
//   - sourceId = the confirmation-event row id.
export const rankActionAdapter: SourceReader = async (ctx) => {
    const rows = await ctx.db
        .select()
        .from(rankDropConfirmations)
        .where(and(eq(rankDropConfirmations.accountId, ctx.accountId), eq(rankDropConfirmations.siteId, ctx.siteId), eq(rankDropConfirmations.state, 'confirmed')))
        .orderBy(desc(rankDropConfirmations.candidateObservedAt))
        .limit(MAX_CONFIRMED_DROPS);
    if (rows.length === 0) {
        return { actions: [], status: 'available' };
    }
    // One batched phrase lookup — never a per-row query.
    const keywordIds = [...new Set(rows.map((row) => row.keywordId))];
    const phrases = await ctx.db
        .select({ id: keywords.id, phrase: keywords.phrase })
        .from(keywords)
        .where(inArray(keywords.id, keywordIds));
    const phraseById = new Map(phrases.map((row) => [row.id, row.phrase]));
    const actions: CandidateAction[] = [];
    for (const row of rows) {
        const phrase = phraseById.get(row.keywordId);
        // The keywords FK cascades deletes onto confirmations, so a missing
        // phrase is unreachable through the real write path — skip defensively
        // instead of emitting an unlabelled action.
        if (phrase === undefined)
            continue;
        const observedAtDate = row.confirmationObservedAt ?? row.candidateObservedAt;
        const observedAt = observedAtDate.toISOString();
        actions.push({
            sourceType: 'confirmed_rank_drop',
            sourceId: row.id,
            affectedUrls: [],
            evidence: [
                {
                    sourceRef: row.id,
                    observation: buildObservationMeta({
                        sourceKind: 'provider_observation',
                        observedAt: observedAtDate,
                    }),
                },
            ],
            severity: 'warning',
            firstPartyImpact: 'none',
            confidence: 'high',
            effort: 'low',
            sourceState: 'open',
            observedAt,
            lastVerifiedAt: row.confirmationObservedAt?.toISOString() ?? null,
            retestAvailable: false,
            retestReasonKey: 'actions.errors.retestUnsupported',
            copyKeys: {
                problem: 'actions.rankDrop.problem',
                whyItMatters: 'actions.rankDrop.whyItMatters',
                nextStep: 'actions.rankDrop.nextStep',
            },
            copyVars: { keyword: phrase },
        });
    }
    return {
        actions,
        status: 'available',
        lastObservedAt: rows[0]!.candidateObservedAt.toISOString(),
    };
};
