/**
 * GSC daily-snapshot repository.
 *
 * Postgres per the drizzle-postgres-scope rule: Search Analytics rows and
 * sitemap health are relational, ordered time-series data. One snapshot per
 * `(siteId, snapshotDate)` — the audit processor writes after a successful
 * vendor query; the `?tab=google` summary route reads the latest snapshot.
 *
 * Writes are REPLACE-on-conflict at snapshot granularity: a re-run for the
 * same `(siteId, snapshotDate, dimensionSet)` deletes the prior row set and
 * inserts the fresh one inside a transaction, so a retried audit never
 * duplicates and never leaves a stale partial mix.
 */
import { and, asc, desc, eq, gte, inArray, lt, lte, max, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { GSC_DIMENSION_KEY_SEPARATOR, gscSearchAnalytics, gscSearchAppearance, gscSyncRuns, gscSitemaps, type GscSearchAnalyticsSnapshotRow, type GscSearchAppearanceSnapshotRow, type GscSitemapSnapshotRow, type GscSyncRun, type GscSyncRunStatus, } from '../../db/schema/index.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import { classifySearchAppearance, type SearchAppearanceClassificationSlug, } from '../../shared/providers/google/searchAppearanceClassification.js';
import type { GscSearchAnalyticsRow, GscSitemapEntry, } from '../../shared/providers/index.js';
const LEGACY_BINDING_GENERATION = 'legacy';
export interface UpsertSearchAnalyticsInput {
    siteId: string;
    accountId: string;
    bindingGenerationId?: string;
    /** YYYY-MM-DD — the lag-adjusted endDate of the queried window. */
    snapshotDate: string;
    /** Requested dimensions joined with a comma, e.g. "query" | "page". */
    dimensionSet: string;
    /** Window length in days ending at snapshotDate; default 28 (historical). */
    windowDays?: number;
    rows: readonly GscSearchAnalyticsRow[];
}
export async function upsertSearchAnalytics(db: Db, input: UpsertSearchAnalyticsInput): Promise<void> {
    const windowDays = input.windowDays ?? 28;
    const bindingGenerationId = input.bindingGenerationId ?? LEGACY_BINDING_GENERATION;
    // Last-write-wins dedupe inside the batch — the unique index would reject
    // a duplicate dimensionKey arriving twice in one INSERT.
    const byKey = new Map<string, GscSearchAnalyticsRow>();
    for (const row of input.rows) {
        byKey.set(row.keys.join(GSC_DIMENSION_KEY_SEPARATOR), row);
    }
    await db.transaction(async (tx) => {
        await tx
            .delete(gscSearchAnalytics)
            .where(and(eq(gscSearchAnalytics.accountId, input.accountId), eq(gscSearchAnalytics.siteId, input.siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.snapshotDate, input.snapshotDate), eq(gscSearchAnalytics.dimensionSet, input.dimensionSet), eq(gscSearchAnalytics.windowDays, windowDays)));
        if (byKey.size === 0)
            return;
        await tx.insert(gscSearchAnalytics).values([...byKey.entries()].map(([dimensionKey, row]) => ({
            accountId: input.accountId,
            siteId: input.siteId,
            bindingGenerationId,
            snapshotDate: input.snapshotDate,
            dimensionSet: input.dimensionSet,
            windowDays,
            dimensionKey,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
        })));
    });
}
export interface PagesGscSnapshotKey {
    accountId: string;
    siteId: string;
    dimensionSet: 'page' | 'query,page';
    windowDays: 7 | 28 | 90;
    bindingGenerationId?: string;
}
export interface PagesGscSnapshot {
    snapshotDate: string;
    fetchedAt: Date;
    rows: GscSearchAnalyticsSnapshotRow[];
}
function pagesGscScope(input: PagesGscSnapshotKey) {
    if (!input.accountId || !input.siteId)
        throw new Error('GSC Pages read requires tenant scope');
    return and(eq(gscSearchAnalytics.accountId, input.accountId), eq(gscSearchAnalytics.siteId, input.siteId), eq(gscSearchAnalytics.bindingGenerationId, input.bindingGenerationId ?? LEGACY_BINDING_GENERATION), eq(gscSearchAnalytics.dimensionSet, input.dimensionSet), eq(gscSearchAnalytics.windowDays, input.windowDays))!;
}
export async function readPagesGscSnapshotAtDate(db: Db, input: PagesGscSnapshotKey, snapshotDate: string): Promise<PagesGscSnapshot> {
    const rows = await db
        .select()
        .from(gscSearchAnalytics)
        .where(and(pagesGscScope(input), eq(gscSearchAnalytics.snapshotDate, snapshotDate)))
        .orderBy(desc(gscSearchAnalytics.clicks), asc(gscSearchAnalytics.dimensionKey));
    const fetchedAt = rows.reduce((latest, row) => (row.fetchedAt > latest ? row.fetchedAt : latest), rows[0]?.fetchedAt ?? new Date(0));
    return { snapshotDate, fetchedAt, rows };
}
/** Tenant-scoped latest successful materialized snapshot for Pages. */
export async function readLatestPagesGscSnapshot(db: Db, input: PagesGscSnapshotKey): Promise<PagesGscSnapshot | null> {
    const dates = await db
        .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics)
        .where(pagesGscScope(input))
        .orderBy(desc(gscSearchAnalytics.snapshotDate))
        .limit(1);
    const date = dates[0]?.snapshotDate;
    return date ? readPagesGscSnapshotAtDate(db, input, date) : null;
}
export async function readPreviousPagesGscSnapshot(db: Db, input: PagesGscSnapshotKey & {
    beforeDate: string;
}): Promise<PagesGscSnapshot | null> {
    const dates = await db
        .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics)
        .where(and(pagesGscScope(input), lt(gscSearchAnalytics.snapshotDate, input.beforeDate)))
        .orderBy(desc(gscSearchAnalytics.snapshotDate))
        .limit(1);
    const date = dates[0]?.snapshotDate;
    return date ? readPagesGscSnapshotAtDate(db, input, date) : null;
}
export async function readPagesGscHistory(db: Db, input: PagesGscSnapshotKey & {
    since: string;
    until: string;
    limit?: number;
}): Promise<PagesGscSnapshot[]> {
    const dates = await db
        .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics)
        .where(and(pagesGscScope(input), gte(gscSearchAnalytics.snapshotDate, input.since), lte(gscSearchAnalytics.snapshotDate, input.until)))
        .groupBy(gscSearchAnalytics.snapshotDate)
        .orderBy(desc(gscSearchAnalytics.snapshotDate))
        .limit(Math.min(Math.max(input.limit ?? 90, 1), 90));
    const snapshots = await Promise.all(dates.map(({ snapshotDate }) => readPagesGscSnapshotAtDate(db, input, snapshotDate)));
    return snapshots.reverse();
}
export interface StartGscSyncRunInput {
    accountId: string;
    siteId: string;
    propertyUrlHash: string;
    bindingGenerationId?: string;
    startedAt: Date;
}
export const GSC_SYNC_RUN_RETENTION_DAYS = 400;
export async function startGscSyncRun(db: Db, input: StartGscSyncRunInput): Promise<GscSyncRun> {
    const bindingGenerationId = input.bindingGenerationId ?? LEGACY_BINDING_GENERATION;
    return db.transaction(async (tx) => {
        await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${`${input.accountId}:${input.siteId}:gsc-sync`}))`);
        const [{ generation = 0 } = {}] = await tx
            .select({ generation: max(gscSyncRuns.generation) })
            .from(gscSyncRuns)
            .where(and(eq(gscSyncRuns.accountId, input.accountId), eq(gscSyncRuns.siteId, input.siteId), eq(gscSyncRuns.bindingGenerationId, bindingGenerationId)));
        const [row] = await tx
            .insert(gscSyncRuns)
            .values({
            ...input,
            bindingGenerationId,
            generation: Number(generation ?? 0) + 1,
            status: 'running',
        })
            .returning();
        if (!row)
            throw new Error('GSC sync run could not be started');
        return row;
    });
}
export async function finishGscSyncRun(db: Db, input: {
    id: string;
    accountId: string;
    siteId: string;
    status: Extract<GscSyncRunStatus, 'succeeded' | 'empty' | 'failed'>;
    completedAt: Date;
    snapshotDate: string | null;
    failureClass: string | null;
}): Promise<void> {
    await db.transaction(async (tx) => {
        await tx
            .update(gscSyncRuns)
            .set({
            status: input.status,
            completedAt: input.completedAt,
            snapshotDate: input.snapshotDate,
            lastSuccessAt: input.status === 'failed' ? null : input.completedAt,
            failureClass: input.failureClass,
        })
            .where(and(eq(gscSyncRuns.id, input.id), eq(gscSyncRuns.accountId, input.accountId), eq(gscSyncRuns.siteId, input.siteId)));
        const runs = await tx
            .select({ id: gscSyncRuns.id, startedAt: gscSyncRuns.startedAt })
            .from(gscSyncRuns)
            .where(and(eq(gscSyncRuns.accountId, input.accountId), eq(gscSyncRuns.siteId, input.siteId)))
            .orderBy(desc(gscSyncRuns.generation), desc(gscSyncRuns.id));
        const cutoff = new Date(input.completedAt.getTime() - GSC_SYNC_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const expiredIds = runs.slice(1).filter((run) => run.startedAt < cutoff).map((run) => run.id);
        if (expiredIds.length > 0) {
            await tx.delete(gscSyncRuns).where(and(eq(gscSyncRuns.accountId, input.accountId), eq(gscSyncRuns.siteId, input.siteId), inArray(gscSyncRuns.id, expiredIds)));
        }
    });
}
export async function readLatestGscSyncRun(db: Db, input: {
    accountId: string;
    siteId: string;
    propertyUrlHash: string;
    bindingGenerationId?: string;
}): Promise<GscSyncRun | null> {
    const rows = await db
        .select()
        .from(gscSyncRuns)
        .where(and(eq(gscSyncRuns.accountId, input.accountId), eq(gscSyncRuns.siteId, input.siteId), eq(gscSyncRuns.bindingGenerationId, input.bindingGenerationId ?? LEGACY_BINDING_GENERATION), eq(gscSyncRuns.propertyUrlHash, input.propertyUrlHash)))
        .orderBy(desc(gscSyncRuns.generation), desc(gscSyncRuns.id))
        .limit(1);
    return rows[0] ?? null;
}
export interface UpsertSitemapsInput {
    siteId: string;
    accountId: string;
    bindingGenerationId?: string;
    snapshotDate: string;
    entries: readonly GscSitemapEntry[];
}
export async function upsertSitemaps(db: Db, input: UpsertSitemapsInput): Promise<void> {
    const bindingGenerationId = input.bindingGenerationId ?? LEGACY_BINDING_GENERATION;
    const byPath = new Map<string, GscSitemapEntry>();
    for (const entry of input.entries)
        byPath.set(entry.path, entry);
    await db.transaction(async (tx) => {
        await tx
            .delete(gscSitemaps)
            .where(and(eq(gscSitemaps.siteId, input.siteId), eq(gscSitemaps.bindingGenerationId, bindingGenerationId), eq(gscSitemaps.snapshotDate, input.snapshotDate)));
        if (byPath.size === 0)
            return;
        await tx.insert(gscSitemaps).values([...byPath.values()].map((entry) => ({
            accountId: input.accountId,
            siteId: input.siteId,
            bindingGenerationId,
            snapshotDate: input.snapshotDate,
            path: entry.path,
            type: entry.type,
            lastSubmitted: entry.lastSubmitted,
            lastDownloaded: entry.lastDownloaded,
            isPending: entry.isPending,
            isSitemapsIndex: entry.isSitemapsIndex,
            errors: entry.errors,
            warnings: entry.warnings,
            processed: entry.processed,
        })));
    });
}
export interface ReadSearchAnalyticsRange {
    /** YYYY-MM-DD inclusive. */
    since?: string;
    /** YYYY-MM-DD inclusive. */
    until?: string;
}
/** Ordered for trend queries: snapshotDate ASC, clicks DESC within a day. */
export async function readSearchAnalytics(db: SnapshotReadDb, siteId: string, dimensionSet: string, range: ReadSearchAnalyticsRange = {}, windowDays = 28, bindingGenerationId = LEGACY_BINDING_GENERATION): Promise<GscSearchAnalyticsSnapshotRow[]> {
    const conditions = [
        eq(gscSearchAnalytics.siteId, siteId),
        eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId),
        eq(gscSearchAnalytics.dimensionSet, dimensionSet),
        eq(gscSearchAnalytics.windowDays, windowDays),
    ];
    if (range.since !== undefined) {
        conditions.push(gte(gscSearchAnalytics.snapshotDate, range.since));
    }
    if (range.until !== undefined) {
        conditions.push(lte(gscSearchAnalytics.snapshotDate, range.until));
    }
    return db
        .select()
        .from(gscSearchAnalytics)
        .where(and(...conditions))
        .orderBy(gscSearchAnalytics.snapshotDate, desc(gscSearchAnalytics.clicks));
}
/** Latest persisted snapshotDate for a site+dimensionSet+window, or null. */
export async function readLatestSnapshotDate(db: SnapshotReadDb, siteId: string, dimensionSet: string, windowDays = 28, bindingGenerationId = LEGACY_BINDING_GENERATION): Promise<string | null> {
    const rows = await db
        .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.siteId, siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, dimensionSet), eq(gscSearchAnalytics.windowDays, windowDays)))
        .orderBy(desc(gscSearchAnalytics.snapshotDate))
        .limit(1);
    return rows[0]?.snapshotDate ?? null;
}
export interface SnapshotTotals {
    snapshotDate: string;
    clicks: number;
    impressions: number;
}
/**
 * Summed clicks/impressions of the newest snapshot strictly BEFORE
 * `beforeDate` — the previous-period baseline for the report delta. Null when
 * this is the first run.
 */
export async function readPreviousSnapshotTotals(db: SnapshotReadDb, siteId: string, dimensionSet: string, beforeDate: string, windowDays = 28, bindingGenerationId = LEGACY_BINDING_GENERATION): Promise<SnapshotTotals | null> {
    const previous = await db
        .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.siteId, siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, dimensionSet), eq(gscSearchAnalytics.windowDays, windowDays), lt(gscSearchAnalytics.snapshotDate, beforeDate)))
        .orderBy(desc(gscSearchAnalytics.snapshotDate))
        .limit(1);
    const snapshotDate = previous[0]?.snapshotDate;
    if (snapshotDate === undefined)
        return null;
    const totals = await db
        .select({
        clicks: sql<number> `coalesce(sum(${gscSearchAnalytics.clicks}), 0)::int`,
        impressions: sql<number> `coalesce(sum(${gscSearchAnalytics.impressions}), 0)::int`,
    })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.siteId, siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, dimensionSet), eq(gscSearchAnalytics.windowDays, windowDays), eq(gscSearchAnalytics.snapshotDate, snapshotDate)));
    return {
        snapshotDate,
        clicks: totals[0]!.clicks,
        impressions: totals[0]!.impressions,
    };
}
/** Pages/GSC refresh variant of previous totals with explicit tenant scope. */
export async function readPreviousSnapshotTotalsForAccount(db: Db, accountId: string, siteId: string, dimensionSet: string, beforeDate: string, bindingGenerationId = LEGACY_BINDING_GENERATION): Promise<SnapshotTotals | null> {
    if (!accountId || !siteId)
        throw new Error('GSC previous totals read requires tenant scope');
    const dates = await db
        .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.accountId, accountId), eq(gscSearchAnalytics.siteId, siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, dimensionSet), lt(gscSearchAnalytics.snapshotDate, beforeDate)))
        .orderBy(desc(gscSearchAnalytics.snapshotDate))
        .limit(1);
    const snapshotDate = dates[0]?.snapshotDate;
    if (!snapshotDate)
        return null;
    const rows = await db
        .select({ clicks: gscSearchAnalytics.clicks, impressions: gscSearchAnalytics.impressions })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.accountId, accountId), eq(gscSearchAnalytics.siteId, siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.snapshotDate, snapshotDate), eq(gscSearchAnalytics.dimensionSet, dimensionSet)));
    return {
        snapshotDate,
        clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
        impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    };
}
// ---------------------------------------------------------------------------
// Search appearance (GSC generative-AI appearance)
// ---------------------------------------------------------------------------
/**
 * Raw Google row shape for the `searchAppearance` dimension. The provider
 * echoes `keys[0]` = the raw appearance label; the caller passes it through
 * verbatim so the classifier + storage layer can preserve unknown labels.
 */
export interface GscSearchAppearanceRow {
    rawAppearance: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
export interface UpsertSearchAppearanceInput {
    siteId: string;
    accountId: string;
    property: string;
    bindingGenerationId?: string;
    /** YYYY-MM-DD — the lag-adjusted endDate of the queried window. */
    snapshotDate: string;
    /** Window length in days ending at snapshotDate; default 28. */
    windowDays?: number;
    rows: readonly GscSearchAppearanceRow[];
    observationMeta: ObservationMeta;
}
/**
 * REPLACE-on-conflict at (siteId, property, snapshotDate, windowDays)
 * granularity. Classifier decorates each row on write — the raw value is
 * preserved verbatim so future recognition list changes can retrospectively
 * re-classify snapshots without re-fetching.
 *
 * Zero-filling is NEVER performed: absent rows stay absent. The read DTO
 * decides `unavailable` at query time.
 */
export async function upsertSearchAppearance(db: Db, input: UpsertSearchAppearanceInput): Promise<void> {
    const windowDays = input.windowDays ?? 28;
    const bindingGenerationId = input.bindingGenerationId ?? LEGACY_BINDING_GENERATION;
    const byRaw = new Map<string, GscSearchAppearanceRow>();
    for (const row of input.rows)
        byRaw.set(row.rawAppearance, row);
    await db.transaction(async (tx) => {
        await tx
            .delete(gscSearchAppearance)
            .where(and(eq(gscSearchAppearance.siteId, input.siteId), eq(gscSearchAppearance.bindingGenerationId, bindingGenerationId), eq(gscSearchAppearance.property, input.property), eq(gscSearchAppearance.snapshotDate, input.snapshotDate), eq(gscSearchAppearance.windowDays, windowDays)));
        if (byRaw.size === 0)
            return;
        await tx.insert(gscSearchAppearance).values([...byRaw.values()].map((row) => {
            const classification = classifySearchAppearance(row.rawAppearance);
            return {
                accountId: input.accountId,
                siteId: input.siteId,
                bindingGenerationId,
                property: input.property,
                snapshotDate: input.snapshotDate,
                windowDays,
                rawAppearance: row.rawAppearance,
                classificationSlug: classification.slug,
                classifiedGenerative: classification.isGenerative,
                clicks: row.clicks,
                impressions: row.impressions,
                ctr: row.ctr,
                position: row.position,
                observationMeta: input.observationMeta,
            };
        }));
    });
}
export interface ReadSearchAppearanceOpts {
    windowDays?: number;
    /** Restrict to a specific snapshot day; defaults to the latest. */
    snapshotDate?: string;
    bindingGenerationId?: string;
}
/**
 * Return every stored row for the target property + snapshot day (or the
 * latest snapshot for the property when day is omitted). Rows are ordered so
 * generative rows come first, then by clicks desc — deterministic for tests
 * and UI. Empty array = no data for that key.
 */
export async function readSearchAppearance(db: SnapshotReadDb, siteId: string, property: string, opts: ReadSearchAppearanceOpts = {}): Promise<GscSearchAppearanceSnapshotRow[]> {
    const windowDays = opts.windowDays ?? 28;
    const bindingGenerationId = opts.bindingGenerationId ?? LEGACY_BINDING_GENERATION;
    let targetDate = opts.snapshotDate;
    if (targetDate === undefined) {
        const latest = await db
            .select({ snapshotDate: gscSearchAppearance.snapshotDate })
            .from(gscSearchAppearance)
            .where(and(eq(gscSearchAppearance.siteId, siteId), eq(gscSearchAppearance.bindingGenerationId, bindingGenerationId), eq(gscSearchAppearance.property, property), eq(gscSearchAppearance.windowDays, windowDays)))
            .orderBy(desc(gscSearchAppearance.snapshotDate))
            .limit(1);
        targetDate = latest[0]?.snapshotDate;
        if (targetDate === undefined)
            return [];
    }
    return db
        .select()
        .from(gscSearchAppearance)
        .where(and(eq(gscSearchAppearance.siteId, siteId), eq(gscSearchAppearance.bindingGenerationId, bindingGenerationId), eq(gscSearchAppearance.property, property), eq(gscSearchAppearance.snapshotDate, targetDate), eq(gscSearchAppearance.windowDays, windowDays)))
        .orderBy(desc(gscSearchAppearance.classifiedGenerative), desc(gscSearchAppearance.clicks), gscSearchAppearance.rawAppearance);
}
/** Provider-neutral generative-AI appearance status enum. */
export const GSC_GENERATIVE_APPEARANCE_STATUSES = [
    'available',
    'unavailable',
    'partial',
    'reconnect_required',
    'failed',
] as const;
export type GscGenerativeAppearanceStatus = (typeof GSC_GENERATIVE_APPEARANCE_STATUSES)[number];
/**
 * Provider-neutral row exposed to the UI + digest projection. Only bounded
 * safe fields — no raw vendor envelopes, no request payloads.
 */
export interface GscGenerativeAppearanceReadRow {
    rawAppearance: string;
    classificationSlug: SearchAppearanceClassificationSlug;
    isGenerative: boolean;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
export interface GscGenerativeAppearanceReadWindow {
    start: string;
    end: string;
    windowDays: number;
}
/**
 * Read DTO for `?tab=google → Generative AI appearance` and the weekly
 * pulse digest section. First-party only — NEVER merged with vendor mention
 * / SOV metrics.
 */
export interface GscGenerativeAppearanceRead {
    status: GscGenerativeAppearanceStatus;
    window: GscGenerativeAppearanceReadWindow | null;
    rows: GscGenerativeAppearanceReadRow[];
    observationMeta: ObservationMeta | null;
}
export interface BuildGenerativeAppearanceReadOpts {
    /** Explicit degraded state override — used for token/quota failures. */
    status?: Exclude<GscGenerativeAppearanceStatus, 'available' | 'unavailable'>;
}
/**
 * Fold a persisted snapshot row set into the provider-neutral read DTO.
 *
 * Truth table:
 *   - `status='available'` when at least one row is classifier-recognized as
 *     generative (values preserved verbatim, including zero clicks).
 *   - `status='unavailable'` when NO recognized generative row exists —
 *     non-generative rows may still be returned but never zero-filled into
 *     a synthetic generative row.
 *   - Explicit `partial | reconnect_required | failed` overrides both.
 */
export function buildGenerativeAppearanceRead(rows: readonly GscSearchAppearanceSnapshotRow[], opts: BuildGenerativeAppearanceReadOpts = {}): GscGenerativeAppearanceRead {
    if (opts.status !== undefined) {
        return {
            status: opts.status,
            window: null,
            rows: [],
            observationMeta: null,
        };
    }
    if (rows.length === 0) {
        return {
            status: 'unavailable',
            window: null,
            rows: [],
            observationMeta: null,
        };
    }
    const anyGenerative = rows.some((row) => row.classifiedGenerative);
    const first = rows[0]!;
    const meta = first.observationMeta as ObservationMeta;
    const snapshotDate = first.snapshotDate;
    const windowDays = first.windowDays;
    return {
        status: anyGenerative ? 'available' : 'unavailable',
        window: {
            start: shiftDate(snapshotDate, -(windowDays - 1)),
            end: snapshotDate,
            windowDays,
        },
        rows: rows.map((row) => ({
            rawAppearance: row.rawAppearance,
            classificationSlug: row.classificationSlug as SearchAppearanceClassificationSlug,
            isGenerative: row.classifiedGenerative,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
        })),
        observationMeta: meta,
    };
}
/** YYYY-MM-DD arithmetic — UTC, no timezone drift. */
function shiftDate(iso: string, days: number): string {
    const parts = iso.split('-').map(Number);
    const d = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
/** Sitemap rows for a snapshot; defaults to the latest one. */
export async function readSitemaps(db: SnapshotReadDb, siteId: string, snapshotDate?: string, bindingGenerationId = LEGACY_BINDING_GENERATION): Promise<GscSitemapSnapshotRow[]> {
    let targetDate = snapshotDate;
    if (targetDate === undefined) {
        const latest = await db
            .select({ snapshotDate: gscSitemaps.snapshotDate })
            .from(gscSitemaps)
            .where(and(eq(gscSitemaps.siteId, siteId), eq(gscSitemaps.bindingGenerationId, bindingGenerationId)))
            .orderBy(desc(gscSitemaps.snapshotDate))
            .limit(1);
        targetDate = latest[0]?.snapshotDate;
        if (targetDate === undefined)
            return [];
    }
    return db
        .select()
        .from(gscSitemaps)
        .where(and(eq(gscSitemaps.siteId, siteId), eq(gscSitemaps.bindingGenerationId, bindingGenerationId), eq(gscSitemaps.snapshotDate, targetDate)))
        .orderBy(gscSitemaps.path);
}
type SnapshotReadDb = Pick<Db, 'select'>;
