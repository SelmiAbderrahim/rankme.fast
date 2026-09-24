import { and, eq, inArray, sql } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { appChartSnapshots, appKeywords, appListingSnapshots, appRankSnapshots, type AppListingSnapshotRow, type AppSeoStore, } from '../../db/schema/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { AppProfile } from './app-profile.model.js';
import { APP_CHART_CATALOGS } from './charts-data/index.js';
import type { SupportedLocale } from '../../shared/i18n/index.js';
import { localizeAppListingFinding } from './listing.service.js';
const STORES = ['google_play', 'app_store'] as const;
const NOT_FOUND_KEY = 'appSeo.errors.notFound';
const UNAVAILABLE_KEY = 'appSeo.errors.productUnavailable';
type StoredAppInfo = AppListingSnapshotRow['listing'];
export interface CompareProfileRow {
    id: string;
    paired: boolean;
    playPackageId: string | null;
    appStoreId: string | null;
}
export interface CompareKeywordRow {
    id: string;
    store: AppSeoStore;
    phrase: string;
    locationCode: number;
    languageCode: string;
}
export interface CompareRankSnapshotRow {
    id: string;
    keywordId: string;
    position: number | null;
    checkedAt: Date;
}
export interface CompareListingSnapshotRow {
    id: string;
    store: AppSeoStore;
    capturedAt: Date;
    listing: StoredAppInfo;
    findings: Record<string, unknown>;
}
export interface CompareChartSnapshotRow {
    id: string;
    store: AppSeoStore;
    chartId: string;
    categoryId: string | null;
    position: number | null;
    checkedAt: Date;
}
export interface AppSeoCompareRows {
    profile: CompareProfileRow;
    keywords: readonly CompareKeywordRow[];
    rankSnapshots: readonly CompareRankSnapshotRow[];
    listingSnapshots: readonly CompareListingSnapshotRow[];
    chartSnapshots: readonly CompareChartSnapshotRow[];
}
export interface AppSeoCompareListing {
    store: AppSeoStore;
    appId: string;
    title: string;
    url: string | null;
    rating: number | null;
    reviewCount: number | null;
    capturedAt: string;
}
export interface AppSeoCompareRankCell {
    position: number | null;
    checkedAt: string | null;
}
export interface AppSeoCompareRankRow {
    phrase: string;
    locationCode: number;
    languageCode: string;
    googlePlay: AppSeoCompareRankCell;
    appStore: AppSeoCompareRankCell;
    /** Positive means Google Play is that many positions ahead. */
    delta: number | null;
}
export interface AppSeoCompareOnlyTrackedRow {
    phrase: string;
    locationCode: number;
    languageCode: string;
    position: number | null;
    checkedAt: string | null;
}
interface StoredAppSeoCompareParityFinding {
    id: string;
    status: 'finding' | 'passed' | 'notEvaluated';
    severity: 'fixNow' | 'watch' | 'advisory';
    copyKey: string;
    params: Record<string, string | number>;
    provenance: 'user-paired';
}
export interface AppSeoCompareParityFinding extends StoredAppSeoCompareParityFinding {
    messageVars?: Record<string, string | number>;
    titleKey: string;
    whyKey: string;
    fixKey: string;
    passedLabelKey: string;
    notEvaluatedKey: string;
    title: string;
    why: string;
    fix: string;
    passedText: string;
    notEvaluatedText: string;
}
export type AppSeoCompareRawValue = string | number | string[] | null;
export interface AppSeoCompareRawField {
    field: 'title' | 'developerName' | 'mainCategory' | 'version' | 'categories';
    googlePlay: AppSeoCompareRawValue;
    appStore: AppSeoCompareRawValue;
    matches: boolean | null;
}
export interface AppSeoCompareChartRow {
    chartId: string;
    categoryId: string | null;
    googlePlay: AppSeoCompareRankCell;
    appStore: AppSeoCompareRankCell;
    /** Positive means Google Play is that many positions ahead. */
    delta: number | null;
}
export interface AppSeoComparison {
    profile: CompareProfileRow;
    pairingProvenance: 'user-paired' | null;
    listings: Record<AppSeoStore, AppSeoCompareListing | null>;
    ratingDelta: number | null;
    reviewCountDelta: number | null;
    ranks: {
        shared: AppSeoCompareRankRow[];
        onlyGooglePlay: AppSeoCompareOnlyTrackedRow[];
        onlyAppStore: AppSeoCompareOnlyTrackedRow[];
    };
    listingParity: {
        findings: AppSeoCompareParityFinding[];
        rawFields: AppSeoCompareRawField[];
    };
    charts: AppSeoCompareChartRow[];
}
const normalizedPhrase = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
const keywordKey = (row: Pick<CompareKeywordRow, 'phrase' | 'locationCode' | 'languageCode'>) => `${normalizedPhrase(row.phrase)}\u0000${row.locationCode}\u0000${row.languageCode.toLocaleLowerCase()}`;
const canonicalChartId = (store: AppSeoStore, chartId: string) => {
    const nameKey = APP_CHART_CATALOGS[store].charts.find((chart) => chart.id === chartId)?.nameKey;
    return nameKey?.slice(nameKey.lastIndexOf('.') + 1) ?? chartId;
};
const canonicalCategoryId = (store: AppSeoStore, categoryId: string | null) => categoryId === null
    ? null
    : APP_CHART_CATALOGS[store].categories.find((category) => category.id === categoryId)
        ?.nameKey ?? categoryId;
const chartKey = (row: Pick<CompareChartSnapshotRow, 'store' | 'chartId' | 'categoryId'>) => `${canonicalChartId(row.store, row.chartId)}\u0000${canonicalCategoryId(row.store, row.categoryId) ?? ''}`;
function later<T extends {
    id: string;
}>(candidate: T, current: T | undefined, candidateDate: Date, currentDate?: Date): boolean {
    if (!current)
        return true;
    const difference = candidateDate.getTime() - currentDate!.getTime();
    return difference > 0 || (difference === 0 && candidate.id.localeCompare(current.id) > 0);
}
function positionDelta(googlePlay: number | null, appStore: number | null): number | null {
    return googlePlay === null || appStore === null ? null : appStore - googlePlay;
}
function rankCell(snapshot: CompareRankSnapshotRow | CompareChartSnapshotRow | undefined) {
    return {
        position: snapshot?.position ?? null,
        checkedAt: snapshot?.checkedAt.toISOString() ?? null,
    };
}
function compareRawValue(googlePlay: AppSeoCompareRawValue, appStore: AppSeoCompareRawValue): boolean | null {
    if (googlePlay === null || appStore === null)
        return null;
    const normalized = (value: AppSeoCompareRawValue) => Array.isArray(value)
        ? [...value].map((item) => item.normalize('NFKC').trim().toLocaleLowerCase()).sort()
        : typeof value === 'string'
            ? value.normalize('NFKC').trim().toLocaleLowerCase()
            : value;
    return JSON.stringify(normalized(googlePlay)) === JSON.stringify(normalized(appStore));
}
function rawFields(googlePlay: StoredAppInfo | null, appStore: StoredAppInfo | null): AppSeoCompareRawField[] {
    const values: Array<{
        field: AppSeoCompareRawField['field'];
        googlePlay: AppSeoCompareRawValue;
        appStore: AppSeoCompareRawValue;
    }> = [
        { field: 'title', googlePlay: googlePlay?.title ?? null, appStore: appStore?.title ?? null },
        {
            field: 'developerName',
            googlePlay: googlePlay?.developerName ?? null,
            appStore: appStore?.developerName ?? null,
        },
        {
            field: 'mainCategory',
            googlePlay: googlePlay?.mainCategory ?? null,
            appStore: appStore?.mainCategory ?? null,
        },
        { field: 'version', googlePlay: googlePlay?.version ?? null, appStore: appStore?.version ?? null },
        {
            field: 'categories',
            googlePlay: googlePlay?.categories ?? null,
            appStore: appStore?.categories ?? null,
        },
    ];
    return values.map((row) => ({
        ...row,
        matches: compareRawValue(row.googlePlay, row.appStore),
    }));
}
function isParityFinding(value: unknown): value is StoredAppSeoCompareParityFinding {
    if (!value || typeof value !== 'object')
        return false;
    const row = value as Record<string, unknown>;
    return typeof row.id === 'string'
        && row.scope === 'parity'
        && ['finding', 'passed', 'notEvaluated'].includes(String(row.status))
        && ['fixNow', 'watch', 'advisory'].includes(String(row.severity))
        && typeof row.copyKey === 'string'
        && row.copyKey.startsWith('appSeo.listing.findings.')
        && row.params !== null
        && typeof row.params === 'object'
        && row.provenance === 'user-paired';
}
function parityFindings(snapshots: readonly CompareListingSnapshotRow[]): StoredAppSeoCompareParityFinding[] {
    const byId = new Map<string, StoredAppSeoCompareParityFinding>();
    for (const snapshot of [...snapshots].sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime() || right.id.localeCompare(left.id))) {
        const rows = Array.isArray(snapshot.findings.findings)
            ? snapshot.findings.findings
            : [];
        for (const finding of rows) {
            if (isParityFinding(finding) && !byId.has(finding.id))
                byId.set(finding.id, finding);
        }
    }
    return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
/**
 * Pure deterministic projection over stored rows. It performs no I/O and does
 * not invoke the listing rule engine; persisted parity findings are reused.
 */
export function buildAppSeoComparison(rows: AppSeoCompareRows, locale: SupportedLocale = 'en'): AppSeoComparison {
    const empty: AppSeoComparison = {
        profile: rows.profile,
        pairingProvenance: rows.profile.paired ? 'user-paired' : null,
        listings: { google_play: null, app_store: null },
        ratingDelta: null,
        reviewCountDelta: null,
        ranks: { shared: [], onlyGooglePlay: [], onlyAppStore: [] },
        listingParity: { findings: [], rawFields: rawFields(null, null) },
        charts: [],
    };
    if (!rows.profile.paired)
        return empty;
    const latestRank = new Map<string, CompareRankSnapshotRow>();
    for (const row of rows.rankSnapshots) {
        const current = latestRank.get(row.keywordId);
        if (later(row, current, row.checkedAt, current?.checkedAt))
            latestRank.set(row.keywordId, row);
    }
    const keywordsByStore: Record<AppSeoStore, Map<string, CompareKeywordRow>> = {
        google_play: new Map(),
        app_store: new Map(),
    };
    for (const keyword of rows.keywords) {
        const key = keywordKey(keyword);
        const current = keywordsByStore[keyword.store].get(key);
        if (!current || keyword.id.localeCompare(current.id) < 0) {
            keywordsByStore[keyword.store].set(key, keyword);
        }
    }
    const allKeywordKeys = [...new Set([
            ...keywordsByStore.google_play.keys(),
            ...keywordsByStore.app_store.keys(),
        ])].sort();
    for (const key of allKeywordKeys) {
        const googleKeyword = keywordsByStore.google_play.get(key);
        const appKeyword = keywordsByStore.app_store.get(key);
        if (googleKeyword && appKeyword) {
            const googleSnapshot = latestRank.get(googleKeyword.id);
            const appSnapshot = latestRank.get(appKeyword.id);
            empty.ranks.shared.push({
                phrase: googleKeyword.phrase,
                locationCode: googleKeyword.locationCode,
                languageCode: googleKeyword.languageCode,
                googlePlay: rankCell(googleSnapshot),
                appStore: rankCell(appSnapshot),
                delta: positionDelta(googleSnapshot?.position ?? null, appSnapshot?.position ?? null),
            });
            continue;
        }
        const keyword = googleKeyword ?? appKeyword!;
        const snapshot = latestRank.get(keyword.id);
        const onlyRow = {
            phrase: keyword.phrase,
            locationCode: keyword.locationCode,
            languageCode: keyword.languageCode,
            ...rankCell(snapshot),
        };
        (googleKeyword ? empty.ranks.onlyGooglePlay : empty.ranks.onlyAppStore).push(onlyRow);
    }
    const latestListing = new Map<AppSeoStore, CompareListingSnapshotRow>();
    for (const row of rows.listingSnapshots) {
        const current = latestListing.get(row.store);
        if (later(row, current, row.capturedAt, current?.capturedAt))
            latestListing.set(row.store, row);
    }
    for (const store of STORES) {
        const snapshot = latestListing.get(store);
        if (!snapshot)
            continue;
        empty.listings[store] = {
            store,
            appId: snapshot.listing.appId,
            title: snapshot.listing.title,
            url: snapshot.listing.url,
            rating: snapshot.listing.rating,
            reviewCount: snapshot.listing.reviewCount,
            capturedAt: snapshot.capturedAt.toISOString(),
        };
    }
    const googleListing = latestListing.get('google_play')?.listing ?? null;
    const appListing = latestListing.get('app_store')?.listing ?? null;
    empty.ratingDelta = googleListing?.rating == null || appListing?.rating == null
        ? null
        : Number((googleListing.rating - appListing.rating).toFixed(2));
    empty.reviewCountDelta = googleListing?.reviewCount == null || appListing?.reviewCount == null
        ? null
        : googleListing.reviewCount - appListing.reviewCount;
    empty.listingParity = {
        findings: parityFindings([...latestListing.values()]).map((finding) => ({
            ...localizeAppListingFinding(locale, { ...finding, scope: 'parity' }),
            provenance: 'user-paired' as const,
        })),
        rawFields: rawFields(googleListing, appListing),
    };
    const latestChart = new Map<string, CompareChartSnapshotRow>();
    for (const row of rows.chartSnapshots) {
        const key = `${row.store}\u0000${chartKey(row)}`;
        const current = latestChart.get(key);
        if (later(row, current, row.checkedAt, current?.checkedAt))
            latestChart.set(key, row);
    }
    const selectionKeys = [...new Set([...latestChart.values()].map(chartKey))].sort();
    empty.charts = selectionKeys.map((key) => {
        const googlePlay = latestChart.get(`google_play\u0000${key}`);
        const appStore = latestChart.get(`app_store\u0000${key}`);
        const source = googlePlay ?? appStore!;
        return {
            chartId: source.chartId,
            categoryId: source.categoryId,
            googlePlay: rankCell(googlePlay),
            appStore: rankCell(appStore),
            delta: positionDelta(googlePlay?.position ?? null, appStore?.position ?? null),
        };
    });
    return empty;
}
/** Owner-scoped, stored-only reader. No provider, queue, cap, or meter is reachable. */
export async function readAppSeoComparison(input: {
    accountId: string;
    siteId: string;
    profileId: string;
    locale?: SupportedLocale;
}, db: ApplicationDb): Promise<AppSeoComparison> {
    if (!env.APP_SEO_ENABLED)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    await loadOwnedSite(input.accountId, input.siteId, { allowPaused: true });
    if (!Types.ObjectId.isValid(input.profileId))
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const profile = await AppProfile.findOne({
        _id: input.profileId,
        accountId: input.accountId,
        siteId: input.siteId,
    }).lean();
    if (!profile)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const comparisonProfile: CompareProfileRow = {
        id: String(profile._id),
        paired: Boolean(profile.paired && profile.playPackageId && profile.appStoreId),
        playPackageId: profile.playPackageId ?? null,
        appStoreId: profile.appStoreId ?? null,
    };
    if (!comparisonProfile.paired) {
        return buildAppSeoComparison({
            profile: comparisonProfile,
            keywords: [],
            rankSnapshots: [],
            listingSnapshots: [],
            chartSnapshots: [],
        }, input.locale ?? 'en');
    }
    const keywords = await db
        .select({
        id: appKeywords.id,
        store: appKeywords.store,
        phrase: appKeywords.phrase,
        locationCode: appKeywords.locationCode,
        languageCode: appKeywords.languageCode,
    })
        .from(appKeywords)
        .where(and(eq(appKeywords.accountId, input.accountId), eq(appKeywords.siteId, input.siteId), eq(appKeywords.profileId, input.profileId), eq(appKeywords.active, true)));
    const keywordIds = keywords.map((row) => row.id);
    const rankedSnapshots = keywordIds.length === 0 ? null : db
        .select({
        id: appRankSnapshots.id,
        keywordId: appRankSnapshots.keywordId,
        position: appRankSnapshots.position,
        checkedAt: appRankSnapshots.checkedAt,
        rn: sql<number> `row_number() over (partition by ${appRankSnapshots.keywordId} order by ${appRankSnapshots.checkedAt} desc, ${appRankSnapshots.id} desc)`.as('rn'),
    })
        .from(appRankSnapshots)
        .where(and(eq(appRankSnapshots.accountId, input.accountId), eq(appRankSnapshots.siteId, input.siteId), inArray(appRankSnapshots.keywordId, keywordIds)))
        .as('app_compare_latest_ranks');
    const latestRanks = rankedSnapshots === null ? [] : await db
        .select({
        id: rankedSnapshots.id,
        keywordId: rankedSnapshots.keywordId,
        position: rankedSnapshots.position,
        checkedAt: rankedSnapshots.checkedAt,
    })
        .from(rankedSnapshots)
        .where(eq(rankedSnapshots.rn, 1));
    const listingSnapshots = db
        .select({
        id: appListingSnapshots.id,
        store: appListingSnapshots.store,
        capturedAt: appListingSnapshots.capturedAt,
        listing: appListingSnapshots.listing,
        findings: appListingSnapshots.findings,
        rn: sql<number> `row_number() over (partition by ${appListingSnapshots.profileId}, ${appListingSnapshots.store} order by ${appListingSnapshots.capturedAt} desc, ${appListingSnapshots.id} desc)`.as('rn'),
    })
        .from(appListingSnapshots)
        .where(and(eq(appListingSnapshots.accountId, input.accountId), eq(appListingSnapshots.siteId, input.siteId), eq(appListingSnapshots.profileId, input.profileId)))
        .as('app_compare_latest_listings');
    const latestListings = await db
        .select({
        id: listingSnapshots.id,
        store: listingSnapshots.store,
        capturedAt: listingSnapshots.capturedAt,
        listing: listingSnapshots.listing,
        findings: listingSnapshots.findings,
    })
        .from(listingSnapshots)
        .where(eq(listingSnapshots.rn, 1));
    const chartSnapshots = db
        .select({
        id: appChartSnapshots.id,
        store: appChartSnapshots.store,
        chartId: appChartSnapshots.chartId,
        categoryId: appChartSnapshots.categoryId,
        position: appChartSnapshots.position,
        checkedAt: appChartSnapshots.checkedAt,
        rn: sql<number> `row_number() over (partition by ${appChartSnapshots.profileId}, ${appChartSnapshots.store}, ${appChartSnapshots.chartId}, ${appChartSnapshots.categoryId} order by ${appChartSnapshots.checkedAt} desc, ${appChartSnapshots.id} desc)`.as('rn'),
    })
        .from(appChartSnapshots)
        .where(and(eq(appChartSnapshots.accountId, input.accountId), eq(appChartSnapshots.siteId, input.siteId), eq(appChartSnapshots.profileId, input.profileId)))
        .as('app_compare_latest_charts');
    const latestCharts = await db
        .select({
        id: chartSnapshots.id,
        store: chartSnapshots.store,
        chartId: chartSnapshots.chartId,
        categoryId: chartSnapshots.categoryId,
        position: chartSnapshots.position,
        checkedAt: chartSnapshots.checkedAt,
    })
        .from(chartSnapshots)
        .where(eq(chartSnapshots.rn, 1));
    return buildAppSeoComparison({
        profile: comparisonProfile,
        keywords,
        rankSnapshots: latestRanks,
        listingSnapshots: latestListings,
        chartSnapshots: latestCharts,
    }, input.locale ?? 'en');
}
export const appSeoCompareTestables = Object.freeze({
    canonicalCategoryId,
    canonicalChartId,
    compareRawValue,
    isParityFinding,
    later,
});
