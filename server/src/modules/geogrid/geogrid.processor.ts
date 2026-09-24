/**
 * Geogrid scan processor.
 *
 * The Redis payload carries identity only; the grid definition, the keyword,
 * and the cell coordinates all reload from the account-scoped
 * `geogrid_scans` row, so a replayed job can never widen the fan-out beyond
 * the ≤49 cells the scan was created for.
 *
 * Cells run in bounded sequential batches (never one unbounded `Promise.all`
 * over 49 vendor calls). Every cell the vendor answers is persisted as a
 * `geogrid_snapshots` row; every cell it does not is recorded as a failed
 * point index. The two sets are disjoint, so a failed cell can never be
 * presented as "not in the pack".
 */
import type { Job, Processor } from 'bullmq';
import { and, arrayOverlaps, eq, not, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import { geogridScans, geogridSnapshots, type GeogridScanRow, type GeogridSize, type NewGeogridSnapshotRow, } from '../../db/schema/geogrid.js';
import { captureVendorCost } from '../../shared/providers/cost-capture.js';
import type { RankProvider } from '../../shared/providers/types.js';
import { geogridScanJobSchema, parseConsumedPayload, type GeogridScanJob, } from '../../shared/queue/index.js';
import { Site } from '../sites/index.js';
import { deriveGridCells, type GeogridCell } from './geogrid.geometry.js';
import { addCostMicros, loadScanForProcessing, resolveTerminalStatus, } from './geogrid.service.js';
/** At most this many vendor calls are in flight at once. */
export const GEOGRID_CELL_BATCH_SIZE = 5;
/** Single clock seam — production omits `now`, tests pin it. */
function nowOf(deps: Pick<GeogridProcessorDeps, 'now'>): Date {
    return deps.now ? deps.now() : new Date();
}
const TERMINAL_STATUSES = new Set(['completed', 'completed_partial', 'failed']);
export const GEOGRID_FAILURE_REASONS = {
    siteMissing: 'geogrid.failure.siteMissing',
    allCellsFailed: 'geogrid.failure.allCellsFailed',
    processing: 'geogrid.failure.processing',
} as const;
export interface GeogridProcessorDeps {
    db: Db;
    rank: RankProvider;
    logger: Logger;
    now?: () => Date;
    batchSize?: number;
}
/** Split into bounded chunks; the last chunk may be short. */
export function chunkCells(cells: GeogridCell[], size: number): GeogridCell[][] {
    const batches: GeogridCell[][] = [];
    for (let index = 0; index < cells.length; index += size) {
        batches.push(cells.slice(index, index + size));
    }
    return batches;
}
interface CellOutcome {
    cell: GeogridCell;
    snapshot: NewGeogridSnapshotRow;
    costMicros: bigint | null;
}
interface GeogridProgress {
    observed: number;
    notInPack: number;
    failed: number;
    failedPointIndexes: number[];
    costMicros: bigint;
}
async function readDurableProgress(scan: GeogridScanRow, deps: Pick<GeogridProcessorDeps, 'db'>): Promise<GeogridProgress> {
    const [scanRows, snapshots] = await Promise.all([
        deps.db
            .select({
            attemptedPointIndexes: geogridScans.attemptedPointIndexes,
            costMicros: geogridScans.costMicros,
        })
            .from(geogridScans)
            .where(eq(geogridScans.id, scan.id))
            .limit(1),
        deps.db
            .select({ pointIndex: geogridSnapshots.pointIndex, position: geogridSnapshots.position })
            .from(geogridSnapshots)
            .where(eq(geogridSnapshots.scanId, scan.id)),
    ]);
    const current = scanRows[0];
    const retainedIndexes = new Set(snapshots.map((row) => row.pointIndex));
    const failedPointIndexes = (current?.attemptedPointIndexes ?? []).filter((pointIndex) => !retainedIndexes.has(pointIndex));
    return {
        observed: snapshots.filter((row) => row.position !== null).length,
        notInPack: snapshots.filter((row) => row.position === null).length,
        failed: failedPointIndexes.length,
        failedPointIndexes,
        costMicros: current?.costMicros ?? scan.costMicros,
    };
}
async function runCell(scan: GeogridScanRow, cell: GeogridCell, domain: string, deps: GeogridProcessorDeps): Promise<CellOutcome> {
    const { value, costMicros } = await captureVendorCost(() => deps.rank.checkLocalPackRank({
        keyword: scan.keyword,
        domain,
        languageCode: scan.languageCode,
        coordinate: { lat: cell.lat, lng: cell.lng, zoom: scan.zoom },
    }));
    return {
        cell,
        costMicros,
        snapshot: {
            scanId: scan.id,
            accountId: scan.accountId,
            siteId: scan.siteId,
            keywordId: scan.keywordId,
            pointIndex: cell.pointIndex,
            lat: cell.lat,
            lng: cell.lng,
            position: value.position,
            totalPackSize: value.totalPackSize,
            capturedAt: value.checkedAt,
        },
    };
}
async function finishScan(scan: GeogridScanRow, totals: GeogridProgress, deps: GeogridProcessorDeps): Promise<void> {
    const now = nowOf(deps);
    const retained = totals.observed + totals.notInPack;
    const status = resolveTerminalStatus(scan.totalCells, retained);
    await deps.db
        .update(geogridScans)
        .set({
        status,
        observedCells: totals.observed,
        notInPackCells: totals.notInPack,
        failedCells: totals.failed,
        failedPointIndexes: totals.failedPointIndexes,
        costMicros: totals.costMicros,
        finishedAt: now,
        failureReason: status === 'failed' ? GEOGRID_FAILURE_REASONS.allCellsFailed : null,
    })
        .where(eq(geogridScans.id, scan.id));
}
async function failScanBeforeCells(scan: GeogridScanRow, reason: string, deps: GeogridProcessorDeps): Promise<void> {
    const now = nowOf(deps);
    await deps.db
        .update(geogridScans)
        .set({ status: 'failed', failureReason: reason, finishedAt: now })
        .where(eq(geogridScans.id, scan.id));
}
async function claimCellBatch(scanId: string, batch: readonly GeogridCell[], deps: Pick<GeogridProcessorDeps, 'db'>): Promise<boolean> {
    const pointIndexes = batch.map((cell) => cell.pointIndex);
    const pointIndexSql = sql.join(pointIndexes.map((pointIndex) => sql `${pointIndex}`), sql `, `);
    const claimed = await deps.db
        .update(geogridScans)
        .set({
        attemptedPointIndexes: sql<number[]> `array_cat(${geogridScans.attemptedPointIndexes}, ARRAY[${pointIndexSql}]::integer[])`,
    })
        .where(and(eq(geogridScans.id, scanId), not(arrayOverlaps(geogridScans.attemptedPointIndexes, pointIndexes))))
        .returning({ id: geogridScans.id });
    return claimed.length > 0;
}
export async function runGeogridScan(payload: GeogridScanJob, deps: GeogridProcessorDeps): Promise<void> {
    const scan = await loadScanForProcessing(deps.db, payload.accountId, payload.scanId);
    if (!scan || TERMINAL_STATUSES.has(scan.status))
        return;
    const site = await Site.findOne({
        _id: scan.siteId,
        accountId: scan.accountId,
        deletionStartedAt: null,
    });
    if (!site) {
        await failScanBeforeCells(scan, GEOGRID_FAILURE_REASONS.siteMissing, deps);
        return;
    }
    const now = nowOf(deps);
    await deps.db
        .update(geogridScans)
        .set({ status: 'running', startedAt: scan.startedAt ?? now })
        .where(eq(geogridScans.id, scan.id));
    const cells = deriveGridCells({
        centerLat: scan.centerLat,
        centerLng: scan.centerLng,
        spacingMeters: scan.spacingMeters,
        gridSize: scan.gridSize as GeogridSize,
        zoom: scan.zoom,
    });
    const attempted = new Set(scan.attemptedPointIndexes);
    const pendingCells = cells.filter((cell) => !attempted.has(cell.pointIndex));
    let totals = await readDurableProgress(scan, deps);
    try {
        for (const batch of chunkCells(pendingCells, deps.batchSize ?? GEOGRID_CELL_BATCH_SIZE)) {
            // Claim before dispatch. If another delivery already claimed any point
            // in this deterministic batch, this delivery performs no vendor work.
            if (!(await claimCellBatch(scan.id, batch, deps)))
                continue;
            const settled = await Promise.allSettled(batch.map((cell) => runCell(scan, cell, site.domain, deps)));
            const rows: NewGeogridSnapshotRow[] = [];
            let batchCostMicros = 0n;
            for (let index = 0; index < settled.length; index += 1) {
                const result = settled[index]!;
                const cell = batch[index]!;
                if (result.status === 'rejected') {
                    deps.logger.warn({ scanId: scan.id, pointIndex: cell.pointIndex }, 'geogrid cell check failed');
                    continue;
                }
                batchCostMicros = addCostMicros(batchCostMicros, result.value.costMicros);
                rows.push(result.value.snapshot);
            }
            // Persist BEFORE counting: a cell is only "retained" once its
            // observation is durable, so a persistence failure can never leave the
            // scan claiming an observation it did not store.
            if (rows.length > 0) {
                await deps.db.insert(geogridSnapshots).values(rows).onConflictDoNothing();
            }
            if (batchCostMicros > 0n) {
                await deps.db
                    .update(geogridScans)
                    .set({
                    costMicros: sql `${geogridScans.costMicros} + ${batchCostMicros}`,
                })
                    .where(eq(geogridScans.id, scan.id));
            }
            totals = await readDurableProgress(scan, deps);
            await deps.db
                .update(geogridScans)
                .set({
                observedCells: totals.observed,
                notInPackCells: totals.notInPack,
                failedCells: totals.failed,
                failedPointIndexes: totals.failedPointIndexes,
            })
                .where(eq(geogridScans.id, scan.id));
        }
    }
    catch (error) {
        totals = await readDurableProgress(scan, deps);
        const retained = totals.observed + totals.notInPack;
        await deps.db
            .update(geogridScans)
            .set({
            status: resolveTerminalStatus(scan.totalCells, retained),
            failureReason: GEOGRID_FAILURE_REASONS.processing,
            observedCells: totals.observed,
            notInPackCells: totals.notInPack,
            failedCells: totals.failed,
            failedPointIndexes: totals.failedPointIndexes,
            costMicros: totals.costMicros,
            finishedAt: nowOf(deps),
        })
            .where(eq(geogridScans.id, scan.id));
        throw error;
    }
    await finishScan(scan, totals, deps);
}
export function createGeogridProcessor(deps: GeogridProcessorDeps): Processor<GeogridScanJob, void> {
    return async (job: Job<GeogridScanJob>) => {
        const payload = parseConsumedPayload(geogridScanJobSchema, job.data);
        await runGeogridScan(payload, deps);
    };
}
/** Called by the shared dead-letter hook after the final BullMQ attempt. */
export async function onGeogridJobExhausted(job: Job, deps: Pick<GeogridProcessorDeps, 'db'>): Promise<void> {
    const parsed = geogridScanJobSchema.safeParse(job.data);
    if (!parsed.success)
        return;
    const rows = await deps.db
        .select()
        .from(geogridScans)
        .where(and(eq(geogridScans.id, parsed.data.scanId), eq(geogridScans.accountId, parsed.data.accountId)))
        .limit(1);
    const scan = rows[0];
    if (!scan || TERMINAL_STATUSES.has(scan.status))
        return;
    const totals = await readDurableProgress(scan, deps);
    const retained = totals.observed + totals.notInPack;
    await deps.db
        .update(geogridScans)
        .set({
        status: resolveTerminalStatus(scan.totalCells, retained),
        failureReason: GEOGRID_FAILURE_REASONS.processing,
        observedCells: totals.observed,
        notInPackCells: totals.notInPack,
        failedCells: totals.failed,
        failedPointIndexes: totals.failedPointIndexes,
        costMicros: totals.costMicros,
        finishedAt: new Date(),
    })
        .where(eq(geogridScans.id, scan.id));
}
