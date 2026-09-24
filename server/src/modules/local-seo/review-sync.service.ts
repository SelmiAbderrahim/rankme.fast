/**
 * Review Intelligence service.
 *
 * Order of operations on the sync path is load-bearing:
 *
 *   parse (controller) → own profile → pause gate → kill switch →
 *   configured targets → create run row → enqueue
 */
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { buildObservationMeta } from '../../shared/observations/observations.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import { enqueueReviewSyncJob } from '../../shared/queue/index.js';
import { toCsv, type CsvColumn } from '../../shared/utils/csv.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/locales.js';
import { Site } from '../sites/sites.model.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { LocalSeoReviewRow, LocalSeoReviewSource, LocalSeoReviewSyncRun, REVIEW_SOURCES, type LocalSeoReviewRowHydrated, type LocalSeoReviewSourceHydrated, type LocalSeoReviewSyncRunHydrated, type ReviewSourceName, type ReviewSourceOutcome, } from './review-sync.model.js';
import { computeReviewStats, type ReviewStats, type ReviewStatsRow } from './reviews.stats.js';
import type { CreateReviewSourceInput, ReviewInventoryExportQuery, ReviewInventoryQuery, ReviewRunListQuery, ReviewSyncInput, } from './review-sync.schema.js';
export const REVIEW_NOT_FOUND_KEY = 'reviewIntelligence.errors.notFound';
export const REVIEW_UNAVAILABLE_KEY = 'reviewIntelligence.errors.productUnavailable';
export const REVIEW_SOURCE_NOT_CONFIGURED_KEY = 'reviewIntelligence.errors.sourceNotConfigured';
export const REVIEW_INVENTORY_PAGE_SIZE = 50;
export interface ReviewSyncServiceDeps {
    queue: Queue | null;
    now?: () => Date;
}
/** Kill switch. Stored-result reads never call this — only mutation paths do. */
export function assertReviewIntelligenceEnabled(): void {
    if (!env.REVIEW_INTELLIGENCE_ENABLED) {
        throw new HttpError(503, { code: 'REVIEW_UNAVAILABLE', messageKey: REVIEW_UNAVAILABLE_KEY });
    }
}
/**
 * A RankMeFast local business profile IS the owned `Site`. Cross-account and
 * malformed ids both resolve to 404 — never 403, never 400 (that would leak
 * whether the row exists).
 */
export async function loadOwnedProfile(accountId: string, profileId: string): Promise<string> {
    if (!Types.ObjectId.isValid(profileId))
        throw HttpError.notFound({ code: 'REVIEW_NOT_FOUND', messageKey: REVIEW_NOT_FOUND_KEY });
    const site = await Site.findOne({
        _id: profileId,
        accountId,
        deletionStartedAt: null,
    }).select({ _id: 1 });
    if (!site)
        throw HttpError.notFound({ code: 'REVIEW_NOT_FOUND', messageKey: REVIEW_NOT_FOUND_KEY });
    return String(site._id);
}
// ---------------------------------------------------------------------------
// Source setup CRUD
// ---------------------------------------------------------------------------
export function serializeReviewSource(doc: LocalSeoReviewSourceHydrated) {
    return {
        id: String(doc._id),
        profileId: String(doc.profileId),
        source: doc.source as ReviewSourceName,
        target: doc.target,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}
export async function createReviewSource(accountId: string, input: CreateReviewSourceInput) {
    const profileId = await loadOwnedProfile(accountId, input.profileId);
    assertReviewIntelligenceEnabled();
    const doc = await LocalSeoReviewSource.findOneAndUpdate({ profileId, source: input.source }, { $set: { accountId, profileId, source: input.source, target: input.target } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    return serializeReviewSource(doc);
}
export async function deleteReviewSource(accountId: string, id: string) {
    const owned = await LocalSeoReviewSource.findOne({ _id: id, accountId }).select({ _id: 1 });
    if (!owned)
        throw HttpError.notFound({ code: 'REVIEW_NOT_FOUND', messageKey: REVIEW_NOT_FOUND_KEY });
    assertReviewIntelligenceEnabled();
    const deleted = await LocalSeoReviewSource.findOneAndDelete({ _id: id, accountId });
    if (!deleted)
        throw HttpError.notFound({ code: 'REVIEW_NOT_FOUND', messageKey: REVIEW_NOT_FOUND_KEY });
    return { id: String(deleted._id), deleted: true as const };
}
export async function resolveOwnedReviewSourceSiteId(accountId: string, sourceId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(sourceId))
        return null;
    const source = await LocalSeoReviewSource.findOne({ _id: sourceId, accountId }, { profileId: 1 }).lean();
    return source ? String(source.profileId) : null;
}
export async function resolveOwnedReviewRunSiteId(accountId: string, runId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(runId))
        return null;
    const run = await LocalSeoReviewSyncRun.findOne({ _id: runId, accountId }, { profileId: 1 }).lean();
    return run ? String(run.profileId) : null;
}
export async function listReviewSources(accountId: string, profileId: string) {
    const owned = await loadOwnedProfile(accountId, profileId);
    const docs = await LocalSeoReviewSource.find({ accountId, profileId: owned }).sort({
        source: 1,
    });
    return { sources: docs.map(serializeReviewSource) };
}
/** Configured target per requested source; throws 400 on the first gap. */
export async function resolveConfiguredTargets(accountId: string, profileId: string, sources: readonly ReviewSourceName[]): Promise<Record<string, string>> {
    const docs = await LocalSeoReviewSource.find({
        accountId,
        profileId,
        source: { $in: [...sources] },
    });
    const bySource = new Map(docs.map((doc) => [doc.source as string, doc.target]));
    const targets: Record<string, string> = {};
    for (const source of sources) {
        const target = bySource.get(source);
        if (!target) {
            throw HttpError.badRequest({ code: 'REVIEW_SOURCE_NOT_CONFIGURED', messageKey: REVIEW_SOURCE_NOT_CONFIGURED_KEY }, { source });
        }
        targets[source] = target;
    }
    return targets;
}
// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------
export function serializeReviewRun(run: LocalSeoReviewSyncRunHydrated) {
    return {
        id: String(run._id),
        profileId: String(run.profileId),
        sources: run.sources as ReviewSourceName[],
        depth: run.depth,
        outputLocale: resolveReviewOutputLocale(run),
        status: run.status,
        perSourceOutcomes: run.perSourceOutcomes.map((outcome) => ({
            source: outcome.source as ReviewSourceName,
            outcome: outcome.outcome as ReviewSourceOutcome,
            retained: outcome.retained,
            errorCode: outcome.errorCode ?? null,
        })),
        retainedCount: run.retainedCount,
        aiTerminalState: run.aiTerminalState,
        aiCostMicros: run.aiCostMicros ?? null,
        aiPassStartedAt: run.aiPassStartedAt?.toISOString() ?? null,
        aiCompletedAt: run.aiCompletedAt?.toISOString() ?? null,
        aiInputCount: run.aiInputCount ?? null,
        // Theme COUNT only — the theme bodies ride the dedicated themes read,
        // which re-checks every citation against the live inventory.
        aiThemeCount: run.aiThemes.length,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
    };
}
/**
 * Legacy compatibility is presentation-only. The pre-change theme pass was
 * hardcoded to English; an active locale-less job is never inferred here.
 */
export function resolveReviewOutputLocale(run: Pick<LocalSeoReviewSyncRunHydrated, 'outputLocale' | 'status' | 'aiTerminalState'> & {
    aiThemes?: readonly unknown[];
    aiThemeCount?: number | null;
}): SupportedLocale | null {
    if (isSupportedLocale(run.outputLocale))
        return run.outputLocale;
    const persistedThemeCount = Array.isArray(run.aiThemes)
        ? run.aiThemes.length
        : (run.aiThemeCount ?? 0);
    if ((run.status === 'succeeded' || run.status === 'partial') &&
        run.aiTerminalState === 'themes-ok' &&
        persistedThemeCount > 0) {
        return 'en';
    }
    return null;
}
export async function enqueueReviewSync(accountId: string, input: ReviewSyncInput & {
    outputLocale: SupportedLocale;
}, deps: ReviewSyncServiceDeps) {
    const profileId = await loadOwnedProfile(accountId, input.profileId);
    // `loadOwnedProfile` serves the stored-result reads too, so the pause gate
    // lives here on the spend path only. The profile IS the Site doc; the shared
    // guard re-loads it and 409s when paused (404 only on a delete race).
    await loadOwnedSite(accountId, profileId);
    assertReviewIntelligenceEnabled();
    if (!deps.queue)
        throw new HttpError(503, { code: 'REVIEW_UNAVAILABLE', messageKey: REVIEW_UNAVAILABLE_KEY });
    // A sync that cannot identify a business must never create a run.
    await resolveConfiguredTargets(accountId, profileId, input.sources);
    const now = (deps.now ?? (() => new Date()))();
    const run = await LocalSeoReviewSyncRun.create({
        accountId,
        profileId,
        sources: input.sources,
        depth: input.depth,
        outputLocale: input.outputLocale,
        status: 'queued',
        perSourceOutcomes: [],
        retainedCount: 0,
        aiTerminalState: 'pending',
        aiCostMicros: null,
        completedAt: null,
    });
    try {
        await enqueueReviewSyncJob(deps.queue, {
            accountId,
            siteId: input.profileId,
            runId: String(run._id),
            outputLocale: input.outputLocale,
        });
    }
    catch (error) {
        await LocalSeoReviewSyncRun.updateOne({ _id: run._id, accountId }, { $set: { status: 'failed', completedAt: now } });
        throw new HttpError(503, { code: 'REVIEW_UNAVAILABLE', messageKey: REVIEW_UNAVAILABLE_KEY }, undefined, { cause: error });
    }
    return {
        runId: String(run._id),
        status: 'queued' as const,
        profileId,
        sources: input.sources,
        depth: input.depth,
        outputLocale: input.outputLocale,
    };
}
export interface ReviewSourceSettlement {
    source: ReviewSourceName;
    outcome: ReviewSourceOutcome;
    retained: number;
    errorCode: string | null;
}
export interface SettleReviewSyncInput {
    accountId: string;
    runId: string;
    outcomes: ReviewSourceSettlement[];
    completedAt: Date;
}
/**
 * Terminal write for one run. Status is derived, never passed in:
 *
 *   no failed source            → `succeeded`
 *   every source failed         → `failed`
 *   otherwise                   → `partial`
 *
 * The `status: { $in: ['queued','running'] }` predicate keeps a replayed
 * settle from rewriting a terminal run.
 */
export async function settleReviewSyncRun(input: SettleReviewSyncInput): Promise<{
    status: 'succeeded' | 'partial' | 'failed';
}> {
    const failed = input.outcomes.filter((outcome) => outcome.outcome === 'failed');
    const retainedCount = input.outcomes.reduce((sum, outcome) => sum + outcome.retained, 0);
    const status = failed.length === 0 ? 'succeeded' : failed.length === input.outcomes.length ? 'failed' : 'partial';
    await LocalSeoReviewSyncRun.updateOne({
        _id: input.runId,
        accountId: input.accountId,
        status: { $in: ['queued', 'running'] },
    }, {
        $set: {
            status,
            perSourceOutcomes: input.outcomes,
            retainedCount,
            completedAt: input.completedAt,
        },
    });
    return { status };
}
// ---------------------------------------------------------------------------
// Reads (stored results — never gated by the kill switch)
// ---------------------------------------------------------------------------
const runCursorSchema = z
    .object({ createdAt: z.string().datetime({ offset: true }), id: z.string().regex(/^[0-9a-f]{24}$/i) })
    .strict();
export function encodeReviewRunCursor(cursor: z.infer<typeof runCursorSchema>): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
export function decodeReviewRunCursor(cursor: string): z.infer<typeof runCursorSchema> {
    try {
        const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        const result = runCursorSchema.safeParse(parsed);
        if (!result.success)
            throw new Error('invalid cursor');
        return result.data;
    }
    catch {
        throw HttpError.badRequest({ code: 'REVIEW_INTELLIGENCE_ERRORS_INVALID_CURSOR', messageKey: 'reviewIntelligence.errors.invalidCursor' });
    }
}
export async function listReviewRuns(accountId: string, query: ReviewRunListQuery) {
    const profileId = await loadOwnedProfile(accountId, query.profileId);
    const filter: Record<string, unknown> = { accountId, profileId };
    if (query.cursor) {
        const cursor = decodeReviewRunCursor(query.cursor);
        const createdAt = new Date(cursor.createdAt);
        filter.$or = [
            { createdAt: { $lt: createdAt } },
            { createdAt, _id: { $lt: new Types.ObjectId(cursor.id) } },
        ];
    }
    const docs = await LocalSeoReviewSyncRun.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(query.limit + 1);
    const hasMore = docs.length > query.limit;
    const page = hasMore ? docs.slice(0, query.limit) : docs;
    const last = page.at(-1);
    return {
        runs: page.map(serializeReviewRun),
        nextCursor: hasMore && last
            ? encodeReviewRunCursor({ createdAt: last.createdAt.toISOString(), id: String(last._id) })
            : null,
    };
}
export async function getReviewRun(accountId: string, runId: string) {
    const run = await LocalSeoReviewSyncRun.findOne({ _id: runId, accountId });
    if (!run)
        throw HttpError.notFound({ code: 'REVIEW_NOT_FOUND', messageKey: REVIEW_NOT_FOUND_KEY });
    await loadOwnedProfile(accountId, String(run.profileId));
    return serializeReviewRun(run);
}
export function serializeReviewRowDoc(row: LocalSeoReviewRowHydrated) {
    return {
        id: String(row._id),
        source: row.source as ReviewSourceName,
        sourceReviewId: row.sourceReviewId,
        rating: row.rating ?? null,
        title: row.title ?? null,
        text: row.text,
        authorDisplayName: row.authorDisplayName ?? null,
        language: row.language ?? null,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        fetchedAt: row.fetchedAt.toISOString(),
    };
}
/** Escapes every regex metacharacter — `q` is untrusted user input. */
export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
type ReviewInventoryFilters = Pick<ReviewInventoryQuery, 'profileId' | 'src' | 'rating' | 'q'>;
/**
 * One filter builder serves the paginated screen and the unpaginated export,
 * preventing a CSV from silently widening or narrowing the visible query.
 */
export function buildReviewInventoryFilter(accountId: string, profileId: string, query: ReviewInventoryFilters): Record<string, unknown> {
    const filter: Record<string, unknown> = { accountId, profileId };
    if (query.src)
        filter.source = query.src;
    if (query.rating !== undefined)
        filter.rating = query.rating;
    if (query.q) {
        const pattern = new RegExp(escapeRegExp(query.q), 'i');
        filter.$or = [{ text: pattern }, { title: pattern }];
    }
    return filter;
}
export function reviewInventorySort(sort: ReviewInventoryQuery['sort']): Record<string, 1 | -1> {
    if (sort === 'rating-high') {
        return { rating: -1, reviewedAt: -1, _id: -1 };
    }
    if (sort === 'source') {
        return { source: 1, reviewedAt: -1, _id: -1 };
    }
    return { reviewedAt: -1, _id: -1 };
}
function reviewObservation(latest: {
    fetchedAt: Date;
} | null, sampleCount: number): ObservationMeta | null {
    if (!latest || sampleCount < 1)
        return null;
    return buildObservationMeta({
        sourceKind: 'provider_observation',
        sourceLabel: null,
        observedAt: latest.fetchedAt,
        freshUntil: null,
        sampleCount,
    });
}
export async function listReviewInventory(accountId: string, query: ReviewInventoryQuery) {
    const profileId = await loadOwnedProfile(accountId, query.profileId);
    const filter = buildReviewInventoryFilter(accountId, profileId, query);
    const skip = (query.page - 1) * REVIEW_INVENTORY_PAGE_SIZE;
    const [docs, total, latest] = await Promise.all([
        LocalSeoReviewRow.find(filter)
            .sort(reviewInventorySort(query.sort))
            .skip(skip)
            .limit(REVIEW_INVENTORY_PAGE_SIZE),
        LocalSeoReviewRow.countDocuments(filter),
        LocalSeoReviewRow.findOne(filter)
            .sort({ fetchedAt: -1, _id: -1 })
            .select({ fetchedAt: 1 }),
    ]);
    return {
        reviews: docs.map(serializeReviewRowDoc),
        page: query.page,
        pageSize: REVIEW_INVENTORY_PAGE_SIZE,
        total,
        hasMore: skip + docs.length < total,
        observation: reviewObservation(latest, total),
    };
}
const REVIEW_INVENTORY_CSV_COLUMNS: CsvColumn[] = [
    { key: 'rating', header: 'rating' },
    { key: 'reviewed_at', header: 'reviewed_at' },
    { key: 'source', header: 'source' },
    { key: 'title', header: 'title' },
    { key: 'text', header: 'text' },
    { key: 'author', header: 'author' },
];
function serializeReviewCsvRow(row: LocalSeoReviewRowHydrated) {
    return {
        rating: row.rating ?? null,
        reviewed_at: row.reviewedAt ?? null,
        source: row.source,
        title: row.title ?? null,
        text: row.text,
        author: row.authorDisplayName ?? null,
    };
}
/**
 * Opens a free, unpaginated stored-data export after ownership has been
 * established. Rows stream from Mongo so inventory size does not become an
 * API-memory multiplier. `toCsv` applies formula neutralization to every
 * third-party field and emits UTF-8 BOM + RFC-4180 CRLF records.
 */
export async function openReviewInventoryCsv(accountId: string, query: ReviewInventoryExportQuery): Promise<AsyncGenerator<string>> {
    const profileId = await loadOwnedProfile(accountId, query.profileId);
    const filter = buildReviewInventoryFilter(accountId, profileId, query);
    const sort = reviewInventorySort(query.sort);
    return (async function* streamCsv(): AsyncGenerator<string> {
        const header = toCsv([], REVIEW_INVENTORY_CSV_COLUMNS);
        yield header;
        const cursor = LocalSeoReviewRow.find(filter).sort(sort).cursor();
        for await (const row of cursor) {
            const withHeader = toCsv([serializeReviewCsvRow(row)], REVIEW_INVENTORY_CSV_COLUMNS);
            yield withHeader.slice(header.length);
        }
    })();
}
export interface ReviewStatsView extends ReviewStats {
    runId: string;
    profileId: string;
    /** Rows currently persisted for the profile — the histogram's denominator. */
    totalReviews: number;
    observation: ObservationMeta | null;
}
/**
 * Read boundary for `GET /api/local-seo/reviews/stats/:runId`.
 *
 * The run identifies the PROFILE, not the batch: the stats always describe the
 * inventory as it stands right now, so a rerun that appended nothing does not
 * report an empty chart, and a deleted row disappears from the histogram.
 * Cross-account and unknown run ids both 404. Nothing here is gated by the
 * kill switch — stored results stay readable — and nothing here is gated by
 * the AI terminal state; these numbers are independent of the theme pass.
 */
export async function getReviewStats(accountId: string, runId: string, now: Date = new Date()): Promise<ReviewStatsView> {
    const run = await LocalSeoReviewSyncRun.findOne({ _id: runId, accountId });
    if (!run)
        throw HttpError.notFound({ code: 'REVIEW_NOT_FOUND', messageKey: REVIEW_NOT_FOUND_KEY });
    await loadOwnedProfile(accountId, String(run.profileId));
    const docs = await LocalSeoReviewRow.find({
        accountId,
        profileId: run.profileId,
    }).select({ source: 1, rating: 1, reviewedAt: 1, fetchedAt: 1 });
    const rows: ReviewStatsRow[] = docs.map((doc) => ({
        source: doc.source as ReviewSourceName,
        rating: doc.rating ?? null,
        reviewedAt: doc.reviewedAt ?? null,
    }));
    const latest = docs.reduce<{
        fetchedAt: Date;
    } | null>((current, doc) => {
        if (!current || doc.fetchedAt.getTime() > current.fetchedAt.getTime()) {
            return { fetchedAt: doc.fetchedAt };
        }
        return current;
    }, null);
    return {
        runId: String(run._id),
        profileId: String(run.profileId),
        totalReviews: rows.length,
        ...computeReviewStats(rows, now),
        observation: reviewObservation(latest, rows.length),
    };
}
export { REVIEW_SOURCES };
