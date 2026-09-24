import { UnrecoverableError, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { appKeywords, appRankSnapshots } from '../../db/schema/index.js';
import { captureVendorCost, ProviderError, type AppDataProvider, type AppStoreKind, } from '../../shared/providers/index.js';
import { appSeoTrackingJobSchema, parseConsumedPayload, } from '../../shared/queue/payloads.js';
import type { VendorArchiver } from '../../shared/vendor-cache/index.js';
import { Site } from '../sites/index.js';
import { AppProfile } from './app-profile.model.js';
import { appKeywordWeekStart } from './weekly-checks.js';
export interface AppKeywordProcessorDeps {
    db: ApplicationDb;
    provider: Pick<AppDataProvider, 'searchApps'>;
    logger: Pick<Logger, 'error'>;
    now?: () => Date;
    /** The concrete App Data adapter receives this timing seam at composition. */
    pollDelay?: (milliseconds: number) => Promise<void>;
    archive?: VendorArchiver;
}
export interface AppKeywordProcessorOutcome {
    keywordId: string;
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
export function createAppKeywordProcessor(deps: AppKeywordProcessorDeps) {
    return async (job: Pick<Job, 'data'>): Promise<AppKeywordProcessorOutcome> => {
        const payload = parseConsumedPayload(appSeoTrackingJobSchema, job.data);
        const keywordRows = await deps.db
            .select()
            .from(appKeywords)
            .where(and(eq(appKeywords.id, payload.keywordId), eq(appKeywords.accountId, payload.accountId), eq(appKeywords.siteId, payload.siteId), eq(appKeywords.profileId, payload.profileId), eq(appKeywords.active, true)))
            .limit(1);
        const keyword = keywordRows[0];
        if (!keyword)
            throw new UnrecoverableError('tracked app keyword not found');
        const site = await Site.findOne({
            _id: payload.siteId,
            accountId: payload.accountId,
            deletionStartedAt: null,
        }).select({ _id: 1, paused: 1 });
        if (!site || site.paused === true) {
            return { keywordId: payload.keywordId, status: 'skipped', position: null };
        }
        const profile = await AppProfile.findOne({
            _id: payload.profileId,
            accountId: payload.accountId,
            siteId: payload.siteId,
        }).select({ playPackageId: 1, appStoreId: 1 });
        if (!profile)
            throw new UnrecoverableError('app profile not found');
        const targetId = keyword.store === 'google_play'
            ? profile.playPackageId
            : profile.appStoreId;
        if (!targetId)
            throw new UnrecoverableError('app profile has no id for tracked store');
        const checkedAt = appKeywordWeekStart(payload.reservationStamp);
        const existing = await deps.db
            .select({ position: appRankSnapshots.position })
            .from(appRankSnapshots)
            .where(and(eq(appRankSnapshots.accountId, payload.accountId), eq(appRankSnapshots.siteId, payload.siteId), eq(appRankSnapshots.keywordId, payload.keywordId), eq(appRankSnapshots.checkedAt, checkedAt)))
            .limit(1);
        if (existing[0]) {
            return {
                keywordId: payload.keywordId,
                status: 'already_stored',
                position: existing[0].position,
            };
        }
        try {
            // `searchApps` is the task-backed provider method: its concrete adapter
            // submits standard-priority work and performs bounded `in_queue` polls.
            const captured = await captureVendorCost(() => deps.provider.searchApps({
                store: keyword.store,
                keyword: keyword.phrase,
                locationCode: keyword.locationCode,
                languageCode: keyword.languageCode,
                depth: keyword.store === 'google_play' ? 30 : 100,
            }));
            const target = normalizeStoreId(keyword.store, targetId);
            const match = captured.value.rows.find((row) => normalizeStoreId(keyword.store, row.appId) === target);
            if (deps.archive) {
                const { keyword: _privatePhrase, ...safePayload } = captured.value;
                await deps.archive({
                    // The shipped vendor-cost dimension predates `appData`; the
                    // operation keeps ASO costs distinct without a schema migration.
                    capability: 'keyword',
                    operation: 'app-data-search-apps',
                    params: {
                        keywordId: keyword.id,
                        store: keyword.store,
                        locationCode: keyword.locationCode,
                        languageCode: keyword.languageCode,
                    },
                    payload: safePayload,
                    accountId: payload.accountId,
                    siteId: payload.siteId,
                    costMicros: captured.costMicros,
                    fetchedAt: processorNow(deps.now),
                });
            }
            await deps.db
                .insert(appRankSnapshots)
                .values({
                accountId: payload.accountId,
                siteId: payload.siteId,
                keywordId: payload.keywordId,
                position: match?.position ?? null,
                rankAbsolute: match?.absolutePosition ?? null,
                foundAppId: match?.appId ?? null,
                checkedAt,
                observationMeta: captured.value.observationMeta,
            })
                .onConflictDoNothing({
                target: [appRankSnapshots.keywordId, appRankSnapshots.checkedAt],
            });
            return {
                keywordId: payload.keywordId,
                status: 'stored',
                position: match?.position ?? null,
            };
        }
        catch (error) {
            if (error instanceof ProviderError && !error.retryable) {
                throw new UnrecoverableError(`non-retryable app data failure: ${error.operation}`);
            }
            throw error;
        }
    };
}
export const appKeywordProcessorTestables = Object.freeze({
    normalizeStoreId,
    processorNow,
});
