/**
 * GA4 daily-snapshot repository — clones the `gsc-snapshots` shape.
 *
 * Postgres per the drizzle-postgres-scope rule: GA4 metrics are relational,
 * ordered time-series data. One snapshot per `(siteId, snapshotDate,
 * dimensionSet, windowDays)`; the ga4-sync worker writes after a successful
 * runReport, the `?tab=google` analytics summary reads the latest snapshot.
 *
 * Writes are REPLACE-on-conflict at snapshot granularity: a re-run for the
 * same key deletes the prior row set and inserts the fresh one inside a
 * transaction, so a retried sync never duplicates and never leaves a stale
 * partial mix.
 */
import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { ga4Metrics, type Ga4MetricsSnapshotRow, } from '../../db/schema/index.js';
const LEGACY_BINDING_GENERATION = 'legacy';
/** Product-side dimension sets — mapped to GA4 API names by the sync. */
export const GA4_DIMENSION_SETS = [
    'date',
    'channel',
    'page',
    'country',
    'device',
] as const;
export type Ga4DimensionSet = (typeof GA4_DIMENSION_SETS)[number];
export interface Ga4MetricRowInput {
    key: string;
    sessions: number;
    activeUsers: number;
    engagedSessions: number;
    keyEvents: number;
}
export interface UpsertGa4MetricsInput {
    siteId: string;
    accountId: string;
    bindingGenerationId?: string;
    /** YYYY-MM-DD — the lag-adjusted endDate of the queried window. */
    snapshotDate: string;
    dimensionSet: string;
    /** Window length in days ending at snapshotDate (7 | 28 | 90). */
    windowDays: number;
    rows: readonly Ga4MetricRowInput[];
}
export async function upsertGa4Metrics(db: Db, input: UpsertGa4MetricsInput): Promise<void> {
    const bindingGenerationId = input.bindingGenerationId ?? LEGACY_BINDING_GENERATION;
    // Last-write-wins dedupe inside the batch — the unique index would reject
    // a duplicate key arriving twice in one INSERT.
    const byKey = new Map<string, Ga4MetricRowInput>();
    for (const row of input.rows)
        byKey.set(row.key, row);
    await db.transaction(async (tx) => {
        await tx
            .delete(ga4Metrics)
            .where(and(eq(ga4Metrics.siteId, input.siteId), eq(ga4Metrics.bindingGenerationId, bindingGenerationId), eq(ga4Metrics.snapshotDate, input.snapshotDate), eq(ga4Metrics.dimensionSet, input.dimensionSet), eq(ga4Metrics.windowDays, input.windowDays)));
        if (byKey.size === 0)
            return;
        await tx.insert(ga4Metrics).values([...byKey.entries()].map(([dimensionKey, row]) => ({
            accountId: input.accountId,
            siteId: input.siteId,
            bindingGenerationId,
            snapshotDate: input.snapshotDate,
            dimensionSet: input.dimensionSet,
            windowDays: input.windowDays,
            dimensionKey,
            sessions: row.sessions,
            activeUsers: row.activeUsers,
            engagedSessions: row.engagedSessions,
            keyEvents: row.keyEvents,
        })));
    });
}
export interface ReadGa4MetricsRange {
    /** YYYY-MM-DD inclusive. */
    since?: string;
    /** YYYY-MM-DD inclusive. */
    until?: string;
}
/** Ordered for trend queries: snapshotDate ASC, sessions DESC within a day. */
export async function readGa4Metrics(db: SnapshotReadDb, siteId: string, dimensionSet: string, windowDays: number, range: ReadGa4MetricsRange = {}, bindingGenerationId = LEGACY_BINDING_GENERATION): Promise<Ga4MetricsSnapshotRow[]> {
    const conditions = [
        eq(ga4Metrics.siteId, siteId),
        eq(ga4Metrics.bindingGenerationId, bindingGenerationId),
        eq(ga4Metrics.dimensionSet, dimensionSet),
        eq(ga4Metrics.windowDays, windowDays),
    ];
    if (range.since !== undefined) {
        conditions.push(gte(ga4Metrics.snapshotDate, range.since));
    }
    if (range.until !== undefined) {
        conditions.push(lte(ga4Metrics.snapshotDate, range.until));
    }
    return db
        .select()
        .from(ga4Metrics)
        .where(and(...conditions))
        .orderBy(ga4Metrics.snapshotDate, desc(ga4Metrics.sessions));
}
/** Latest persisted snapshotDate for a site+dimensionSet+window, or null. */
export async function readLatestGa4SnapshotDate(db: SnapshotReadDb, siteId: string, dimensionSet: string, windowDays: number, bindingGenerationId = LEGACY_BINDING_GENERATION): Promise<string | null> {
    const rows = await db
        .select({ snapshotDate: ga4Metrics.snapshotDate })
        .from(ga4Metrics)
        .where(and(eq(ga4Metrics.siteId, siteId), eq(ga4Metrics.bindingGenerationId, bindingGenerationId), eq(ga4Metrics.dimensionSet, dimensionSet), eq(ga4Metrics.windowDays, windowDays)))
        .orderBy(desc(ga4Metrics.snapshotDate))
        .limit(1);
    return rows[0]?.snapshotDate ?? null;
}
export interface Ga4SnapshotTotals {
    snapshotDate: string;
    sessions: number;
    activeUsers: number;
    engagedSessions: number;
    keyEvents: number;
}
/**
 * Summed metrics of the newest snapshot (same window) strictly BEFORE
 * `beforeDate` — the previous-period baseline for the summary delta. Null
 * when this is the first run.
 */
export async function readPreviousGa4Totals(db: SnapshotReadDb, siteId: string, dimensionSet: string, windowDays: number, beforeDate: string, bindingGenerationId = LEGACY_BINDING_GENERATION): Promise<Ga4SnapshotTotals | null> {
    const previous = await db
        .select({ snapshotDate: ga4Metrics.snapshotDate })
        .from(ga4Metrics)
        .where(and(eq(ga4Metrics.siteId, siteId), eq(ga4Metrics.bindingGenerationId, bindingGenerationId), eq(ga4Metrics.dimensionSet, dimensionSet), eq(ga4Metrics.windowDays, windowDays), lt(ga4Metrics.snapshotDate, beforeDate)))
        .orderBy(desc(ga4Metrics.snapshotDate))
        .limit(1);
    const snapshotDate = previous[0]?.snapshotDate;
    if (snapshotDate === undefined)
        return null;
    const totals = await db
        .select({
        sessions: sql<number> `coalesce(sum(${ga4Metrics.sessions}), 0)::int`,
        activeUsers: sql<number> `coalesce(sum(${ga4Metrics.activeUsers}), 0)::int`,
        engagedSessions: sql<number> `coalesce(sum(${ga4Metrics.engagedSessions}), 0)::int`,
        keyEvents: sql<number> `coalesce(sum(${ga4Metrics.keyEvents}), 0)::int`,
    })
        .from(ga4Metrics)
        .where(and(eq(ga4Metrics.siteId, siteId), eq(ga4Metrics.bindingGenerationId, bindingGenerationId), eq(ga4Metrics.dimensionSet, dimensionSet), eq(ga4Metrics.windowDays, windowDays), eq(ga4Metrics.snapshotDate, snapshotDate)));
    return {
        snapshotDate,
        sessions: totals[0]!.sessions,
        activeUsers: totals[0]!.activeUsers,
        engagedSessions: totals[0]!.engagedSessions,
        keyEvents: totals[0]!.keyEvents,
    };
}
type SnapshotReadDb = Pick<Db, 'select'>;
