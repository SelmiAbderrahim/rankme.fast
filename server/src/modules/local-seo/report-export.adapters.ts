import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { stableReportJson } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { assertSiteResourceTarget, assertSiteTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { readLatestSnapshot } from './local-seo.service.js';
import { LocalSeoReviewRow, REVIEW_SOURCES } from './review-sync.model.js';
import { escapeRegExp, getReviewRun, getReviewStats, loadOwnedProfile, resolveReviewOutputLocale, serializeReviewRowDoc, } from './review-sync.service.js';
import { getReviewThemes } from './review-themes.service.js';
const snapshotSelectionSchema = z.object({
    sections: z.array(z.enum(['listings', 'reviews', 'qa', 'localPack'])).max(4).optional(),
    keyword: z.array(z.string().trim().min(1).max(400)).max(100).optional(),
}).strict();
type SnapshotSelection = z.infer<typeof snapshotSelectionSchema>;
type LocalSeoExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
async function snapshotBase(db: Db, context: LocalSeoExportContext) {
    assertSiteTarget(context.target);
    return readLatestSnapshot({ accountId: context.accountId, siteId: context.target.siteId }, { db });
}
function snapshotAdapter(db: Db) {
    return createStoredReportAdapter<SnapshotSelection>({
        kind: 'local.seo_snapshot', localizationStem: 'localSeoSnapshot', formats: ['pdf', 'csv', 'json'], selectionSchema: snapshotSelectionSchema,
        access: (context) => snapshotBase(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const snapshot = await snapshotBase(db, context);
            assertSiteTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const sections = new Set(context.selection.sections ?? ['listings', 'reviews', 'qa', 'localPack']);
            const records = [];
            if (sections.has('listings'))
                snapshot.listings.forEach((listing, index) => records.push(storedRecord('listing', `${listing.source}:${index}`, stableReportJson(listing), 'observation', { label: listing.source, value: listing.consistent, observedAt: snapshot.fetchedAt })));
            if ((sections.has('reviews') || sections.has('qa')) && snapshot.reviews)
                records.push(storedRecord('review-summary', 'latest', stableReportJson({
                    ...(sections.has('reviews') ? { averageRating: snapshot.reviews.averageRating, reviewCount: snapshot.reviews.reviewCount } : {}),
                    ...(sections.has('qa') ? { unansweredQuestionCount: snapshot.reviews.unansweredQuestionCount } : {}),
                }), 'observation', { value: snapshot.reviews.averageRating, observedAt: snapshot.reviewsFetchedAt }));
            if (sections.has('localPack'))
                snapshot.localPack.filter((row) => !context.selection.keyword || context.selection.keyword.includes(row.phrase)).forEach((row) => records.push(storedRecord('local-pack', row.keywordId, stableReportJson({
                    phrase: row.phrase, position: row.position, totalPackSize: row.totalPackSize,
                    rankState: row.position === null ? 'not-ranked-in-observed-pack' : 'ranked',
                }), 'observation', { label: row.phrase, value: row.position, state: row.position === null ? 'not-ranked' : 'ranked', observedAt: row.checkedAt })));
            const observedAt = [...snapshot.localPack.map((row) => row.checkedAt), snapshot.fetchedAt, snapshot.reviewsFetchedAt].filter((value): value is string => value !== null).sort().at(-1) ?? new Date(0).toISOString();
            return { siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: snapshot, records };
        },
    });
}
const reviewSelectionSchema = z.object({
    runId: z.string().regex(/^[0-9a-f]{24}$/iu).optional(),
    source: z.array(z.enum(REVIEW_SOURCES)).max(REVIEW_SOURCES.length).optional(),
    rating: z.array(z.number().int().min(1).max(5)).max(5).optional(),
    query: z.string().trim().max(120).optional(),
    from: z.string().date().optional(), to: z.string().date().optional(),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, { message: 'reportExports.errors.invalidWindow' });
type ReviewSelection = z.infer<typeof reviewSelectionSchema>;
async function reviewRows(context: LocalSeoExportContext, selection?: ReviewSelection) {
    assertSiteResourceTarget(context.target);
    const profileId = await loadOwnedProfile(context.accountId, context.target.resourceId);
    if (profileId !== context.target.siteId)
        throw HttpError.notFound({ code: 'REVIEW_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'reviewIntelligence.errors.notFound' });
    const filter: Record<string, unknown> = { accountId: context.accountId, profileId };
    if (selection?.source)
        filter.source = { $in: selection.source };
    if (selection?.rating)
        filter.rating = { $in: selection.rating };
    if (selection?.query) {
        const expression = new RegExp(escapeRegExp(selection.query), 'i');
        filter.$or = [{ text: expression }, { title: expression }];
    }
    if (selection?.from || selection?.to)
        filter.reviewedAt = {
            ...(selection.from ? { $gte: new Date(`${selection.from}T00:00:00.000Z`) } : {}),
            ...(selection.to ? { $lte: new Date(`${selection.to}T23:59:59.999Z`) } : {}),
        };
    const docs = await LocalSeoReviewRow.find(filter).sort({ reviewedAt: -1, _id: -1 }).limit(100001);
    return { profileId, rows: docs.map(serializeReviewRowDoc) };
}
function reviewAdapter() {
    return createStoredReportAdapter<ReviewSelection>({
        kind: 'local.reviews', localizationStem: 'localReviews', formats: ['pdf', 'csv', 'json'], selectionSchema: reviewSelectionSchema,
        access: (context) => reviewRows(context),
        async load(context): Promise<LoadedStoredReport> {
            const loaded = await reviewRows(context, context.selection);
            const all = await reviewRows(context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            let run = null;
            let stats = null;
            let themes = null;
            if (context.selection.runId) {
                run = await getReviewRun(context.accountId, context.selection.runId);
                if (run.profileId !== loaded.profileId)
                    throw HttpError.notFound({ code: 'REVIEW_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'reviewIntelligence.errors.notFound' });
                [stats, themes] = await Promise.all([
                    getReviewStats(context.accountId, context.selection.runId),
                    getReviewThemes(context.accountId, context.selection.runId),
                ]);
            }
            const observedAt = loaded.rows.map((row) => row.fetchedAt).sort().at(-1) ?? run?.completedAt ?? new Date(0).toISOString();
            const records = loaded.rows.map((row) => storedRecord('review', row.id, stableReportJson({
                source: row.source, sourceReviewId: row.sourceReviewId, rating: row.rating,
                title: row.title, text: row.text, authorDisplayName: row.authorDisplayName,
                language: row.language, reviewedAt: row.reviewedAt, fetchedAt: row.fetchedAt,
            }), 'observation', { label: row.source, value: row.rating, observedAt: row.reviewedAt ?? row.fetchedAt }));
            if (run)
                records.push(storedRecord('sync-run', run.id, stableReportJson({
                    sources: run.sources, depth: run.depth, outputLocale: resolveReviewOutputLocale(run),
                    status: run.status, perSourceOutcomes: run.perSourceOutcomes,
                    retainedCount: run.retainedCount, aiTerminalState: run.aiTerminalState,
                    aiPassStartedAt: run.aiPassStartedAt, aiCompletedAt: run.aiCompletedAt,
                    aiInputCount: run.aiInputCount, aiThemeCount: run.aiThemeCount,
                    createdAt: run.createdAt, completedAt: run.completedAt,
                }), 'derived', { state: run.status, observedAt: run.completedAt ?? run.createdAt }));
            if (stats)
                records.push(storedRecord('review-statistics', stats.runId, stableReportJson(stats), 'derived', { value: stats.totalReviews, observedAt: stats.observation?.observedAt ?? observedAt }));
            if (themes)
                records.push(storedRecord('review-themes', themes.runId, stableReportJson(themes), 'generated', { observedAt: themes.observation?.observedAt ?? observedAt }));
            return { siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: all, selectedItems: loaded.rows.length, records };
        },
    });
}
export function createLocalSeoReportExportAdapters(db: Db) {
    return [snapshotAdapter(db), reviewAdapter()];
}
