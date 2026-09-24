import { contentAnalysisEvents, type ContentAnalysisEventKind, } from '../../db/schema/content-analysis-events.js';
export interface RecordContentAnalysisEventInput {
    accountId: string;
    siteId: string;
    analysisId: string;
    reservationKey: string;
    kind: ContentAnalysisEventKind;
    units?: number;
    costMicros?: number;
    aiCostMicros?: number;
    errorCategory?: string | null;
}
/**
 * Insert one event row, no-op on `(reservation_key, kind)` conflict.
 * Returns true when a new row landed, false on a duplicate replay.
 */
export async function recordContentAnalysisEvent(db: ApplicationDb, input: RecordContentAnalysisEventInput): Promise<boolean> {
    const inserted = await db
        .insert(contentAnalysisEvents)
        .values({
        accountId: input.accountId,
        siteId: input.siteId,
        analysisId: input.analysisId,
        reservationKey: input.reservationKey,
        kind: input.kind,
        units: input.units ?? 0,
        costMicros: input.costMicros ?? 0,
        aiCostMicros: input.aiCostMicros ?? 0,
        errorCategory: input.errorCategory ?? null,
    })
        .onConflictDoNothing({
        target: [contentAnalysisEvents.reservationKey, contentAnalysisEvents.kind],
    })
        .returning();
    return inserted.length > 0;
}
