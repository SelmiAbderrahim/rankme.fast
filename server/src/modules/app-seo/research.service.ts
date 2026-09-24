import type { SpendCachedStatus, SpendPreview } from '../../shared/safety/operation-preview.js';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { vendorResponses } from '../../db/schema/index.js';
import { ProviderError, type AppDataProvider, type AppBulkMetricsRow, type AppStoreKind, } from '../../shared/providers/index.js';
import { createReadThrough, createSingleFlight, createVendorCacheRepo, probeReadThrough, type ReadThrough, } from '../../shared/vendor-cache/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { AppProfile } from './app-profile.model.js';
import { APP_STORE_ID_REGEX, PLAY_PACKAGE_ID_REGEX } from './app-seo.schema.js';
import { appBulkMetricRowsSchema, appCompetitorRowsSchema, appIntersectionRowsSchema, appKeywordRowsSchema, appResearchCompetitorResultSchema, appResearchGapResultSchema, appResearchKeywordResultSchema, type AppResearchCompetitorResult, type AppResearchCompetitorsInput, type AppResearchGapInput, type AppResearchGapResult, type AppResearchKeywordResult, type AppResearchKeywordsInput, } from './research.schema.js';
const NOT_FOUND_KEY = 'appSeo.errors.notFound';
const UNAVAILABLE_KEY = 'appSeo.research.errors.productUnavailable';
const MARKET_KEY = 'appSeo.research.errors.usEnglishOnly';
/** ASO ranks change slowly; match the shipped keyword-research 30-day cache. */
export const APP_RESEARCH_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const APP_RESEARCH_OPERATIONS = {
    keywords: 'app-research-keywords',
    gap: 'app-research-gap',
    competitors: 'app-research-competitors',
    metrics: 'app-research-competitor-metrics',
    keywordsResult: 'app-research-keywords-result',
    gapResult: 'app-research-gap-result',
    competitorsResult: 'app-research-competitors-result',
} as const;
/**
 * Cache posture by operation:
 * - keywords/gap/competitors/metrics contain public store facts only and are
 *   shared cross-account through vendor_cache with normalized input keys;
 * - the three *Result operations are owner-scoped vendor_responses archives
 *   used only for latest-result reads. They are never read through the cache.
 */
let currentProvider: AppDataProvider | null = null;
const researchSingleFlight = createSingleFlight();
export function setAppSeoResearchProvider(provider: AppDataProvider | null): void {
    currentProvider = provider;
}
function getProvider(): AppDataProvider {
    if (!currentProvider) {
        throw new Error('app-seo research provider not configured at boot');
    }
    return currentProvider;
}
function requireResearchEnabled(): void {
    if (!env.APP_SEO_ENABLED || !env.APP_RESEARCH_ENABLED) {
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    }
}
function normalizeAppId(store: AppStoreKind, appId: string): string {
    const trimmed = appId.trim();
    return store === 'google_play' ? trimmed.toLocaleLowerCase() : trimmed;
}
function assertUsEnglish(locationCode: number, languageCode: string): void {
    if (locationCode !== 2840 || languageCode.trim().toLocaleLowerCase() !== 'en') {
        throw HttpError.badRequest({ code: 'MARKET', messageKey: MARKET_KEY });
    }
}
function requireCachedProbeValue<T>(value: T | null): T {
    if (value === null)
        throw new Error('cached app-research probe is missing its parsed value');
    return value;
}
async function requireOwnedProfile(accountId: string, siteId: string, profileId: string, store: AppStoreKind, allowPaused = false) {
    await loadOwnedSite(accountId, siteId, { allowPaused });
    if (!Types.ObjectId.isValid(profileId))
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const profile = await AppProfile.findOne({
        _id: profileId,
        accountId,
        siteId,
    }).select({ playPackageId: 1, appStoreId: 1 });
    if (!profile)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const appId = store === 'google_play' ? profile.playPackageId : profile.appStoreId;
    if (!appId)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return { profile, appId: normalizeAppId(store, appId) };
}
function readThrough(db: ApplicationDb): ReadThrough {
    return createReadThrough({
        repo: createVendorCacheRepo(db),
        singleFlight: researchSingleFlight,
    });
}
async function appendOwnedResult(db: ApplicationDb, input: {
    operation: string;
    accountId: string;
    siteId: string;
    profileId: string;
    store: AppStoreKind;
    payload: unknown;
    fetchedAt: Date;
}): Promise<void> {
    const repo = createVendorCacheRepo(db);
    await repo.appendResponse({
        capability: 'keyword',
        operation: input.operation,
        cacheKey: `${input.accountId}:${input.siteId}:${input.profileId}:${input.store}:${input.fetchedAt.toISOString()}`,
        params: { profileId: input.profileId, store: input.store },
        payload: input.payload,
        accountId: input.accountId,
        siteId: input.siteId,
        fetchedAt: input.fetchedAt,
    });
}
export async function previewAppResearch(input: {
    accountId: string;
    siteId: string;
    profileId: string;
    store: AppStoreKind;
    surface: 'keywords' | 'gap' | 'competitors';
    locationCode: number;
    languageCode: string;
    appIds?: string[];
}, db: ApplicationDb): Promise<SpendPreview> {
    requireResearchEnabled();
    const { appId } = await requireOwnedProfile(input.accountId, input.siteId, input.profileId, input.store);
    if (input.surface === 'gap') {
        assertUsEnglish(input.locationCode, input.languageCode);
    }
    const repo = createVendorCacheRepo(db);
    const now = new Date();
    let cachedStatus: SpendCachedStatus;
    if (input.surface === 'keywords') {
        const probe = await probeReadThrough(repo, {
            capability: 'keyword',
            operation: APP_RESEARCH_OPERATIONS.keywords,
            params: {
                store: input.store,
                appId,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLocaleLowerCase(),
            },
            payloadSchema: appKeywordRowsSchema,
            now,
        });
        cachedStatus = probe.cached ? 'hit' : 'miss';
    }
    else if (input.surface === 'gap') {
        const appIds = [...new Set((input.appIds ?? []).map((id) => normalizeAppId(input.store, id)))].sort();
        if (appIds.length < 2 || appIds.length > 20) {
            throw HttpError.badRequest({ code: 'APP_SEO_RESEARCH_ERRORS_APP_ID_COUNT', messageKey: 'appSeo.research.errors.appIdCount' });
        }
        if (!appIds.includes(appId)) {
            throw HttpError.badRequest({ code: 'APP_SEO_RESEARCH_ERRORS_OWN_APP_REQUIRED', messageKey: 'appSeo.research.errors.ownAppRequired' });
        }
        const idRegex = input.store === 'google_play' ? PLAY_PACKAGE_ID_REGEX : APP_STORE_ID_REGEX;
        if (appIds.some((candidate) => !idRegex.test(candidate))) {
            throw HttpError.badRequest({ code: 'APP_SEO_RESEARCH_ERRORS_INVALID_APP_ID', messageKey: 'appSeo.research.errors.invalidAppId' });
        }
        const probe = await probeReadThrough(repo, {
            capability: 'keyword',
            operation: APP_RESEARCH_OPERATIONS.gap,
            params: { store: input.store, appIds, locationCode: 2840, languageCode: 'en' },
            payloadSchema: appIntersectionRowsSchema,
            now,
        });
        cachedStatus = probe.cached ? 'hit' : 'miss';
    }
    else {
        const competitorProbe = await probeReadThrough(repo, {
            capability: 'keyword',
            operation: APP_RESEARCH_OPERATIONS.competitors,
            params: {
                store: input.store,
                appId,
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLocaleLowerCase(),
            },
            payloadSchema: appCompetitorRowsSchema,
            now,
        });
        if (!competitorProbe.cached) {
            cachedStatus = 'miss';
        }
        else {
            const appIds = requireCachedProbeValue(competitorProbe.value)
                .slice(0, 50)
                .map((row) => row.appId)
                .sort();
            if (appIds.length === 0) {
                cachedStatus = 'hit';
            }
            else {
                const metricsProbe = await probeReadThrough(repo, {
                    capability: 'keyword',
                    operation: APP_RESEARCH_OPERATIONS.metrics,
                    params: {
                        store: input.store,
                        appIds,
                        locationCode: input.locationCode,
                        languageCode: input.languageCode.toLocaleLowerCase(),
                    },
                    payloadSchema: appBulkMetricRowsSchema,
                    now,
                });
                cachedStatus = metricsProbe.cached ? 'hit' : 'partial';
            }
        }
    }
    return {
        deploymentMode: 'community',
        capacityEnforced: false,
        operation: `app-research-${input.surface}`,
        cachedStatus,
    };
}
export async function runAppKeywordResearch(request: {
    accountId: string;
    siteId: string;
    input: AppResearchKeywordsInput;
}, db: ApplicationDb): Promise<AppResearchKeywordResult> {
    // Contractual submit order: flag → owner → cache/live → persist.
    requireResearchEnabled();
    const { appId } = await requireOwnedProfile(request.accountId, request.siteId, request.input.profileId, request.input.store);
    const params = {
        store: request.input.store,
        appId,
        locationCode: request.input.locationCode,
        languageCode: request.input.languageCode.toLocaleLowerCase(),
    };
    const result = await readThrough(db)({
        capability: 'keyword',
        operation: APP_RESEARCH_OPERATIONS.keywords,
        params,
        ttlMs: APP_RESEARCH_CACHE_TTL_MS,
        payloadSchema: appKeywordRowsSchema,
        now: new Date(),
        fetch: () => getProvider().keywordsForApp({ ...params, limit: 100 }),
    });
    const end = Math.min(100, request.input.cursor + request.input.pageSize);
    const rows = result.value.slice(request.input.cursor, end);
    const payload = appResearchKeywordResultSchema.parse({
        surface: 'keywords',
        profileId: request.input.profileId,
        store: request.input.store,
        appId,
        rows,
        cursor: request.input.cursor,
        nextCursor: end < result.value.length ? end : null,
        totalRows: result.value.length,
        cached: result.cached,
        fetchedAt: result.fetchedAt.toISOString(),
    });
    await appendOwnedResult(db, {
        operation: APP_RESEARCH_OPERATIONS.keywordsResult,
        accountId: request.accountId,
        siteId: request.siteId,
        profileId: request.input.profileId,
        store: request.input.store,
        payload,
        fetchedAt: new Date(),
    });
    return payload;
}
export async function runAppGapResearch(request: {
    accountId: string;
    siteId: string;
    input: AppResearchGapInput;
}, db: ApplicationDb): Promise<AppResearchGapResult> {
    requireResearchEnabled();
    const { appId: ownAppId } = await requireOwnedProfile(request.accountId, request.siteId, request.input.profileId, request.input.store);
    assertUsEnglish(request.input.locationCode, request.input.languageCode);
    const appIds = [...new Set(request.input.appIds.map((id) => normalizeAppId(request.input.store, id)))].sort();
    if (appIds.length < 2 || appIds.length > 20) {
        throw HttpError.badRequest({ code: 'APP_SEO_RESEARCH_ERRORS_APP_ID_COUNT', messageKey: 'appSeo.research.errors.appIdCount' });
    }
    if (!appIds.includes(ownAppId)) {
        throw HttpError.badRequest({ code: 'APP_SEO_RESEARCH_ERRORS_OWN_APP_REQUIRED', messageKey: 'appSeo.research.errors.ownAppRequired' });
    }
    const params = {
        store: request.input.store,
        appIds,
        locationCode: 2840,
        languageCode: 'en',
    };
    const result = await readThrough(db)({
        capability: 'keyword',
        operation: APP_RESEARCH_OPERATIONS.gap,
        params,
        ttlMs: APP_RESEARCH_CACHE_TTL_MS,
        payloadSchema: appIntersectionRowsSchema,
        now: new Date(),
        fetch: () => getProvider().appIntersection({ ...params, limit: 100 }),
    });
    const payload = appResearchGapResultSchema.parse({
        surface: 'gap',
        profileId: request.input.profileId,
        store: request.input.store,
        ownAppId,
        appIds,
        rows: result.value,
        cached: result.cached,
        fetchedAt: result.fetchedAt.toISOString(),
    });
    await appendOwnedResult(db, {
        operation: APP_RESEARCH_OPERATIONS.gapResult,
        accountId: request.accountId,
        siteId: request.siteId,
        profileId: request.input.profileId,
        store: request.input.store,
        payload,
        fetchedAt: new Date(),
    });
    return payload;
}
export async function runAppCompetitorDiscovery(request: {
    accountId: string;
    siteId: string;
    input: AppResearchCompetitorsInput;
}, db: ApplicationDb): Promise<AppResearchCompetitorResult> {
    requireResearchEnabled();
    const { appId } = await requireOwnedProfile(request.accountId, request.siteId, request.input.profileId, request.input.store);
    const baseParams = {
        store: request.input.store,
        appId,
        locationCode: request.input.locationCode,
        languageCode: request.input.languageCode.toLocaleLowerCase(),
    };
    const competitors = await readThrough(db)({
        capability: 'keyword',
        operation: APP_RESEARCH_OPERATIONS.competitors,
        params: baseParams,
        ttlMs: APP_RESEARCH_CACHE_TTL_MS,
        payloadSchema: appCompetitorRowsSchema,
        now: new Date(),
        fetch: () => getProvider().appCompetitors({ ...baseParams, limit: 100 }),
    });
    let metricRows: AppBulkMetricsRow[] = [];
    let metricsCached = true;
    let metricsFetchedAt = competitors.fetchedAt;
    let partial = false;
    let noteKey: string | null = null;
    const metricAppIds = competitors.value.slice(0, 50).map((row) => row.appId);
    if (metricAppIds.length > 0) {
        try {
            const metrics = await readThrough(db)({
                capability: 'keyword',
                operation: APP_RESEARCH_OPERATIONS.metrics,
                params: {
                    store: request.input.store,
                    appIds: [...metricAppIds].sort(),
                    locationCode: request.input.locationCode,
                    languageCode: request.input.languageCode.toLocaleLowerCase(),
                },
                ttlMs: APP_RESEARCH_CACHE_TTL_MS,
                payloadSchema: appBulkMetricRowsSchema,
                now: new Date(),
                fetch: () => getProvider().bulkAppMetrics({
                    store: request.input.store,
                    appIds: metricAppIds,
                    locationCode: request.input.locationCode,
                    languageCode: request.input.languageCode.toLocaleLowerCase(),
                }),
            });
            // Normalize Zod defaults (notably observation market/null fields) at
            // this persistence boundary before assigning the public output type.
            metricRows = appBulkMetricRowsSchema.parse(metrics.value);
            metricsCached = metrics.cached;
            metricsFetchedAt = metrics.fetchedAt;
        }
        catch (error) {
            if (!(error instanceof ProviderError))
                throw error;
            // The first vendor call is already archived by read-through. Keep and
            // render that evidence as a partial result.
            partial = true;
            metricsCached = false;
            noteKey = 'appSeo.research.competitors.partialNote';
        }
    }
    const metricsById = new Map(metricRows.map((row) => [row.appId, row]));
    const payload = appResearchCompetitorResultSchema.parse({
        surface: 'competitors',
        profileId: request.input.profileId,
        store: request.input.store,
        appId,
        rows: competitors.value.map((competitor) => ({
            competitor,
            metrics: metricsById.get(competitor.appId) ?? null,
        })),
        partial,
        noteKey,
        cached: competitors.cached && metricsCached,
        fetchedAt: new Date(Math.max(competitors.fetchedAt.getTime(), metricsFetchedAt.getTime())).toISOString(),
    });
    await appendOwnedResult(db, {
        operation: APP_RESEARCH_OPERATIONS.competitorsResult,
        accountId: request.accountId,
        siteId: request.siteId,
        profileId: request.input.profileId,
        store: request.input.store,
        payload,
        fetchedAt: new Date(),
    });
    return payload;
}
type StoredSurface = 'keywords' | 'gap' | 'competitors';
export async function readLatestAppResearch(input: {
    accountId: string;
    siteId: string;
    profileId: string;
    store: AppStoreKind;
    surface: StoredSurface;
}, db: ApplicationDb): Promise<{
    result: AppResearchKeywordResult | AppResearchGapResult | AppResearchCompetitorResult | null;
    researchEnabled: boolean;
}> {
    await requireOwnedProfile(input.accountId, input.siteId, input.profileId, input.store, true);
    const operation = {
        keywords: APP_RESEARCH_OPERATIONS.keywordsResult,
        gap: APP_RESEARCH_OPERATIONS.gapResult,
        competitors: APP_RESEARCH_OPERATIONS.competitorsResult,
    }[input.surface];
    const rows = await db
        .select({ payload: vendorResponses.payload })
        .from(vendorResponses)
        .where(and(eq(vendorResponses.capability, 'keyword'), eq(vendorResponses.operation, operation), eq(vendorResponses.accountId, input.accountId), eq(vendorResponses.siteId, input.siteId), sql `${vendorResponses.params} @> ${JSON.stringify({
        profileId: input.profileId,
        store: input.store,
    })}::jsonb`))
        .orderBy(desc(vendorResponses.fetchedAt), desc(vendorResponses.createdAt))
        .limit(1);
    const schema = {
        keywords: appResearchKeywordResultSchema,
        gap: appResearchGapResultSchema,
        competitors: appResearchCompetitorResultSchema,
    }[input.surface];
    const parsed = rows[0] ? schema.safeParse(rows[0].payload) : null;
    return {
        result: parsed?.success ? parsed.data : null,
        researchEnabled: env.APP_SEO_ENABLED && env.APP_RESEARCH_ENABLED,
    };
}
export const appResearchTestables = Object.freeze({
    getProvider,
    requireResearchEnabled,
    normalizeAppId,
    assertUsEnglish,
    requireCachedProbeValue,
    requireOwnedProfile,
    readThrough,
    appendOwnedResult,
});
