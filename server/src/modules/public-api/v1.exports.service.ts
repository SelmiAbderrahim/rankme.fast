import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { backlinkRowSnapshots, serpObservations, } from '../../db/schema/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
const exportCursorSchema = z
    .object({
    v: z.literal(1),
    at: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
})
    .strict();
export interface V1ExportCursor {
    v: 1;
    at: string;
    id: string;
}
export interface V1StoredRowsInput {
    accountId: string;
    siteId: string;
    limit: number;
    cursor?: string;
}
export interface V1SerpFeatureRow {
    id: string;
    siteId: string;
    keywordId: string;
    engine: string;
    checkedAt: string;
    source: string;
    features: unknown;
    topResults: unknown;
    createdAt: string;
    sourceKind: 'provider_observation';
}
export interface V1BacklinkRow {
    id: string;
    reviewId: string;
    siteId: string;
    url: string;
    domain: string;
    spamScore: number;
    rubricBand: string;
    rubricVersion: string;
    firstSeen: string | null;
    lastSeen: string | null;
    dofollow: boolean;
    isBroken: boolean;
    rationale: string | null;
    rationaleStatus: string;
    capturedAt: string;
    sourceKind: 'provider_observation';
}
export function encodeV1ExportCursor(at: Date, id: string): string {
    const payload: V1ExportCursor = { v: 1, at: at.toISOString(), id };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
export function decodeV1ExportCursor(value: string): V1ExportCursor {
    try {
        if (!/^[A-Za-z0-9_-]+$/u.test(value))
            throw new Error('invalid base64url');
        const raw = Buffer.from(value, 'base64url').toString('utf8');
        return exportCursorSchema.parse(JSON.parse(raw));
    }
    catch (cause) {
        throw new HttpError(400, { code: 'PUBLIC_API_ERRORS_INVALID_CURSOR', messageKey: 'publicApi.errors.invalidCursor' }, undefined, {
            cause,
        });
    }
}
function cursorDate(cursor?: string): {
    at: Date;
    id: string;
} | null {
    if (cursor === undefined)
        return null;
    const decoded = decodeV1ExportCursor(cursor);
    return { at: new Date(decoded.at), id: decoded.id };
}
export async function listV1SerpFeatures(db: Db, input: V1StoredRowsInput): Promise<{
    serpFeatures: V1SerpFeatureRow[];
    nextCursor: string | null;
}> {
    const cursor = cursorDate(input.cursor);
    const filters = [
        eq(serpObservations.accountId, input.accountId),
        eq(serpObservations.siteId, input.siteId),
    ];
    if (cursor) {
        filters.push(or(lt(serpObservations.checkedAt, cursor.at), and(eq(serpObservations.checkedAt, cursor.at), lt(serpObservations.id, cursor.id)))!);
    }
    const rows = await db
        .select()
        .from(serpObservations)
        .where(and(...filters))
        .orderBy(desc(serpObservations.checkedAt), desc(serpObservations.id))
        .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
        serpFeatures: page.map((row) => ({
            id: row.id,
            siteId: row.siteId,
            keywordId: row.keywordId,
            engine: row.engine,
            checkedAt: row.checkedAt.toISOString(),
            source: row.source,
            features: row.features,
            topResults: row.topResults,
            createdAt: row.createdAt.toISOString(),
            sourceKind: 'provider_observation',
        })),
        nextCursor: hasMore
            ? encodeV1ExportCursor(page[input.limit - 1]!.checkedAt, page[input.limit - 1]!.id)
            : null,
    };
}
export async function listV1BacklinkRows(db: Db, input: V1StoredRowsInput): Promise<{
    backlinkRows: V1BacklinkRow[];
    nextCursor: string | null;
}> {
    const cursor = cursorDate(input.cursor);
    const filters = [
        eq(backlinkRowSnapshots.accountId, input.accountId),
        eq(backlinkRowSnapshots.siteId, input.siteId),
    ];
    if (cursor) {
        filters.push(or(lt(backlinkRowSnapshots.capturedAt, cursor.at), and(eq(backlinkRowSnapshots.capturedAt, cursor.at), lt(backlinkRowSnapshots.id, cursor.id)))!);
    }
    const rows = await db
        .select()
        .from(backlinkRowSnapshots)
        .where(and(...filters))
        .orderBy(desc(backlinkRowSnapshots.capturedAt), desc(backlinkRowSnapshots.id))
        .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    return {
        backlinkRows: page.map((row) => ({
            id: row.id,
            reviewId: row.reviewId,
            siteId: row.siteId,
            url: row.url,
            domain: row.domain,
            spamScore: row.spamScore,
            rubricBand: row.rubricBand,
            rubricVersion: row.rubricVersion,
            firstSeen: row.firstSeen?.toISOString() ?? null,
            lastSeen: row.lastSeen?.toISOString() ?? null,
            dofollow: row.dofollow,
            isBroken: row.isBroken,
            rationale: row.rationale,
            rationaleStatus: row.rationaleStatus,
            capturedAt: row.capturedAt.toISOString(),
            sourceKind: 'provider_observation',
        })),
        nextCursor: hasMore
            ? encodeV1ExportCursor(page[input.limit - 1]!.capturedAt, page[input.limit - 1]!.id)
            : null,
    };
}
