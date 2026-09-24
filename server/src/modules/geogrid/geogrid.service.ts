/**
 * Geogrid scan service.
 *
 * Mandatory order on the create path: parse → own (404) → flag → insert scan
 * row → enqueue. An oversized grid, a foreign site, or a dark flag is refused
 * before any row is written.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { and, desc, eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { geogridScans, geogridSnapshots, type GeogridScanRow, type GeogridScanStatus, type GeogridSize, } from '../../db/schema/geogrid.js';
import { keywords } from '../../db/schema/keywords.js';
import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { enqueueGeogridScanJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { deriveGridCells, type GeogridCell } from './geogrid.geometry.js';
import type { GeogridDefinitionInput } from './geogrid.schema.js';
export const GEOGRID_UNAVAILABLE_KEY = 'geogrid.errors.unavailable';
export const GEOGRID_NOT_FOUND_KEY = 'geogrid.errors.notFound';
export const GEOGRID_KEYWORD_NOT_TRACKED_KEY = 'geogrid.errors.keywordNotTracked';
export function assertGeogridEnabled(): void {
    if (!env.GEOGRID_ENABLED)
        throw new HttpError(503, { code: 'GEOGRID_UNAVAILABLE', messageKey: GEOGRID_UNAVAILABLE_KEY });
}
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId))
        throw HttpError.notFound({ code: 'GEOGRID_NOT_FOUND', messageKey: GEOGRID_NOT_FOUND_KEY });
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'GEOGRID_NOT_FOUND', messageKey: GEOGRID_NOT_FOUND_KEY });
    return site;
}
export interface ResolvedGeogridKeyword {
    id: string;
    phrase: string;
    languageCode: string;
}
/**
 * Load the tracked keyword by id, scoped to the account AND the site. A
 * keyword belonging to another account or another site is a 404, never a 403
 * — the resource's existence is not disclosed.
 */
export async function resolveGeogridKeyword(db: Db, input: {
    accountId: string;
    siteId: string;
    keywordId: string;
}): Promise<ResolvedGeogridKeyword> {
    const rows = await db
        .select({
        id: keywords.id,
        phrase: keywords.phrase,
        languageCode: keywords.languageCode,
    })
        .from(keywords)
        .where(and(eq(keywords.id, input.keywordId), eq(keywords.accountId, input.accountId), eq(keywords.siteId, input.siteId), eq(keywords.active, true), eq(keywords.engine, 'google')))
        .limit(1);
    const row = rows[0];
    if (!row)
        throw HttpError.notFound({ code: 'GEOGRID_NOT_FOUND', messageKey: GEOGRID_NOT_FOUND_KEY });
    return row;
}
export interface GeogridServiceDeps {
    db: Db;
    queue: Queue | null;
    now?: () => Date;
}
/** Single clock seam — production omits `now`, tests pin it. */
function nowOf(deps: Pick<GeogridServiceDeps, 'now'>): Date {
    return deps.now ? deps.now() : new Date();
}
export interface GeogridPreviewResult {
    preview: SpendPreview;
    cellCount: number;
}
export async function previewGeogridScan(accountId: string, siteId: string, input: GeogridDefinitionInput, deps: Pick<GeogridServiceDeps, 'db'>): Promise<GeogridPreviewResult> {
    await loadOwnedSite(accountId, siteId);
    await resolveGeogridKeyword(deps.db, { accountId, siteId, keywordId: input.keywordId });
    assertGeogridEnabled();
    return {
        preview: { deploymentMode: 'community', capacityEnforced: false },
        cellCount: input.gridSize * input.gridSize,
    };
}
export interface CreateGeogridScanResult {
    scanId: string;
    status: GeogridScanStatus;
    cellCount: number;
}
export async function createGeogridScan(accountId: string, siteId: string, input: GeogridDefinitionInput, deps: GeogridServiceDeps): Promise<CreateGeogridScanResult> {
    const site = await loadOwnedSite(accountId, siteId);
    assertSiteNotPaused(site);
    const keyword = await resolveGeogridKeyword(deps.db, {
        accountId,
        siteId,
        keywordId: input.keywordId,
    });
    assertGeogridEnabled();
    if (!deps.queue)
        throw new HttpError(503, { code: 'GEOGRID_UNAVAILABLE', messageKey: GEOGRID_UNAVAILABLE_KEY });
    const gridSize = input.gridSize as GeogridSize;
    const cellCount = gridSize * gridSize;
    const scanId = randomUUID();
    const now = nowOf(deps);
    await deps.db
        .insert(geogridScans)
        .values({
        id: scanId,
        accountId,
        siteId,
        keywordId: keyword.id,
        keyword: keyword.phrase,
        languageCode: keyword.languageCode,
        centerLat: input.centerLat,
        centerLng: input.centerLng,
        spacingMeters: input.spacingMeters,
        gridSize,
        zoom: input.zoom,
        status: 'queued',
        totalCells: cellCount,
        createdAt: now,
    });
    try {
        await enqueueGeogridScanJob(deps.queue, { accountId, siteId, scanId });
    }
    catch (error) {
        await deps.db
            .update(geogridScans)
            .set({ status: 'failed', failureReason: 'geogrid.failure.enqueue', finishedAt: now })
            .where(and(eq(geogridScans.id, scanId), eq(geogridScans.accountId, accountId)));
        throw new HttpError(503, { code: 'GEOGRID_UNAVAILABLE', messageKey: GEOGRID_UNAVAILABLE_KEY }, undefined, { cause: error });
    }
    return { scanId, status: 'queued', cellCount };
}
// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export interface GeogridScanSummaryDto {
    id: string;
    keywordId: string;
    keyword: string;
    status: GeogridScanStatus;
    centerLat: number;
    centerLng: number;
    spacingMeters: number;
    gridSize: number;
    zoom: number;
    totalCells: number;
    observedCells: number;
    notInPackCells: number;
    failedCells: number;
    createdAt: string;
    finishedAt: string | null;
    failureReason: string | null;
}
/**
 * The cell DTO is a discriminated union by design: `failed` carries no
 * position, no pack size, and no `capturedAt`, so a failed cell is
 * structurally incapable of rendering as a rank or as "not in the pack".
 */
export type GeogridCellDto = {
    pointIndex: number;
    lat: number;
    lng: number;
    state: 'observed';
    position: number;
    totalPackSize: number;
    capturedAt: string;
} | {
    pointIndex: number;
    lat: number;
    lng: number;
    state: 'not_in_pack';
    position: null;
    totalPackSize: number;
    capturedAt: string;
} | {
    pointIndex: number;
    lat: number;
    lng: number;
    state: 'failed';
};
export interface GeogridScanDetailDto extends GeogridScanSummaryDto {
    cells: GeogridCellDto[];
}
function toSummary(row: GeogridScanRow): GeogridScanSummaryDto {
    return {
        id: row.id,
        keywordId: row.keywordId,
        keyword: row.keyword,
        status: row.status,
        centerLat: row.centerLat,
        centerLng: row.centerLng,
        spacingMeters: row.spacingMeters,
        gridSize: row.gridSize,
        zoom: row.zoom,
        totalCells: row.totalCells,
        observedCells: row.observedCells,
        notInPackCells: row.notInPackCells,
        failedCells: row.failedCells,
        createdAt: row.createdAt.toISOString(),
        finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
        failureReason: row.failureReason,
    };
}
export async function listGeogridScans(accountId: string, siteId: string, query: {
    keywordId?: string;
    limit: number;
}, deps: Pick<GeogridServiceDeps, 'db'>): Promise<{
    scans: GeogridScanSummaryDto[];
}> {
    await loadOwnedSite(accountId, siteId);
    const filters = [eq(geogridScans.accountId, accountId), eq(geogridScans.siteId, siteId)];
    if (query.keywordId)
        filters.push(eq(geogridScans.keywordId, query.keywordId));
    const rows = await deps.db
        .select()
        .from(geogridScans)
        .where(and(...filters))
        .orderBy(desc(geogridScans.createdAt))
        .limit(query.limit);
    return { scans: rows.map(toSummary) };
}
/**
 * Detail read. Stored scans stay readable when `GEOGRID_ENABLED` is off —
 * the kill switch closes NEW runs, never the archive.
 */
export async function getGeogridScan(accountId: string, siteId: string, scanId: string, deps: Pick<GeogridServiceDeps, 'db'>): Promise<GeogridScanDetailDto> {
    await loadOwnedSite(accountId, siteId);
    const rows = await deps.db
        .select()
        .from(geogridScans)
        .where(and(eq(geogridScans.id, scanId), eq(geogridScans.accountId, accountId), eq(geogridScans.siteId, siteId)))
        .limit(1);
    const scan = rows[0];
    if (!scan)
        throw HttpError.notFound({ code: 'GEOGRID_NOT_FOUND', messageKey: GEOGRID_NOT_FOUND_KEY });
    const snapshots = await deps.db
        .select()
        .from(geogridSnapshots)
        .where(eq(geogridSnapshots.scanId, scan.id))
        .orderBy(geogridSnapshots.pointIndex);
    return { ...toSummary(scan), cells: buildCellDtos(scan, snapshots) };
}
/**
 * Build the per-cell DTOs. Cells with a snapshot row are `observed` /
 * `not_in_pack`; cells listed in `failed_point_indexes` are `failed`; a cell
 * that is in neither set (an in-flight scan) is omitted entirely rather than
 * being shown as an outcome it does not have.
 */
export function buildCellDtos(scan: Pick<GeogridScanRow, 'centerLat' | 'centerLng' | 'spacingMeters' | 'gridSize' | 'zoom' | 'failedPointIndexes'>, snapshots: Array<Pick<typeof geogridSnapshots.$inferSelect, 'pointIndex' | 'lat' | 'lng' | 'position' | 'totalPackSize' | 'capturedAt'>>): GeogridCellDto[] {
    const geometry = new Map<number, GeogridCell>(deriveGridCells({
        centerLat: scan.centerLat,
        centerLng: scan.centerLng,
        spacingMeters: scan.spacingMeters,
        gridSize: scan.gridSize as GeogridSize,
        zoom: scan.zoom,
    }).map((cell) => [cell.pointIndex, cell]));
    const observed = new Map(snapshots.map((row) => [row.pointIndex, row]));
    const failed = new Set(scan.failedPointIndexes);
    const cells: GeogridCellDto[] = [];
    for (const [pointIndex, cell] of geometry) {
        const row = observed.get(pointIndex);
        if (row) {
            cells.push(row.position === null
                ? {
                    pointIndex,
                    lat: row.lat,
                    lng: row.lng,
                    state: 'not_in_pack',
                    position: null,
                    totalPackSize: row.totalPackSize,
                    capturedAt: row.capturedAt.toISOString(),
                }
                : {
                    pointIndex,
                    lat: row.lat,
                    lng: row.lng,
                    state: 'observed',
                    position: row.position,
                    totalPackSize: row.totalPackSize,
                    capturedAt: row.capturedAt.toISOString(),
                });
            continue;
        }
        if (failed.has(pointIndex)) {
            cells.push({ pointIndex, lat: cell.lat, lng: cell.lng, state: 'failed' });
        }
    }
    return cells.sort((a, b) => a.pointIndex - b.pointIndex);
}
/** Terminal status from the cell tally — the pinned status table, in code. */
export function resolveTerminalStatus(totalCells: number, retained: number): GeogridScanStatus {
    if (retained === 0)
        return 'failed';
    if (retained < totalCells)
        return 'completed_partial';
    return 'completed';
}
/** Guard used by the processor: the scan row must still be this account's. */
export async function loadScanForProcessing(db: Db, accountId: string, scanId: string): Promise<GeogridScanRow | null> {
    const rows = await db
        .select()
        .from(geogridScans)
        .where(and(eq(geogridScans.id, scanId), eq(geogridScans.accountId, accountId)))
        .limit(1);
    return rows[0] ?? null;
}
/** Sum helper kept next to the schema so the bigint cast lives in one place. */
export function addCostMicros(current: bigint, captured: bigint | null): bigint {
    return captured === null ? current : current + captured;
}
