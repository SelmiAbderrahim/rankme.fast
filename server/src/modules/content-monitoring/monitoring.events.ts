import { contentMonitorEvents, type ContentMonitorEventKind, } from '../../db/schema/content-monitor-events.js';
export interface RecordContentMonitorEventInput {
    accountId: string;
    siteId: string;
    monitorId: string;
    /** Idempotency discriminant within a monitor (see the schema file header). */
    eventKey: string;
    kind: ContentMonitorEventKind;
    /** Vendor check id for check-scoped events; null otherwise. */
    checkId?: string | null;
    /** `YYYY-Www` UTC ISO week the check belongs to (check rows). */
    isoWeek?: string | null;
    units?: number;
    costMicros?: number;
}
/**
 * Insert one event row, no-op on `(monitor_id, event_key)` conflict. Returns
 * true when a new row landed, false on a duplicate replay.
 */
export async function recordContentMonitorEvent(db: ApplicationDb, input: RecordContentMonitorEventInput): Promise<boolean> {
    const inserted = await db
        .insert(contentMonitorEvents)
        .values({
        accountId: input.accountId,
        siteId: input.siteId,
        monitorId: input.monitorId,
        checkId: input.checkId ?? null,
        eventKey: input.eventKey,
        kind: input.kind,
        isoWeek: input.isoWeek ?? null,
        units: input.units ?? 0,
        costMicros: input.costMicros ?? 0,
    })
        .onConflictDoNothing({
        target: [contentMonitorEvents.monitorId, contentMonitorEvents.eventKey],
    })
        .returning();
    return inserted.length > 0;
}
