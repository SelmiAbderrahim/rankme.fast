/**
 * Audience-research signal decision routing.
 *
 * Contract:
 *   - `requireAuth` + `requireVerified` at the router layer.
 *   - Cross-account/site/run/signal → 404 (existence leak rule).
 *   - Destination is CONSTRAINED to the signal's structured `suggestedRoute`:
 *       * `content` and `comparison_page` → Content Intelligence recommendation
 *         via `createRecommendationForAudienceResearchSignal`.
 *       * `product` and `seo` → deterministic Next Actions source-id +
 *         deep-link; the immutable audience-research signal remains authoritative.
 *   - Every accepted signal MUST cite at least one retained source that is
 *     still a member of the immutable audience-research run/result. Missing citation
 *     → 404 with `cited-source-missing` key.
 *   - Append-only, terminal decision. Repeat (same idempotency key + same
 *     decision + same destination) returns the existing row. Conflicting
 *     later decision (accept-after-dismiss, dismiss-after-accept, different
 *     destination on accepted) → 409.
 *   - The write path is: probe → destination guard → downstream write with
 *     the same stable operation key → append event. A crash between
 *     downstream and event is reconciled by downstream's idempotent lookup on
 *     retry (deterministic id from the same operation key).
 *   - Zero vendor spend, zero AI call. Reads and mutations never enqueue.
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { audienceResearchSignalDecisionEvents, type AudienceResearchDecisionDestination, type AudienceResearchDecisionKind, type AudienceResearchDismissReason, type AudienceResearchSignalDecisionEventRow, } from '../../db/schema/index.js';
import { createRecommendationForAudienceResearchSignal, } from '../content-intelligence/index.js';
import { Site } from '../sites/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { AudienceResearchRun } from './audience-research.model.js';
/**
 * Destinations that route to Content Intelligence. The other two
 * (`product`, `seo`) route to Next Actions with a deterministic stable id.
 */
const CONTENT_INTELLIGENCE_DESTINATIONS: readonly AudienceResearchDecisionDestination[] = [
    'content',
    'comparison_page',
] as const;
export interface DecideSignalInput {
    accountId: string;
    siteId: string;
    runId: string;
    signalId: string;
    decision: AudienceResearchDecisionKind;
    destination?: AudienceResearchDecisionDestination;
    dismissReason?: AudienceResearchDismissReason;
    idempotencyKey: string;
    decidedByUserId: string;
}
export interface DecideSignalResult {
    signalId: string;
    terminalDecision: AudienceResearchDecisionKind;
    destination: AudienceResearchDecisionDestination | null;
    downstreamId: string | null;
    deepLinkPath: string | null;
    decidedAt: string;
    decidedBy: {
        userId: string;
    };
    duplicate: boolean;
}
async function loadRunOwnedOrNotFound(input: {
    accountId: string;
    siteId: string;
    runId: string;
}) {
    if (!Types.ObjectId.isValid(input.siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'AUDIENCE_RESEARCH_ERRORS_SIGNAL_NOT_FOUND', messageKey: 'audienceResearch.errors.signalNotFound' });
    }
    const site = await Site.exists({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    const run = await AudienceResearchRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
    if (!run)
        throw HttpError.notFound({ code: 'AUDIENCE_RESEARCH_ERRORS_SIGNAL_NOT_FOUND', messageKey: 'audienceResearch.errors.signalNotFound' });
    return run;
}
function serializeRow(row: AudienceResearchSignalDecisionEventRow): DecideSignalResult {
    const isAccepted = row.decision === 'accepted';
    return {
        signalId: row.signalId,
        terminalDecision: row.decision,
        destination: isAccepted ? row.destination! : null,
        downstreamId: isAccepted ? row.downstreamId! : null,
        deepLinkPath: isAccepted ? row.deepLinkPath : null,
        decidedAt: row.decidedAt.toISOString(),
        decidedBy: { userId: row.decidedByUserId },
        duplicate: false,
    };
}
/**
 * Account-scoped terminal decisions for one run — the durable read that
 * backs the result view. Without it a page reload silently dropped every
 * accepted/dismissed state (the client's decision cache is session-local):
 * accept/dismiss buttons reappeared and re-deciding 409'd with a message
 * the user could not act on. Reads only; never reserves or mutates.
 */
export async function listTerminalSignalDecisions(db: ApplicationDb, input: {
    accountId: string;
    runId: string;
}): Promise<DecideSignalResult[]> {
    const rows = await db
        .select()
        .from(audienceResearchSignalDecisionEvents)
        .where(and(eq(audienceResearchSignalDecisionEvents.accountId, input.accountId), eq(audienceResearchSignalDecisionEvents.runId, input.runId)));
    return rows.map((row) => serializeRow(row));
}
function computeNextActionsDelegation(input: {
    accountId: string;
    siteId: string;
    runId: string;
    signalId: string;
    destination: 'product' | 'seo';
    operationKey: string;
}): {
    downstreamId: string;
    deepLinkPath: string;
} {
    // Deterministic stable id — same input yields the same source id so the
    // Next Actions adapter (`actions/adapters/audience-research.adapter.ts`,
    // which reads this row's persisted `downstreamId` verbatim) surfaces the
    // immutable audience-research signal on every list without duplicating storage.
    // Prefix chosen to match the existing `audience_research` source type.
    const idPreimage = `${input.accountId}|${input.siteId}|${input.runId}|${input.signalId}|${input.destination}|${input.operationKey}`;
    const digest = createHash('sha256').update(idPreimage).digest('hex').slice(0, 32);
    const stableSourceId = `${input.destination}:${digest}`;
    return {
        downstreamId: stableSourceId,
        deepLinkPath: `/sites/${encodeURIComponent(input.siteId)}?tab=actions&action=${encodeURIComponent(stableSourceId)}`,
    };
}
export async function decideAudienceResearchSignal(db: ApplicationDb, input: DecideSignalInput): Promise<DecideSignalResult> {
    // 1. Ownership + run existence — cross-account/site/run all resolve to 404.
    const run = await loadRunOwnedOrNotFound({
        accountId: input.accountId,
        siteId: input.siteId,
        runId: input.runId,
    });
    // 2. Signal membership. The immutable audience-research run holds the retained
    // signals; if the signalId is not among them → 404.
    const signals = (run.signals ?? []) as ReadonlyArray<{
        signalId: string;
        suggestedRoute: string;
        citedSourceIds?: readonly string[];
    }>;
    const signal = signals.find((s) => s.signalId === input.signalId);
    if (!signal) {
        throw HttpError.notFound({ code: 'AUDIENCE_RESEARCH_ERRORS_SIGNAL_NOT_FOUND', messageKey: 'audienceResearch.errors.signalNotFound' });
    }
    // 3. Destination guard for accepts — the signal's own structured
    // suggestedRoute is the ONLY allowed destination. AI-derived wording never
    // sets destination.
    // Resolved once here and reused by the downstream write below — the accept
    // path has already proven this list is non-empty and fully resolvable, so
    // re-deriving it later would reintroduce an unreachable empty fallback.
    let citedSourceIds: readonly string[] = [];
    if (input.decision === 'accepted') {
        if (!input.destination) {
            throw HttpError.badRequest({ code: 'AUDIENCE_RESEARCH_ERRORS_INVALID_DESTINATION', messageKey: 'audienceResearch.errors.invalidDestination' });
        }
        if (input.destination !== signal.suggestedRoute) {
            throw HttpError.badRequest({ code: 'AUDIENCE_RESEARCH_ERRORS_INVALID_DESTINATION', messageKey: 'audienceResearch.errors.invalidDestination' });
        }
        // 4. Citation membership — every retained source id cited by the signal
        // MUST still be a member of the run's sources. This is the "cited source
        // missing" 404 signal from the spec.
        const runSourceIds = new Set((run.sources ?? []).map((s: {
            sourceId: string;
        }) => s.sourceId));
        citedSourceIds = signal.citedSourceIds ?? [];
        if (citedSourceIds.length === 0) {
            throw HttpError.notFound({ code: 'AUDIENCE_RESEARCH_ERRORS_CITED_SOURCE_MISSING', messageKey: 'audienceResearch.errors.citedSourceMissing' });
        }
        for (const sid of citedSourceIds) {
            if (!runSourceIds.has(sid)) {
                throw HttpError.notFound({ code: 'AUDIENCE_RESEARCH_ERRORS_CITED_SOURCE_MISSING', messageKey: 'audienceResearch.errors.citedSourceMissing' });
            }
        }
    }
    // 5. Idempotency probe by (account, key).
    const existingByKey = await db
        .select()
        .from(audienceResearchSignalDecisionEvents)
        .where(and(eq(audienceResearchSignalDecisionEvents.accountId, input.accountId), eq(audienceResearchSignalDecisionEvents.idempotencyKey, input.idempotencyKey)))
        .limit(1);
    if (existingByKey.length > 0) {
        const row = existingByKey[0]!;
        const sameSignal = row.signalId === input.signalId;
        const sameDecision = row.decision === input.decision;
        const sameDestination = row.decision === 'accepted'
            ? row.destination === input.destination
            : true;
        if (sameSignal && sameDecision && sameDestination) {
            return { ...serializeRow(row), duplicate: true };
        }
        throw HttpError.conflict({ code: 'AUDIENCE_RESEARCH_ERRORS_TERMINAL_CONFLICT', messageKey: 'audienceResearch.errors.terminalConflict' });
    }
    // 6. Signal-level terminal-conflict probe — any prior terminal decision for
    // this signal with a different (decision, destination) is a conflict, and
    // any repeat with different key + same shape returns 409 (append-only rule).
    // Account-scoped: terminality is "append-only per (accountId, signalId)" —
    // an unscoped probe let another ACCOUNT's decision on a colliding signal id
    // 409 this account's first decision (cross-account isolation defect,
    // mirrored by the `arsde_signal_terminal_uq` index scope).
    const existingBySignal = await db
        .select()
        .from(audienceResearchSignalDecisionEvents)
        .where(and(eq(audienceResearchSignalDecisionEvents.accountId, input.accountId), eq(audienceResearchSignalDecisionEvents.signalId, input.signalId)))
        .limit(1);
    if (existingBySignal.length > 0) {
        const row = existingBySignal[0]!;
        if (row.decision === input.decision &&
            (input.decision === 'dismissed' || row.destination === input.destination)) {
            // Same-shape decision from a different idempotency key — still 409 per
            // the append-only rule. The client is expected to reuse the key when
            // replaying the exact same action.
            throw HttpError.conflict({ code: 'AUDIENCE_RESEARCH_ERRORS_TERMINAL_CONFLICT', messageKey: 'audienceResearch.errors.terminalConflict' });
        }
        throw HttpError.conflict({ code: 'AUDIENCE_RESEARCH_ERRORS_TERMINAL_CONFLICT', messageKey: 'audienceResearch.errors.terminalConflict' });
    }
    // 7. Downstream write with stable operation key. On accept:
    //   - content / comparison_page → CI recommendation id + deep-link
    //   - product / seo             → Next Actions stable source id + deep-link
    let downstreamId: string | null = null;
    let deepLinkPath: string | null = null;
    if (input.decision === 'accepted') {
        const destination = input.destination!;
        const operationKey = input.idempotencyKey;
        if (CONTENT_INTELLIGENCE_DESTINATIONS.includes(destination)) {
            let ci;
            try {
                ci = createRecommendationForAudienceResearchSignal({
                    accountId: input.accountId,
                    siteId: input.siteId,
                    runId: input.runId,
                    signalId: input.signalId,
                    destination: destination as 'content' | 'comparison_page',
                    citedSourceIds,
                    operationKey,
                });
            }
            catch (err) {
                throw new HttpError(502, { code: 'AUDIENCE_RESEARCH_ERRORS_DOWNSTREAM_FAILURE', messageKey: 'audienceResearch.errors.downstreamFailure' }, undefined, { cause: err });
            }
            downstreamId = ci.recommendationId;
            deepLinkPath = ci.deepLinkPath;
        }
        else {
            const na = computeNextActionsDelegation({
                accountId: input.accountId,
                siteId: input.siteId,
                runId: input.runId,
                signalId: input.signalId,
                destination: destination as 'product' | 'seo',
                operationKey,
            });
            downstreamId = na.downstreamId;
            deepLinkPath = na.deepLinkPath;
        }
    }
    // 8. Append the event. The account-scoped `(account_id, signal_id)` unique
    // index catches any concurrent double-accept and the account/idempotency unique index catches
    // any concurrent duplicate — either yields a 409 the caller can safely
    // retry-with-the-same-key against for the reconciliation replay.
    let inserted: AudienceResearchSignalDecisionEventRow[];
    try {
        inserted = await db
            .insert(audienceResearchSignalDecisionEvents)
            .values({
            accountId: input.accountId,
            siteId: input.siteId,
            runId: input.runId,
            signalId: input.signalId,
            decision: input.decision,
            destination: input.decision === 'accepted' ? input.destination! : null,
            dismissReason: input.decision === 'dismissed' ? input.dismissReason ?? null : null,
            downstreamId,
            deepLinkPath,
            idempotencyKey: input.idempotencyKey,
            decidedByUserId: input.decidedByUserId,
        })
            .onConflictDoNothing()
            .returning();
    }
    catch (err) {
        throw new HttpError(502, { code: 'AUDIENCE_RESEARCH_ERRORS_DOWNSTREAM_FAILURE', messageKey: 'audienceResearch.errors.downstreamFailure' }, undefined, { cause: err });
    }
    if (inserted.length === 0) {
        // Concurrent same-key writer beat us. Reload and return their row when it
        // matches; otherwise surface the conflict.
        const replay = await db
            .select()
            .from(audienceResearchSignalDecisionEvents)
            .where(and(eq(audienceResearchSignalDecisionEvents.accountId, input.accountId), eq(audienceResearchSignalDecisionEvents.idempotencyKey, input.idempotencyKey)))
            .limit(1);
        if (replay.length > 0 &&
            replay[0]!.signalId === input.signalId &&
            replay[0]!.decision === input.decision &&
            (input.decision === 'dismissed' ||
                replay[0]!.destination === input.destination)) {
            return { ...serializeRow(replay[0]!), duplicate: true };
        }
        throw HttpError.conflict({ code: 'AUDIENCE_RESEARCH_ERRORS_TERMINAL_CONFLICT', messageKey: 'audienceResearch.errors.terminalConflict' });
    }
    return serializeRow(inserted[0]!);
}
