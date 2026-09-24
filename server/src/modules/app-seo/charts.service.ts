import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { and, desc, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { appChartSnapshots } from '../../db/schema/index.js';
import type { AppStoreKind } from '../../shared/providers/app-data.js';
import { appSeoChartJobId, enqueueAppSeoChartJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { AppProfile } from './app-profile.model.js';
import { APP_CHART_CATALOGS, isSupportedAppChartSelection } from './charts-data/index.js';
import { AppChartSubscription, type AppChartSubscriptionDocument } from './charts.model.js';
import type { CreateAppChartSubscriptionInput } from './charts.schema.js';
import { getAppSeoTrackingQueue } from './keywords.queue-holder.js';
import { appKeywordIsoWeek, appKeywordWeekStart, ensureWeeklyCheckJob } from './weekly-checks.js';
export const MAX_CHART_SUBSCRIPTIONS_PER_PROFILE = 2;
const NOT_FOUND_KEY = 'appSeo.errors.chartSubscriptionNotFound';
const UNAVAILABLE_KEY = 'appSeo.errors.chartTrackingUnavailable';
export interface AppChartSubscriptionDto {
    id: string;
    profileId: string;
    store: AppStoreKind;
    chartId: string;
    categoryId: string;
    locationCode: number;
    languageCode: string;
    latestPosition: number | null;
    previousPosition: number | null;
    delta: number | null;
    lastCheckedAt: string | null;
    createdAt: string;
}
export interface AppChartHistoryPoint {
    checkedAt: string;
    position: number | null;
}
function chartTrackingEnabled(): boolean {
    return env.APP_SEO_ENABLED && env.APP_CHART_TRACKING_ENABLED;
}
function requireChartTrackingEnabled(): void {
    if (!chartTrackingEnabled()) {
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    }
}
async function requireOwnedProfile(accountId: string, siteId: string, profileId: string, allowPaused: boolean) {
    await loadOwnedSite(accountId, siteId, { allowPaused });
    if (!Types.ObjectId.isValid(profileId))
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const profile = await AppProfile.findOne({ _id: profileId, accountId, siteId });
    if (!profile)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return profile;
}
async function requireOwnedSubscription(accountId: string, siteId: string, subscriptionId: string, allowPaused: boolean) {
    await loadOwnedSite(accountId, siteId, { allowPaused });
    if (!Types.ObjectId.isValid(subscriptionId))
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const subscription = await AppChartSubscription.findOne({
        _id: subscriptionId,
        accountId,
        siteId,
    });
    if (!subscription)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    await requireOwnedProfile(accountId, siteId, String(subscription.profileId), true);
    return subscription;
}
function targetAppId(profile: {
    playPackageId?: string | null;
    appStoreId?: string | null;
}, store: AppStoreKind): string | null {
    return store === 'google_play'
        ? profile.playPackageId ?? null
        : profile.appStoreId ?? null;
}
function isMongoDuplicateError(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 11000;
}
function nextAvailableChartSlot(occupied: ReadonlyArray<{
    slot: number;
}>): 0 | 1 {
    return occupied.some((item) => item.slot === 0) ? 1 : 0;
}
function snapshotKey(store: string, chartId: string, categoryId: string | null): string {
    return `${store}\u0000${chartId}\u0000${categoryId ?? ''}`;
}
function baseDto(subscription: AppChartSubscriptionDocument & {
    _id: unknown;
}): Omit<AppChartSubscriptionDto, 'latestPosition' | 'previousPosition' | 'delta' | 'lastCheckedAt'> {
    return {
        id: String(subscription._id),
        profileId: String(subscription.profileId),
        store: subscription.store,
        chartId: subscription.chartId,
        categoryId: subscription.categoryId,
        locationCode: subscription.locationCode,
        languageCode: subscription.languageCode,
        createdAt: subscription.createdAt.toISOString(),
    };
}
/**
 * Chart subscriptions are loose user configuration and therefore stay in
 * Mongo as a separate AppProfile child. Ordered position observations stay
 * in the Postgres `app_chart_snapshots` table.
 */
export async function createAppChartSubscription(input: {
    accountId: string;
    siteId: string;
    subscription: CreateAppChartSubscriptionInput;
}): Promise<AppChartSubscriptionDto> {
    // Contractual gate order: feature flag → ownership 404 → bound → create.
    requireChartTrackingEnabled();
    const profile = await requireOwnedProfile(input.accountId, input.siteId, input.subscription.profileId, false);
    if (!targetAppId(profile, input.subscription.store)) {
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    }
    if (!isSupportedAppChartSelection(input.subscription.store, input.subscription.chartId, input.subscription.categoryId)) {
        throw HttpError.badRequest({ code: 'APP_SEO_ERRORS_INVALID_CHART_SELECTION', messageKey: 'appSeo.errors.invalidChartSelection' });
    }
    const ownerScope = {
        accountId: input.accountId,
        siteId: input.siteId,
        profileId: input.subscription.profileId,
    };
    const duplicate = await AppChartSubscription.exists({
        ...ownerScope,
        store: input.subscription.store,
        chartId: input.subscription.chartId,
        categoryId: input.subscription.categoryId,
    });
    if (duplicate)
        throw HttpError.conflict({ code: 'APP_SEO_ERRORS_DUPLICATE_CHART_SUBSCRIPTION', messageKey: 'appSeo.errors.duplicateChartSubscription' });
    const occupied = await AppChartSubscription.find(ownerScope, { slot: 1 }).lean();
    if (occupied.length >= MAX_CHART_SUBSCRIPTIONS_PER_PROFILE) {
        throw HttpError.conflict({ code: 'APP_SEO_ERRORS_CHART_SUBSCRIPTION_LIMIT', messageKey: 'appSeo.errors.chartSubscriptionLimit' });
    }
    const slot = nextAvailableChartSlot(occupied);
    try {
        const created = await AppChartSubscription.create({
            ...ownerScope,
            store: input.subscription.store,
            chartId: input.subscription.chartId,
            categoryId: input.subscription.categoryId,
            locationCode: input.subscription.locationCode,
            languageCode: input.subscription.languageCode.toLocaleLowerCase(),
            slot,
        });
        return {
            ...baseDto(created),
            latestPosition: null,
            previousPosition: null,
            delta: null,
            lastCheckedAt: null,
        };
    }
    catch (error) {
        if (isMongoDuplicateError(error)) {
            const nowDuplicate = await AppChartSubscription.exists({
                ...ownerScope,
                store: input.subscription.store,
                chartId: input.subscription.chartId,
                categoryId: input.subscription.categoryId,
            });
            throw HttpError.conflict({ code: 'CONFLICT', messageKey: nowDuplicate
                    ? 'appSeo.errors.duplicateChartSubscription'
                    : 'appSeo.errors.chartSubscriptionLimit' });
        }
        throw error;
    }
}
export async function listAppChartSubscriptions(input: {
    accountId: string;
    siteId: string;
    profileId: string;
}, db: ApplicationDb) {
    await requireOwnedProfile(input.accountId, input.siteId, input.profileId, true);
    const subscriptions = await AppChartSubscription.find({
        accountId: input.accountId,
        siteId: input.siteId,
        profileId: input.profileId,
    }).sort({ createdAt: -1, _id: -1 });
    const snapshots = await db
        .select()
        .from(appChartSnapshots)
        .where(and(eq(appChartSnapshots.accountId, input.accountId), eq(appChartSnapshots.siteId, input.siteId), eq(appChartSnapshots.profileId, input.profileId)))
        .orderBy(desc(appChartSnapshots.checkedAt));
    const bySelection = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots) {
        const key = snapshotKey(snapshot.store, snapshot.chartId, snapshot.categoryId);
        const bucket = bySelection.get(key) ?? [];
        if (bucket.length < 2)
            bucket.push(snapshot);
        bySelection.set(key, bucket);
    }
    const items: AppChartSubscriptionDto[] = subscriptions.map((subscription) => {
        const [latest, previous] = bySelection.get(snapshotKey(subscription.store, subscription.chartId, subscription.categoryId)) ?? [];
        const delta = latest?.position != null && previous?.position != null
            ? previous.position - latest.position
            : null;
        return {
            ...baseDto(subscription),
            latestPosition: latest?.position ?? null,
            previousPosition: previous?.position ?? null,
            delta,
            lastCheckedAt: latest?.checkedAt.toISOString() ?? null,
        };
    });
    return {
        items,
        catalogs: APP_CHART_CATALOGS,
        limit: MAX_CHART_SUBSCRIPTIONS_PER_PROFILE,
        trackingEnabled: chartTrackingEnabled(),
    };
}
export async function deleteAppChartSubscription(input: {
    accountId: string;
    siteId: string;
    subscriptionId: string;
}): Promise<void> {
    const subscription = await requireOwnedSubscription(input.accountId, input.siteId, input.subscriptionId, true);
    await AppChartSubscription.deleteOne({ _id: subscription._id, accountId: input.accountId });
}
export function previewAppChartCheck(): SpendPreview {
    return { deploymentMode: 'community', capacityEnforced: false };
}
export async function recheckAppChartSubscription(input: {
    accountId: string;
    siteId: string;
    subscriptionId: string;
    confirm: boolean;
}, db: ApplicationDb) {
    requireChartTrackingEnabled();
    const subscription = await requireOwnedSubscription(input.accountId, input.siteId, input.subscriptionId, !input.confirm);
    const preview = previewAppChartCheck();
    if (!input.confirm)
        return { preview, queued: false, reservationStamp: null };
    const queue = getAppSeoTrackingQueue();
    if (!queue)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    const reservationStamp = appKeywordIsoWeek(new Date());
    const profileId = String(subscription.profileId);
    const stored = await db
        .select({ id: appChartSnapshots.id })
        .from(appChartSnapshots)
        .where(and(eq(appChartSnapshots.accountId, input.accountId), eq(appChartSnapshots.siteId, input.siteId), eq(appChartSnapshots.profileId, profileId), eq(appChartSnapshots.store, subscription.store), eq(appChartSnapshots.chartId, subscription.chartId), eq(appChartSnapshots.categoryId, subscription.categoryId), eq(appChartSnapshots.checkedAt, appKeywordWeekStart(reservationStamp))))
        .limit(1);
    if (stored.length > 0)
        return { preview, queued: false, reservationStamp };
    await ensureWeeklyCheckJob(queue, appSeoChartJobId(input.subscriptionId, reservationStamp), () => enqueueAppSeoChartJob(queue, {
        accountId: input.accountId,
        siteId: input.siteId,
        profileId,
        subscriptionId: input.subscriptionId,
        reservationStamp,
        manual: true,
    }));
    return { preview, queued: true, reservationStamp };
}
export async function getAppChartHistory(input: {
    accountId: string;
    siteId: string;
    subscriptionId: string;
    limit: number;
}, db: ApplicationDb): Promise<AppChartHistoryPoint[]> {
    const subscription = await requireOwnedSubscription(input.accountId, input.siteId, input.subscriptionId, true);
    const rows = await db
        .select({ checkedAt: appChartSnapshots.checkedAt, position: appChartSnapshots.position })
        .from(appChartSnapshots)
        .where(and(eq(appChartSnapshots.accountId, input.accountId), eq(appChartSnapshots.siteId, input.siteId), eq(appChartSnapshots.profileId, String(subscription.profileId)), eq(appChartSnapshots.store, subscription.store), eq(appChartSnapshots.chartId, subscription.chartId), eq(appChartSnapshots.categoryId, subscription.categoryId)))
        .orderBy(desc(appChartSnapshots.checkedAt))
        .limit(input.limit);
    return rows.reverse().map((row) => ({
        checkedAt: row.checkedAt.toISOString(),
        position: row.position,
    }));
}
export const appChartServiceTestables = Object.freeze({
    chartTrackingEnabled,
    requireChartTrackingEnabled,
    requireOwnedProfile,
    requireOwnedSubscription,
    targetAppId,
    isMongoDuplicateError,
    nextAvailableChartSlot,
    snapshotKey,
});
