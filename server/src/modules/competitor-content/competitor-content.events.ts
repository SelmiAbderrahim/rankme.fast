import { competitorContentEvents, type CompetitorContentEventKind, } from '../../db/schema/competitor-content-events.js';
export interface RecordCompetitorContentEventInput {
    accountId: string;
    siteId: string;
    runId: string;
    reservationKey: string;
    kind: CompetitorContentEventKind;
    units?: number;
    costMicros?: number;
    aiCostMicros?: number;
    errorCategory?: string | null;
}
/**
 * Insert one event row, no-op on `(reservation_key, kind)` conflict. Returns
 * true when a new row landed, false on a duplicate replay.
 */
export async function recordCompetitorContentEvent(db: ApplicationDb, input: RecordCompetitorContentEventInput): Promise<boolean> {
    const inserted = await db
        .insert(competitorContentEvents)
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
        target: [competitorContentEvents.reservationKey, competitorContentEvents.kind],
    })
        .returning();
    return inserted.length > 0;
}
