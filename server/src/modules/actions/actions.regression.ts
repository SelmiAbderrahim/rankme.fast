import { createHash } from 'node:crypto';
import { logger } from '../../config/logger.js';
import type { ActionEventRow } from '../../db/schema/action-events.js';
import { appendActionEvent, findLatestEventForAction, type ActionEventsDb } from './actions.events.repo.js';
import { hashSourceIdRef } from './actions.identity.js';

export const AUDIT_REGRESSION_ACTOR = 'system:audit-regression';

export function isAuditRegressionEvent(event: Pick<ActionEventRow, 'actorUserId'> | null | undefined): boolean {
    return event?.actorUserId === AUDIT_REGRESSION_ACTOR;
}

export function reasonCodeForActor(actorUserId: string): 'audit_regression' | null {
    return actorUserId === AUDIT_REGRESSION_ACTOR ? 'audit_regression' : null;
}

export interface RegressionEvidence {
    actionId: string;
    ruleId: string;
    latest: ActionEventRow | undefined;
    observedAt: string;
    runId: string;
}

export function isContradictedCompletion(latest: ActionEventRow | undefined,
    observedAt: string): latest is ActionEventRow {
    if (latest?.newState !== 'completed') return false;
    const observed = Date.parse(observedAt);
    return Number.isFinite(observed) && observed > latest.createdAt.getTime();
}

function regressionKey(accountId: string, item: RegressionEvidence, ordinal: number): string {
    return createHash('sha256').update('audit-regression').update('\0').update(accountId)
        .update('\0').update(item.actionId).update('\0').update(item.observedAt)
        .update('\0').update(String(ordinal)).digest('hex');
}

/** A newer audit can reopen a marked-fixed rule once; repeated readers share the event. */
export async function reconcileAuditRegressions(db: ActionEventsDb, input: {
    accountId: string; siteId: string; evidence: readonly RegressionEvidence[];
}): Promise<Map<string, ActionEventRow>> {
    const reopened = new Map<string, ActionEventRow>();
    for (const item of input.evidence) {
        const completed = item.latest;
        if (!isContradictedCompletion(completed, item.observedAt)) continue;
        const note = `audit-regression observedAt=${item.observedAt} run=${item.runId}`;
        try {
            const result = await appendActionEvent(db, {
                accountId: input.accountId, siteId: input.siteId, actionId: item.actionId,
                sourceType: 'audit_finding', sourceIdRef: hashSourceIdRef({
                    accountId: input.accountId, sourceType: 'audit_finding', sourceId: item.ruleId,
                }), priorState: 'completed', newState: 'open', eventKind: 'reopen',
                actorUserId: AUDIT_REGRESSION_ACTOR, note,
                idempotencyKey: regressionKey(input.accountId, item, completed.ordinal),
            });
            reopened.set(item.actionId, result.row);
        }
        catch (error) {
            logger.warn({ actionId: item.actionId,
                causeName: error instanceof Error ? error.constructor.name : typeof error },
            'audit regression event was not appended');
            const stored = await findLatestEventForAction(db, input.accountId, item.actionId);
            reopened.set(item.actionId, stored && stored.newState !== 'completed' ? stored : {
                ...completed, actionId: item.actionId, priorState: 'completed', newState: 'open',
                eventKind: 'reopen', actorUserId: AUDIT_REGRESSION_ACTOR, note,
                ordinal: completed.actionId === item.actionId ? completed.ordinal + 1 : 1,
                createdAt: new Date(),
            });
        }
    }
    return reopened;
}
