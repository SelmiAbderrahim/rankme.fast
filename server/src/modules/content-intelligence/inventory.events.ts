import { contentInventoryEvents, type ContentInventoryEventKind, } from '../../db/schema/content-inventory-events.js';
export interface RecordContentInventoryEventInput {
    accountId: string;
    siteId: string;
    runId: string;
    reservationKey: string;
    kind: ContentInventoryEventKind;
    units?: number;
    costMicros?: number;
    aiCostMicros?: number;
    errorCategory?: string | null;
}
/**
 * Insert one event row, no-op on `(reservation_key, kind)` conflict. Returns
 * true when a new row landed, false on a duplicate replay.
 */
export async function recordContentInventoryEvent(db: ApplicationDb, input: RecordContentInventoryEventInput): Promise<boolean> {
    const inserted = await db
        .insert(contentInventoryEvents)
        .values({
        accountId: input.accountId,
        siteId: input.siteId,
        runId: input.runId,
        reservationKey: input.reservationKey,
        kind: input.kind,
        units: input.units ?? 0,
        costMicros: input.costMicros ?? 0,
        aiCostMicros: input.aiCostMicros ?? 0,
        errorCategory: input.errorCategory ?? null,
    })
        .onConflictDoNothing({
        target: [contentInventoryEvents.reservationKey, contentInventoryEvents.kind],
    })
        .returning();
    return inserted.length > 0;
}
