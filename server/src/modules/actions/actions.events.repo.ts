import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { HttpError } from '../../shared/utils/http-error.js';
import { actionEvents, type ActionEventKind, type ActionEventRow, type ActionSourceType, type ActionState, } from '../../db/schema/action-events.js';
export type ActionEventsDb = ApplicationDb;
export interface AppendActionEventInput {
    accountId: string;
    siteId: string;
    actionId: string;
    sourceType: ActionSourceType;
    sourceIdRef: string;
    priorState: ActionState | null;
    newState: ActionState;
    eventKind: ActionEventKind;
    actorUserId: string;
    note: string | null;
    idempotencyKey: string;
}
export interface AppendActionEventResult {
    row: ActionEventRow;
    replayed: boolean;
}
export async function appendActionEvent(db: ActionEventsDb, input: AppendActionEventInput): Promise<AppendActionEventResult> {
    const existing = await db
        .select()
        .from(actionEvents)
        .where(and(eq(actionEvents.accountId, input.accountId), eq(actionEvents.idempotencyKey, input.idempotencyKey)))
        .limit(1);
    if (existing[0]) {
        const row = existing[0];
        if (row.actionId !== input.actionId || row.newState !== input.newState) {
            throw HttpError.conflict({ code: 'ACTIONS_ERRORS_IDEMPOTENCY_MISMATCH', messageKey: 'actions.errors.idempotencyMismatch' });
        }
        return { row, replayed: true };
    }
    return await db.transaction(async (tx) => {
        const [maxRow] = await tx
            .select({ maxOrdinal: sql<number | null> `max(${actionEvents.ordinal})` })
            .from(actionEvents)
            .where(and(eq(actionEvents.accountId, input.accountId), eq(actionEvents.actionId, input.actionId)));
        const nextOrdinal = (maxRow?.maxOrdinal ?? 0) + 1;
        const inserted = await tx
            .insert(actionEvents)
            .values({
            accountId: input.accountId,
            siteId: input.siteId,
            actionId: input.actionId,
            sourceType: input.sourceType,
            sourceIdRef: input.sourceIdRef,
            priorState: input.priorState,
            newState: input.newState,
            eventKind: input.eventKind,
            actorUserId: input.actorUserId,
            note: input.note,
            ordinal: nextOrdinal,
            idempotencyKey: input.idempotencyKey,
        })
            .returning();
        const row = inserted[0];
        /* c8 ignore next -- driver guarantees a row when insert returns without throwing. */
        if (!row)
            throw new Error('action_events insert returned no row');
        return { row, replayed: false };
    });
}
export async function findLatestEventForAction(db: ActionEventsDb, accountId: string, actionId: string): Promise<ActionEventRow | null> {
    const rows = await db
        .select()
        .from(actionEvents)
        .where(and(eq(actionEvents.accountId, accountId), eq(actionEvents.actionId, actionId)))
        .orderBy(desc(actionEvents.ordinal))
        .limit(1);
    return rows[0] ?? null;
}
export async function listEventsForAction(db: ActionEventsDb, accountId: string, actionId: string): Promise<ActionEventRow[]> {
    return await db
        .select()
        .from(actionEvents)
        .where(and(eq(actionEvents.accountId, accountId), eq(actionEvents.actionId, actionId)))
        .orderBy(asc(actionEvents.ordinal));
}
export async function findLatestEventsForActions(db: ActionEventsDb, accountId: string, actionIds: readonly string[]): Promise<Map<string, ActionEventRow>> {
    if (actionIds.length === 0)
        return new Map();
    const rows = await db
        .select()
        .from(actionEvents)
        .where(and(eq(actionEvents.accountId, accountId), sql `${actionEvents.actionId} = ANY(${sql.raw(`ARRAY[${actionIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')}]::text[]`)})`))
        .orderBy(desc(actionEvents.ordinal));
    const latest = new Map<string, ActionEventRow>();
    for (const row of rows) {
        if (!latest.has(row.actionId))
            latest.set(row.actionId, row);
    }
    return latest;
}
export async function listSiteEventHistory(db: ActionEventsDb, accountId: string, siteId: string, limit = 100): Promise<ActionEventRow[]> {
    return await db
        .select()
        .from(actionEvents)
        .where(and(eq(actionEvents.accountId, accountId), eq(actionEvents.siteId, siteId)))
        .orderBy(desc(actionEvents.createdAt))
        .limit(limit);
}
export async function deleteAllEventsForAccount(db: ActionEventsDb, accountId: string): Promise<number> {
    const rows = await db
        .delete(actionEvents)
        .where(eq(actionEvents.accountId, accountId))
        .returning({ id: actionEvents.id });
    return rows.length;
}
export async function exportAllEventsForAccount(db: ActionEventsDb, accountId: string): Promise<ActionEventRow[]> {
    return await db
        .select()
        .from(actionEvents)
        .where(eq(actionEvents.accountId, accountId))
        .orderBy(asc(actionEvents.createdAt));
}
