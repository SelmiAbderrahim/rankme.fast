/**
 * Brand Radar — append-only event/cost row writer.
 *
 * One row per stage per call. The Postgres unique index
 * `(scan_id, stage, event)` makes every write idempotent: a re-delivered
 * BullMQ job and a reconciliation re-enqueue both collide instead of
 * doubling rows.
 *
 * The shipped `BRAND_RADAR_EVENT_KINDS` enum (migration 0059) is the
 * stage-scoped event vocabulary this module writes:
 *
 *   spec wording      → shipped kind
 *   `stage_started`   → `started`
 *   `vendor_cost`     → carried ON the terminal stage row via `cost_micros`
 *   `stage_completed` → `succeeded`
 *   `stage_halted`    → `halted`
 *   `stage_failed`    → `failed`
 *
 * `metadata` is reason codes and counts only — never the brand query, a
 * mention snippet, or a vendor envelope.
 */
import { eq, sql } from 'drizzle-orm';
import { brandRadarEvents, type BrandRadarEventKind, type BrandRadarEventRow, type BrandRadarEventStage, } from '../../db/schema/brand-radar-events.js';
export interface RecordBrandRadarEventInput {
    accountId: string;
    scanId: string;
    stage: BrandRadarEventStage;
    event: BrandRadarEventKind;
    costMicros?: number;
    metadata?: Record<string, unknown>;
}
export interface BrandRadarEventWrite {
    /** Row id — the freshly written one, or the row that already existed. */
    id: string;
    /** False when this call lost the race to an earlier identical write. */
    inserted: boolean;
}
/**
 * Write one event row, or resolve the row that already occupies
 * `(scan_id, stage, event)`.
 *
 * The conflict clause is a deliberate no-op update (`account_id` rewritten to
 * the value it already holds — a scan belongs to exactly one account) so the
 * statement RETURNs the surviving row either way. `xmax = 0` is the standard
 * Postgres discriminator: zero on a fresh insert, non-zero on the conflict
 * path. One round trip, one row, no "did it exist?" follow-up read.
 */
export async function recordBrandRadarEvent(db: ApplicationDb, input: RecordBrandRadarEventInput): Promise<BrandRadarEventWrite> {
    const rows = await db
        .insert(brandRadarEvents)
        .values({
        accountId: input.accountId,
        scanId: input.scanId,
        stage: input.stage,
        event: input.event,
        costMicros: Math.max(0, Math.round(input.costMicros ?? 0)),
        metadata: input.metadata ?? {},
    })
        .onConflictDoUpdate({
        target: [
            brandRadarEvents.scanId,
            brandRadarEvents.stage,
            brandRadarEvents.event,
        ],
        set: { accountId: input.accountId },
    })
        .returning({
        id: brandRadarEvents.id,
        inserted: sql<boolean> `(xmax = 0)`,
    });
    // The unique index guarantees exactly one surviving row per key.
    const row = rows[0]!;
    return { id: row.id, inserted: row.inserted };
}
/** Deterministic per-stage cost rollup in micros USD. */
export async function readBrandRadarCostByStage(db: ApplicationDb, scanId: string): Promise<Record<BrandRadarEventStage, number>> {
    const rows: BrandRadarEventRow[] = await db
        .select()
        .from(brandRadarEvents)
        .where(eq(brandRadarEvents.scanId, scanId));
    const totals: Record<BrandRadarEventStage, number> = {
        scan: 0,
        search: 0,
        summary: 0,
        brand_digest: 0,
    };
    for (const row of rows) {
        totals[row.stage] += Number(row.costMicros);
    }
    return totals;
}
