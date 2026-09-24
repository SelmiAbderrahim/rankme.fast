import { UnrecoverableError, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { appChartSnapshots } from '../../db/schema/index.js';
import { captureVendorCost, ProviderError, type AppDataProvider, type AppStoreKind, } from '../../shared/providers/index.js';
import { appSeoChartJobSchema, parseConsumedPayload } from '../../shared/queue/payloads.js';
import type { VendorArchiver } from '../../shared/vendor-cache/index.js';
import { Site } from '../sites/index.js';
import { AppProfile } from './app-profile.model.js';
import { AppChartSubscription } from './charts.model.js';
import { appKeywordWeekStart } from './weekly-checks.js';
export interface AppChartProcessorDeps {
    db: ApplicationDb;
    provider: Pick<AppDataProvider, 'getTopChart'>;
    now?: () => Date;
    archive?: VendorArchiver;
}
export interface AppChartProcessorOutcome {
    subscriptionId: string;
    status: 'stored' | 'already_stored' | 'skipped';
    position: number | null;
}
function normalizeStoreId(store: AppStoreKind, value: string): string {
    const normalized = value.trim();
    return store === 'google_play' ? normalized.toLocaleLowerCase() : normalized;
}
function processorNow(now?: () => Date): Date {
    return now ? now() : new Date();
}
export function createAppChartProcessor(deps: AppChartProcessorDeps) {
    return async (job: Pick<Job, 'data'>): Promise<AppChartProcessorOutcome> => {
        const payload = parseConsumedPayload(appSeoChartJobSchema, job.data);
        const subscription = await AppChartSubscription.findOne({
            _id: payload.subscriptionId,
            accountId: payload.accountId,
            siteId: payload.siteId,
            profileId: payload.profileId,
        });
        if (!subscription)
            throw new UnrecoverableError('app chart subscription not found');
        const site = await Site.findOne({
            _id: payload.siteId,
            accountId: payload.accountId,
            deletionStartedAt: null,
        }).select({ _id: 1, paused: 1 });
        if (!site || site.paused === true) {
            return { subscriptionId: payload.subscriptionId, status: 'skipped', position: null };
        }
        const profile = await AppProfile.findOne({
            _id: payload.profileId,
            accountId: payload.accountId,
            siteId: payload.siteId,
        }).select({ playPackageId: 1, appStoreId: 1 });
        if (!profile)
            throw new UnrecoverableError('app profile not found');
        const targetId = subscription.store === 'google_play'
            ? profile.playPackageId
            : profile.appStoreId;
        if (!targetId)
            throw new UnrecoverableError('app profile has no id for subscribed store');
        const checkedAt = appKeywordWeekStart(payload.reservationStamp);
        const existing = await deps.db
            .select({ position: appChartSnapshots.position })
            .from(appChartSnapshots)
            .where(and(eq(appChartSnapshots.accountId, payload.accountId), eq(appChartSnapshots.siteId, payload.siteId), eq(appChartSnapshots.profileId, payload.profileId), eq(appChartSnapshots.store, subscription.store), eq(appChartSnapshots.chartId, subscription.chartId), eq(appChartSnapshots.categoryId, subscription.categoryId), eq(appChartSnapshots.checkedAt, checkedAt)))
            .limit(1);
        if (existing[0]) {
            return {
                subscriptionId: payload.subscriptionId,
                status: 'already_stored',
                position: existing[0].position,
            };
        }
        try {
            // Exactly one 100-row `app_list` page. There is no deeper crawl.
            const captured = await captureVendorCost(() => deps.provider.getTopChart({
                store: subscription.store,
                chartId: subscription.chartId,
                categoryId: subscription.categoryId,
                locationCode: subscription.locationCode,
                languageCode: subscription.languageCode,
                depth: 100,
            }));
            const target = normalizeStoreId(subscription.store, targetId);
            const match = captured.value.rows.find((row) => normalizeStoreId(subscription.store, row.appId) === target);
            if (deps.archive) {
                await deps.archive({
                    capability: 'keyword',
                    operation: 'app-data-top-chart',
                    params: {
                        subscriptionId: payload.subscriptionId,
                        store: subscription.store,
                        chartId: subscription.chartId,
                        categoryId: subscription.categoryId,
                        locationCode: subscription.locationCode,
                        languageCode: subscription.languageCode,
                        depth: 100,
                    },
                    payload: captured.value,
                    accountId: payload.accountId,
                    siteId: payload.siteId,
                    costMicros: captured.costMicros,
                    fetchedAt: processorNow(deps.now),
                });
            }
            await deps.db.insert(appChartSnapshots).values({
                accountId: payload.accountId,
                siteId: payload.siteId,
                profileId: payload.profileId,
                store: subscription.store,
                chartId: subscription.chartId,
                categoryId: subscription.categoryId,
                position: match?.position ?? null,
                checkedAt,
                observationMeta: captured.value.observationMeta,
            });
            // A null position is retained evidence: not in the bounded top 100.
            return {
                subscriptionId: payload.subscriptionId,
                status: 'stored',
                position: match?.position ?? null,
            };
        }
        catch (error) {
            if (error instanceof ProviderError && !error.retryable) {
                throw new UnrecoverableError(`non-retryable app chart failure: ${error.operation}`);
            }
            throw error;
        }
    };
}
export const appChartProcessorTestables = Object.freeze({
    normalizeStoreId,
    processorNow,
});
