import { Types } from 'mongoose';
import { env } from '../../../config/env.js';
import { createPaginationCursorCodec, type PaginationCursorCodec, } from '../../../shared/security/index.js';
import { HttpError } from '../../../shared/utils/http-error.js';
import type { SupportedLocale } from '../../../shared/i18n/index.js';
import { CompetitorLandscapeReportPage, CompetitorLandscapeLegCheckpoint, CompetitorLandscapeRun, type CompetitorLandscapeRunDocument, } from './landscape.model.js';
import { landscapeReportManifestSchema, landscapeReportRowSchema, landscapeStateSchema, type LandscapeReportRow, type LandscapeState, } from './landscape.schemas.js';
import { overlayLandscapeOpportunityAcceptances } from './landscape.acceptance.js';
import { overlayLandscapePageMatchReviews } from './landscape.review.js';
import { localizeLandscapeManifest } from './landscape.copy.js';
export interface PublicLandscapeSummary {
    id: string;
    siteId: string;
    state: LandscapeState;
    ownedDomain: string;
    locale: string;
    market: {
        locationCode: number;
        languageCode: string;
        source: string;
    };
    competitors: Array<{
        profileId: string;
        domain: string;
    }>;
    progress: {
        completedLegs: number;
        totalLegs: number;
        stage: LandscapeState;
    };
    reportVersion: number;
    schemaVersion: string;
    taxonomyVersion: string;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
}
function iso(value: Date | null | undefined): string | null {
    return value ? new Date(value).toISOString() : null;
}
/** Explicit allowlist: no account/user ids, idempotency keys, costs, or errors. */
export function toPublicLandscapeSummary(doc: CompetitorLandscapeRunDocument & {
    _id: unknown;
}): PublicLandscapeSummary {
    const state = landscapeStateSchema.parse(doc.state);
    return {
        id: String(doc._id),
        siteId: String(doc.siteId),
        state,
        ownedDomain: doc.ownedDomain,
        locale: doc.locale,
        market: {
            locationCode: doc.market.locationCode,
            languageCode: doc.market.languageCode,
            source: doc.market.source,
        },
        competitors: doc.competitors.map((competitor) => ({
            profileId: competitor.profileId,
            domain: competitor.domain,
        })),
        progress: {
            completedLegs: doc.progress.completedLegs,
            totalLegs: doc.progress.totalLegs,
            stage: landscapeStateSchema.parse(doc.progress.stage),
        },
        reportVersion: doc.reportVersion,
        schemaVersion: doc.schemaVersion,
        taxonomyVersion: doc.taxonomyVersion,
        createdAt: iso((doc as {
            createdAt?: Date;
        }).createdAt)!,
        startedAt: iso(doc.startedAt),
        completedAt: iso(doc.completedAt),
    };
}
interface LandscapeCursor {
    createdAt: string;
    id: string;
}
function validLandscapeCursor(value: unknown): value is LandscapeCursor {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value as Partial<LandscapeCursor>;
    return typeof candidate.createdAt === 'string' &&
        !Number.isNaN(new Date(candidate.createdAt).getTime()) &&
        typeof candidate.id === 'string' &&
        Types.ObjectId.isValid(candidate.id);
}
let cursorCodec: PaginationCursorCodec | null = null;
function codec(): PaginationCursorCodec {
    cursorCodec ??= createPaginationCursorCodec(env.BETTER_AUTH_SECRET);
    return cursorCodec;
}
function encodeCursorValue(value: unknown): string {
    return codec().encode(JSON.stringify(value));
}
function parseCursor(cursor: string): LandscapeCursor {
    try {
        const parsed: unknown = JSON.parse(codec().decode(cursor));
        if (!validLandscapeCursor(parsed))
            throw new Error('invalid');
        return parsed;
    }
    catch {
        throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_CURSOR_INVALID', messageKey: 'competitors.landscape.errors.cursorInvalid' });
    }
}
export async function listLandscapeRuns(input: {
    accountId: string;
    siteId: string;
    state?: LandscapeState;
    limit?: number;
    cursor?: string;
}): Promise<{
    items: PublicLandscapeSummary[];
    nextCursor: string | null;
}> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const query: Record<string, unknown> = {
        accountId: input.accountId,
        siteId: input.siteId,
    };
    if (input.state)
        query.state = landscapeStateSchema.parse(input.state);
    if (input.cursor) {
        const cursor = parseCursor(input.cursor);
        query.$or = [
            { createdAt: { $lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), _id: { $lt: cursor.id } },
        ];
    }
    const docs = await CompetitorLandscapeRun.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1);
    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const last = page.at(-1);
    return {
        items: page.map((doc) => toPublicLandscapeSummary(doc.toObject() as never)),
        nextCursor: hasMore && last
            ? codec().encode(JSON.stringify({
                createdAt: (last as unknown as {
                    createdAt: Date;
                }).createdAt.toISOString(),
                id: String(last._id),
            } satisfies LandscapeCursor))
            : null,
    };
}
export async function getLandscapeRun(input: {
    accountId: string;
    siteId: string;
    runId: string;
    locale?: SupportedLocale;
    db?: ApplicationDb;
    pageLimit?: number;
    pageCursor?: number;
}) {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    }
    const doc = await CompetitorLandscapeRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    const pageLimit = Math.min(Math.max(input.pageLimit ?? 10, 1), 30);
    const startPage = Math.min(Math.max(input.pageCursor ?? 0, 0), 29);
    const allPageDocs = await CompetitorLandscapeReportPage.find({
        accountId: input.accountId,
        siteId: input.siteId,
        runId: input.runId,
    })
        .sort({ pageIndex: 1 })
        .limit(30)
        .lean();
    const eligiblePages = allPageDocs.filter((item) => Number(item.pageIndex) >= startPage);
    const hasMore = eligiblePages.length > pageLimit;
    const page = hasMore ? eligiblePages.slice(0, pageLimit) : eligiblePages;
    const allRows = allPageDocs.flatMap((reportPage) => reportPage.rows.map((row) => landscapeReportRowSchema.parse(row)));
    const snapshotManifest = doc.reportManifest
        ? landscapeReportManifestSchema.parse(doc.reportManifest)
        : null;
    const reviewedManifest = snapshotManifest && input.db
        ? await overlayLandscapePageMatchReviews(input.db, {
            accountId: input.accountId,
            siteId: input.siteId,
            reportId: input.runId,
            manifest: snapshotManifest,
        })
        : snapshotManifest;
    const semanticManifest = reviewedManifest && input.db
        ? await overlayLandscapeOpportunityAcceptances(input.db, {
            accountId: input.accountId,
            siteId: input.siteId,
            reportId: input.runId,
            manifest: reviewedManifest,
        })
        : reviewedManifest;
    const manifest = semanticManifest
        ? localizeLandscapeManifest(semanticManifest, input.locale ?? doc.locale, allRows)
        : null;
    return {
        run: toPublicLandscapeSummary(doc.toObject() as never),
        manifest,
        rows: page.flatMap((reportPage) => reportPage.rows.map((row) => landscapeReportRowSchema.parse(row))),
        nextCursor: hasMore && page.length > 0 ? Number(page.at(-1)!.pageIndex) + 1 : null,
    };
}
interface LandscapeRowCursor {
    offset: number;
    class: string | null;
    competitor: string | null;
    q: string | null;
}
interface LandscapeRowFilters {
    class: string | null;
    competitor: string | null;
    q: string | null;
}
function validLandscapeRowCursor(value: unknown): value is LandscapeRowCursor {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value as Partial<LandscapeRowCursor>;
    return Number.isInteger(candidate.offset) &&
        Number(candidate.offset) >= 0 &&
        (candidate.class === null || typeof candidate.class === 'string') &&
        (candidate.competitor === null || typeof candidate.competitor === 'string') &&
        (candidate.q === null || typeof candidate.q === 'string');
}
function detailFilters(input: {
    class?: string;
    competitor?: string;
    q?: string;
}): LandscapeRowFilters {
    return {
        class: input.class ?? null,
        competitor: input.competitor?.toLowerCase() ?? null,
        q: input.q?.trim().toLowerCase() ?? null,
    };
}
function sameDetailFilters(cursor: LandscapeRowCursor, filters: LandscapeRowFilters): boolean {
    return cursor.class === filters.class &&
        cursor.competitor === filters.competitor &&
        cursor.q === filters.q;
}
function landscapeRowMatches(row: LandscapeReportRow, filters: LandscapeRowFilters): boolean {
    if (filters.class && row.class !== filters.class)
        return false;
    if (filters.competitor &&
        row.competitorProfileId.toLowerCase() !== filters.competitor &&
        row.competitorDomain.toLowerCase() !== filters.competitor)
        return false;
    if (filters.q &&
        !row.keyword.toLowerCase().includes(filters.q) &&
        !row.normalizedKeyword.toLowerCase().includes(filters.q))
        return false;
    return true;
}
function detailCursor(input: string): LandscapeRowCursor {
    try {
        const value: unknown = JSON.parse(codec().decode(input));
        if (!validLandscapeRowCursor(value))
            throw new Error('invalid');
        return value;
    }
    catch {
        throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_CURSOR_INVALID', messageKey: 'competitors.landscape.errors.cursorInvalid' });
    }
}
/** URL-filtered, bounded view over the immutable canonical row order. */
export async function getFilteredLandscapeRun(input: {
    accountId: string;
    siteId: string;
    runId: string;
    db: ApplicationDb;
    locale?: SupportedLocale;
    class?: string;
    competitor?: string;
    q?: string;
    limit: number;
    cursor?: string;
}) {
    const filters = detailFilters(input);
    let offset = 0;
    if (input.cursor) {
        const decoded = detailCursor(input.cursor);
        if (!sameDetailFilters(decoded, filters)) {
            throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_CURSOR_INVALID', messageKey: 'competitors.landscape.errors.cursorInvalid' });
        }
        offset = decoded.offset;
    }
    const detail = await getLandscapeRun({
        accountId: input.accountId,
        siteId: input.siteId,
        runId: input.runId,
        db: input.db,
        ...(input.locale ? { locale: input.locale } : {}),
        pageLimit: 30,
        pageCursor: 0,
    });
    const filtered = detail.rows.filter((row) => landscapeRowMatches(row, filters));
    const items = filtered.slice(offset, offset + input.limit);
    const nextOffset = offset + items.length;
    return {
        run: detail.run,
        manifest: detail.manifest,
        items,
        nextCursor: nextOffset < filtered.length
            ? codec().encode(JSON.stringify({ offset: nextOffset, ...filters } satisfies LandscapeRowCursor))
            : null,
    };
}
/** Data-rights seam: bounded customer-facing snapshots only. */
export async function exportLandscapeRuns(accountId: string) {
    const runs = await CompetitorLandscapeRun.find({ accountId }, {
        siteId: 1,
        state: 1,
        ownedDomain: 1,
        locale: 1,
        market: 1,
        competitors: 1,
        progress: 1,
        reportVersion: 1,
        schemaVersion: 1,
        taxonomyVersion: 1,
        reportManifest: 1,
        startedAt: 1,
        completedAt: 1,
        createdAt: 1,
    })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
    const exported = [];
    for (const run of runs) {
        const pages = await CompetitorLandscapeReportPage.find({ accountId, runId: run._id }, { pageIndex: 1, rows: 1 })
            .sort({ pageIndex: 1 })
            .lean();
        exported.push({
            ...toPublicLandscapeSummary(run as never),
            manifest: run.reportManifest
                ? landscapeReportManifestSchema.parse(run.reportManifest)
                : null,
            rows: pages.flatMap((page) => page.rows.map((row) => landscapeReportRowSchema.parse(row))),
        });
    }
    return exported;
}
/** Explicit lifecycle seam used by targeted maintenance and tests. */
export async function purgeLandscapeRuns(input: {
    accountId: string;
    siteId?: string;
}): Promise<number> {
    const match: Record<string, unknown> = { accountId: input.accountId };
    if (input.siteId)
        match.siteId = input.siteId;
    const runIds = await CompetitorLandscapeRun.find(match, { _id: 1 }).lean();
    const ids = runIds.map((run) => run._id);
    if (ids.length > 0) {
        await CompetitorLandscapeLegCheckpoint.deleteMany({ runId: { $in: ids } });
        await CompetitorLandscapeReportPage.deleteMany({ runId: { $in: ids } });
    }
    const deleted = await CompetitorLandscapeRun.deleteMany(match);
    return deleted.deletedCount;
}
export const landscapeRepositoryTestables = Object.freeze({
    detailFilters,
    encodeCursorValue,
    landscapeRowMatches,
    sameDetailFilters,
    validLandscapeCursor,
    validLandscapeRowCursor,
});
