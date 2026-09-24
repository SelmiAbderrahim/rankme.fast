import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { appKeywords, appRankSnapshots, type AppSeoStore, } from '../../db/schema/index.js';
import { appSeoTrackingJobId, enqueueAppSeoTrackingJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { AppProfile } from './app-profile.model.js';
import { getAppSeoTrackingQueue } from './keywords.queue-holder.js';
import type { MintAppKeywordInput } from './keywords.schema.js';
import { appKeywordIsoWeek, appKeywordWeekStart, ensureWeeklyCheckJob, readWeeklyCheckJobStatus, type WeeklyCheckJobStatus, } from './weekly-checks.js';
const NOT_FOUND_KEY = 'appSeo.errors.keywordNotFound';
const UNAVAILABLE_KEY = 'appSeo.errors.keywordTrackingUnavailable';
export type AppKeywordCheckStatus = 'idle' | 'queued' | 'succeeded' | 'failed';
export interface AppKeywordDto {
    id: string;
    profileId: string;
    store: AppSeoStore;
    phrase: string;
    locationCode: number;
    languageCode: string;
    active: boolean;
    latestPosition: number | null;
    previousPosition: number | null;
    delta: number | null;
    lastCheckedAt: string | null;
    lastFailedCheckAt: string | null;
    checkStatus: AppKeywordCheckStatus;
    createdAt: string;
}
export interface AppKeywordHistoryPoint {
    checkedAt: string;
    position: number | null;
    rankAbsolute: number | null;
    foundAppId: string | null;
}
function requireTrackingEnabled(): void {
    if (!env.APP_SEO_ENABLED || !env.APP_KEYWORD_TRACKING_ENABLED) {
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    }
}
function isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Error))
        return false;
    const candidate = error as Error & {
        code?: unknown;
        cause?: {
            code?: unknown;
        };
    };
    return candidate.code === '23505' || candidate.cause?.code === '23505';
}
async function requireOwnedProfile(accountId: string, siteId: string, profileId: string, allowPaused = true) {
    await loadOwnedSite(accountId, siteId, { allowPaused });
    if (!Types.ObjectId.isValid(profileId))
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const profile = await AppProfile.findOne({
        _id: profileId,
        accountId,
        siteId,
    });
    if (!profile)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return profile;
}
async function requireOwnedKeyword(db: ApplicationDb, accountId: string, siteId: string, keywordId: string, allowPaused = true) {
    await loadOwnedSite(accountId, siteId, { allowPaused });
    const rows = await db
        .select()
        .from(appKeywords)
        .where(and(eq(appKeywords.id, keywordId), eq(appKeywords.accountId, accountId), eq(appKeywords.siteId, siteId)))
        .limit(1);
    const keyword = rows[0];
    if (!keyword)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const profile = await requireOwnedProfile(accountId, siteId, keyword.profileId, true);
    return { keyword, profile };
}
export function previewAppKeywordCheck(): SpendPreview {
    return { deploymentMode: 'community', capacityEnforced: false };
}
export async function previewMintAppKeyword(input: {
    accountId: string;
    siteId: string;
    profileId: string;
    store: AppSeoStore;
}) {
    requireTrackingEnabled();
    const profile = await requireOwnedProfile(input.accountId, input.siteId, input.profileId);
    const appId = input.store === 'google_play' ? profile.playPackageId : profile.appStoreId;
    if (!appId)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return { check: previewAppKeywordCheck() };
}
export async function mintAppKeyword(input: {
    accountId: string;
    siteId: string;
    profileId: string;
    keyword: MintAppKeywordInput;
}, db: ApplicationDb): Promise<AppKeywordDto> {
    requireTrackingEnabled();
    const profile = await requireOwnedProfile(input.accountId, input.siteId, input.profileId);
    const appId = input.keyword.store === 'google_play' ? profile.playPackageId : profile.appStoreId;
    if (!appId)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    try {
        const inserted = await db
            .insert(appKeywords)
            .values({
            accountId: input.accountId,
            siteId: input.siteId,
            profileId: input.profileId,
            store: input.keyword.store,
            phrase: input.keyword.phrase,
            locationCode: input.keyword.locationCode,
            languageCode: input.keyword.languageCode.toLocaleLowerCase(),
        })
            .returning();
        const row = inserted[0]!;
        return {
            id: row.id,
            profileId: row.profileId,
            store: row.store,
            phrase: row.phrase,
            locationCode: row.locationCode,
            languageCode: row.languageCode,
            active: row.active,
            latestPosition: null,
            previousPosition: null,
            delta: null,
            lastCheckedAt: null,
            lastFailedCheckAt: null,
            checkStatus: 'idle',
            createdAt: row.createdAt.toISOString(),
        };
    }
    catch (error) {
        if (isUniqueViolation(error)) {
            throw HttpError.conflict({ code: 'APP_SEO_ERRORS_DUPLICATE_KEYWORD', messageKey: 'appSeo.errors.duplicateKeyword' });
        }
        throw error;
    }
}
/** This week's queued or failed check per keyword, read from the tracking queue. */
async function currentWeekJobStatuses(keywordIds: readonly string[]): Promise<Map<string, WeeklyCheckJobStatus>> {
    const statuses = new Map<string, WeeklyCheckJobStatus>();
    const queue = getAppSeoTrackingQueue();
    if (!queue)
        return statuses;
    const stamp = appKeywordIsoWeek(new Date());
    await Promise.all(keywordIds.map(async (keywordId) => {
        const status = await readWeeklyCheckJobStatus(queue, appSeoTrackingJobId(keywordId, stamp));
        if (status)
            statuses.set(keywordId, status);
    }));
    return statuses;
}
export async function listAppKeywords(input: {
    accountId: string;
    siteId: string;
    profileId: string;
}, db: ApplicationDb) {
    await requireOwnedProfile(input.accountId, input.siteId, input.profileId);
    const keywords = await db
        .select()
        .from(appKeywords)
        .where(and(eq(appKeywords.accountId, input.accountId), eq(appKeywords.siteId, input.siteId), eq(appKeywords.profileId, input.profileId), eq(appKeywords.active, true)))
        .orderBy(desc(appKeywords.createdAt), desc(appKeywords.id));
    const ids = keywords.map((row) => row.id);
    const snapshots = ids.length === 0 ? [] : await db
        .select()
        .from(appRankSnapshots)
        .where(and(eq(appRankSnapshots.accountId, input.accountId), eq(appRankSnapshots.siteId, input.siteId), inArray(appRankSnapshots.keywordId, ids)))
        .orderBy(desc(appRankSnapshots.checkedAt));
    const jobStatuses = await currentWeekJobStatuses(ids);
    const snapshotsByKeyword = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots) {
        const bucket = snapshotsByKeyword.get(snapshot.keywordId) ?? [];
        if (bucket.length < 2)
            bucket.push(snapshot);
        snapshotsByKeyword.set(snapshot.keywordId, bucket);
    }
    const items: AppKeywordDto[] = keywords.map((keyword) => {
        const [latest, previous] = snapshotsByKeyword.get(keyword.id) ?? [];
        const delta = latest?.position !== null && latest?.position !== undefined &&
            previous?.position !== null && previous?.position !== undefined
            ? previous.position - latest.position
            : null;
        const job = jobStatuses.get(keyword.id);
        return {
            id: keyword.id,
            profileId: keyword.profileId,
            store: keyword.store,
            phrase: keyword.phrase,
            locationCode: keyword.locationCode,
            languageCode: keyword.languageCode,
            active: keyword.active,
            latestPosition: latest?.position ?? null,
            previousPosition: previous?.position ?? null,
            delta,
            lastCheckedAt: latest?.checkedAt.toISOString() ?? null,
            lastFailedCheckAt: job?.status === 'failed' ? job.failedAt?.toISOString() ?? null : null,
            checkStatus: job?.status ?? (latest ? 'succeeded' : 'idle'),
            createdAt: keyword.createdAt.toISOString(),
        };
    });
    return {
        items,
        trackingEnabled: env.APP_SEO_ENABLED && env.APP_KEYWORD_TRACKING_ENABLED,
    };
}
export async function deleteAppKeyword(input: {
    accountId: string;
    siteId: string;
    keywordId: string;
}, db: ApplicationDb): Promise<void> {
    requireTrackingEnabled();
    await requireOwnedKeyword(db, input.accountId, input.siteId, input.keywordId);
    await db
        .delete(appKeywords)
        .where(and(eq(appKeywords.id, input.keywordId), eq(appKeywords.accountId, input.accountId), eq(appKeywords.siteId, input.siteId)));
}
export async function recheckAppKeyword(input: {
    accountId: string;
    siteId: string;
    keywordId: string;
    confirm: boolean;
}, db: ApplicationDb) {
    requireTrackingEnabled();
    const { keyword } = await requireOwnedKeyword(db, input.accountId, input.siteId, input.keywordId, !input.confirm);
    const preview = previewAppKeywordCheck();
    if (!input.confirm)
        return { preview, queued: false, reservationStamp: null };
    const queue = getAppSeoTrackingQueue();
    if (!queue)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    const reservationStamp = appKeywordIsoWeek(new Date());
    const stored = await db
        .select({ id: appRankSnapshots.id })
        .from(appRankSnapshots)
        .where(and(eq(appRankSnapshots.accountId, input.accountId), eq(appRankSnapshots.siteId, input.siteId), eq(appRankSnapshots.keywordId, keyword.id), eq(appRankSnapshots.checkedAt, appKeywordWeekStart(reservationStamp))))
        .limit(1);
    if (stored.length > 0)
        return { preview, queued: false, reservationStamp };
    await ensureWeeklyCheckJob(queue, appSeoTrackingJobId(keyword.id, reservationStamp), () => enqueueAppSeoTrackingJob(queue, {
        accountId: input.accountId,
        siteId: input.siteId,
        profileId: keyword.profileId,
        keywordId: keyword.id,
        reservationStamp,
        manual: true,
    }));
    return { preview, queued: true, reservationStamp };
}
export async function getAppKeywordHistory(input: {
    accountId: string;
    siteId: string;
    keywordId: string;
    limit: number;
}, db: ApplicationDb): Promise<AppKeywordHistoryPoint[]> {
    await requireOwnedKeyword(db, input.accountId, input.siteId, input.keywordId);
    const rows = await db
        .select({
        checkedAt: appRankSnapshots.checkedAt,
        position: appRankSnapshots.position,
        rankAbsolute: appRankSnapshots.rankAbsolute,
        foundAppId: appRankSnapshots.foundAppId,
    })
        .from(appRankSnapshots)
        .where(and(eq(appRankSnapshots.accountId, input.accountId), eq(appRankSnapshots.siteId, input.siteId), eq(appRankSnapshots.keywordId, input.keywordId)))
        .orderBy(desc(appRankSnapshots.checkedAt))
        .limit(input.limit);
    return rows.reverse().map((row) => ({ ...row, checkedAt: row.checkedAt.toISOString() }));
}
export const appKeywordServiceTestables = Object.freeze({
    requireTrackingEnabled,
    isUniqueViolation,
    requireOwnedProfile,
    requireOwnedKeyword,
    currentWeekJobStatuses,
});
