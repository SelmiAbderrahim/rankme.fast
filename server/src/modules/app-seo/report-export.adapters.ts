import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { APP_STORE_KINDS } from '../../shared/providers/app-data.js';
import { stableReportJson } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { listAppProfiles } from './app-seo.service.js';
import { getAppKeywordHistory, listAppKeywords } from './keywords.service.js';
import { readLatestAppResearch } from './research.service.js';
const keywordSelectionSchema = z.object({
    keywordIds: z.array(z.string().uuid()).max(250).optional(),
    historyLimit: z.number().int().min(1).max(104).default(104),
}).strict();
type KeywordSelection = z.infer<typeof keywordSelectionSchema>;
type AppSeoExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
async function keywordBase(db: Db, context: AppSeoExportContext) {
    const target = context.target;
    assertSiteResourceTarget(target);
    const { siteId, resourceId } = target;
    const profiles = await listAppProfiles({ accountId: context.accountId, siteId });
    const profile = profiles.find((item) => item.id === resourceId);
    if (!profile)
        throw HttpError.notFound({ code: 'APP_SEO_ERRORS_NOT_FOUND', messageKey: 'appSeo.errors.notFound' });
    const listed = await listAppKeywords({ accountId: context.accountId, siteId, profileId: profile.id }, db);
    const histories = await Promise.all(listed.items.map(async (keyword) => ({
        keywordId: keyword.id,
        points: await getAppKeywordHistory({ accountId: context.accountId, siteId, keywordId: keyword.id, limit: 104 }, db),
    })));
    return { profile, items: listed.items, histories };
}
function keywordAdapter(db: Db) {
    return createStoredReportAdapter<KeywordSelection>({
        kind: 'app.keyword_tracking', localizationStem: 'appKeywordTracking', formats: ['pdf', 'csv', 'json'], selectionSchema: keywordSelectionSchema,
        access: (context) => keywordBase(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const loaded = await keywordBase(db, context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const ids = new Set(context.selection.keywordIds ?? loaded.items.map((item) => item.id));
            const historyById = Object.fromEntries(loaded.histories.map((item) => [
                item.keywordId,
                item.points.slice(-context.selection.historyLimit),
            ]));
            const records = loaded.items.filter((keyword) => ids.has(keyword.id)).flatMap((keyword) => {
                // `keywordBase` creates one history entry for every listed keyword.
                const points = historyById[keyword.id]!;
                const keywordDetails = {
                    keywordId: keyword.id, profileId: keyword.profileId, store: keyword.store,
                    phrase: keyword.phrase, locationCode: keyword.locationCode, languageCode: keyword.languageCode,
                    active: keyword.active, latestPosition: keyword.latestPosition, previousPosition: keyword.previousPosition,
                    delta: keyword.delta, lastCheckedAt: keyword.lastCheckedAt,
                    lastFailedCheckAt: keyword.lastFailedCheckAt, createdAt: keyword.createdAt,
                };
                if (points.length === 0)
                    return [storedRecord('app-keyword', keyword.id, stableReportJson(keywordDetails), 'observation', {
                            label: keyword.phrase, value: keyword.latestPosition, state: keyword.latestPosition === null ? 'not-ranked-or-unobserved' : 'ranked', observedAt: keyword.lastCheckedAt ?? keyword.createdAt,
                        })];
                return points.map((point, index) => storedRecord('app-rank-observation', `${keyword.id}:${index + 1}`, stableReportJson({ ...keywordDetails, ...point }), 'observation', {
                    label: keyword.phrase, value: point.position, state: point.position === null ? 'not-ranked' : 'ranked', observedAt: point.checkedAt,
                }));
            });
            const observedAt = records.map((record) => record.observedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? loaded.profile.updatedAt;
            return { siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: loaded, records };
        },
    });
}
const researchSelectionSchema = z.object({
    surface: z.enum(['keywords', 'gap', 'competitors']),
    store: z.enum(APP_STORE_KINDS),
}).strict();
type ResearchSelection = z.infer<typeof researchSelectionSchema>;
async function researchBase(db: Db, context: AppSeoExportContext) {
    const target = context.target;
    assertSiteResourceTarget(target);
    const { siteId, resourceId } = target;
    const profiles = await listAppProfiles({ accountId: context.accountId, siteId });
    const profile = profiles.find((item) => item.id === resourceId);
    if (!profile)
        throw HttpError.notFound({ code: 'APP_SEO_ERRORS_NOT_FOUND', messageKey: 'appSeo.errors.notFound' });
    const stores = [
        ...(profile.playPackageId ? ['google_play' as const] : []),
        ...(profile.appStoreId ? ['app_store' as const] : []),
    ];
    const results = await Promise.all(stores.flatMap((store) => (['keywords', 'gap', 'competitors'] as const).map(async (surface) => ({
        surface, store, value: await readLatestAppResearch({ accountId: context.accountId, siteId, profileId: profile.id, store, surface }, db),
    }))));
    return { profile, results };
}
function researchAdapter(db: Db) {
    return createStoredReportAdapter<ResearchSelection>({
        kind: 'app.research_result', localizationStem: 'appResearchResult', formats: ['pdf', 'csv', 'json'], selectionSchema: researchSelectionSchema,
        access: (context) => researchBase(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const loaded = await researchBase(db, context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const selected = loaded.results.find((item) => item.surface === context.selection.surface && item.store === context.selection.store);
            if (!selected)
                throw HttpError.notFound({ code: 'APP_SEO_ERRORS_NOT_FOUND', messageKey: 'appSeo.errors.notFound' });
            const result = selected.value.result;
            const observedAt = result?.fetchedAt ?? loaded.profile.updatedAt;
            const records = result === null ? [storedRecord('app-research', `${selected.surface}:${selected.store}`, stableReportJson({
                    surface: selected.surface, store: selected.store, result: null,
                }), 'observation', { state: 'unavailable', observedAt })] : [
                storedRecord('app-research-summary', `${result.surface}:${result.store}`, stableReportJson(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'rows'))), 'observation', { state: result.cached ? 'cached' : 'observed', observedAt: result.fetchedAt }),
                ...result.rows.map((row, index) => storedRecord('app-research-row', String(index + 1), stableReportJson(row), 'observation', { observedAt: result.fetchedAt })),
            ];
            return { siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: loaded, selectedItems: result?.rows.length ?? 0, records };
        },
    });
}
export function createAppSeoReportExportAdapters(db: Db) {
    return [keywordAdapter(db), researchAdapter(db)] as const;
}
