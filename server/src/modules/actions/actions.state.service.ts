import { createHash } from 'node:crypto';
import { HttpError } from '../../shared/utils/http-error.js';
import { getSite } from '../sites/sites.service.js';
import { appendActionEvent, findLatestEventForAction, } from './actions.events.repo.js';
import { EVENT_KIND_FOR_TRANSITION, isAllowedTransition, } from './actions.orders.js';
import type { ActionSourceType, ActionState, } from '../../db/schema/action-events.js';
import { hashActionId, hashSourceIdRef, legacyAuditActionId, } from './actions.identity.js';
import { getSourceReaders } from './actions.registry.js';
export interface MutateActionStateInput {
    accountId: string;
    siteId: string;
    actionId: string;
    actorUserId: string;
    newState: ActionState;
    expectedVersion: number;
    note: string | null;
    clientKey: string;
    db: ApplicationDb;
}
export interface MutateActionStateResult {
    actionId: string;
    state: ActionState;
    version: number;
    replayed: boolean;
}
// Resolves a live candidate for the given actionId by asking every registered
// source reader for its actions, hashing each candidate to look for a match.
// Returns null when the source no longer emits this candidate — the caller
// serves 404. Shared with the history read so a vanished/unknown/cross-tenant
// action hash never leaks event existence (re-resolve and own the
// source before serving history).
export async function resolveCandidateForAction(accountId: string, siteId: string, actionId: string, db: ApplicationDb): Promise<{
    actionId: string;
    sourceType: ActionSourceType;
    sourceId: string;
    legacyActionId: string | null;
} | null> {
    const readers = getSourceReaders();
    for (const [sourceType, reader] of readers) {
        let result;
        try {
            result = await reader({ accountId, siteId, db });
        }
        catch {
            continue;
        }
        for (const candidate of result.actions) {
            const id = hashActionId({
                accountId,
                siteId,
                sourceType: candidate.sourceType,
                sourceId: candidate.sourceId,
            });
            const legacyId = legacyAuditActionId({
                accountId,
                siteId,
                sourceType: candidate.sourceType,
                sourceId: candidate.sourceId,
                sourceRef: candidate.evidence[0]?.sourceRef,
            });
            if (id === actionId) {
                return {
                    actionId: id,
                    sourceType: candidate.sourceType,
                    sourceId: candidate.sourceId,
                    legacyActionId: legacyId,
                };
            }
        }
        // Suppress unused var warning
        void sourceType;
    }
    return null;
}
export async function mutateActionState(input: MutateActionStateInput): Promise<MutateActionStateResult> {
    // Ownership check.
    await getSite(input.accountId, input.siteId);
    const candidate = await resolveCandidateForAction(input.accountId, input.siteId, input.actionId, input.db);
    if (!candidate) {
        throw HttpError.notFound({ code: 'ACTIONS_ERRORS_NOT_FOUND', messageKey: 'actions.errors.notFound' });
    }
    // Content sources delegate to the recommendation service — this route MUST
    // NOT double-write action_events for them.
    if (candidate.sourceType === 'content_recommendation' ||
        candidate.sourceType === 'citation_gap') {
        throw HttpError.conflict({ code: 'ACTIONS_ERRORS_CONTENT_DELEGATION', messageKey: 'actions.errors.contentDelegation' });
    }
    const latest = await findLatestEventForAction(input.db, input.accountId, candidate.actionId);
    const legacyLatest = latest === null && candidate.legacyActionId
        ? await findLatestEventForAction(input.db, input.accountId, candidate.legacyActionId)
        : null;
    const currentVersion = latest?.ordinal ? Number(latest.ordinal) : 0;
    const currentState: ActionState = latest?.newState ?? legacyLatest?.newState ?? 'open';
    if (input.expectedVersion !== currentVersion) {
        throw HttpError.conflict({ code: 'ACTIONS_ERRORS_STALE_VERSION', messageKey: 'actions.errors.staleVersion' });
    }
    if (currentState === input.newState) {
        // Same-state repeat routes through idempotency cache; if no cache hit yet,
        // treat as no-op replay (200).
        return {
            actionId: candidate.actionId,
            state: currentState,
            version: currentVersion,
            replayed: true,
        };
    }
    if (!isAllowedTransition(currentState, input.newState)) {
        throw HttpError.conflict({ code: 'ACTIONS_ERRORS_INVALID_TRANSITION', messageKey: 'actions.errors.invalidTransition' });
    }
    const idempotencyKey = createHash('sha256')
        .update(input.accountId)
        .update('\0')
        .update(candidate.actionId)
        .update('\0')
        .update(String(input.expectedVersion))
        .update('\0')
        .update(input.clientKey)
        .digest('hex');
    const sourceIdRef = hashSourceIdRef({
        accountId: input.accountId,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
    });
    const appended = await appendActionEvent(input.db, {
        accountId: input.accountId,
        siteId: input.siteId,
        actionId: candidate.actionId,
        sourceType: candidate.sourceType,
        sourceIdRef,
        priorState: currentState,
        newState: input.newState,
        eventKind: EVENT_KIND_FOR_TRANSITION[input.newState],
        actorUserId: input.actorUserId,
        note: input.note,
        idempotencyKey,
    });
    return {
        actionId: candidate.actionId,
        state: appended.row.newState,
        version: Number(appended.row.ordinal),
        replayed: appended.replayed,
    };
}
