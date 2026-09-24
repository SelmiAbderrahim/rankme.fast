import { UnrecoverableError, type Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { appKeywords, appListingSnapshots, } from '../../db/schema/index.js';
import { appInfoSchema, captureVendorCost, ProviderError, type AppDataProvider, type AppInfo, type AppStoreKind, } from '../../shared/providers/index.js';
import { appSeoListingJobSchema, parseConsumedPayload, } from '../../shared/queue/payloads.js';
import type { VendorArchiver } from '../../shared/vendor-cache/index.js';
import { Site } from '../sites/index.js';
import { AppProfile } from './app-profile.model.js';
import { APP_LISTING_ENGINE_VERSION, evaluateAppListing, listingEngineOutputSchema, } from './listing-rules/index.js';
const STORES: readonly AppStoreKind[] = ['google_play', 'app_store'];
export interface AppListingProcessorDeps {
    db: ApplicationDb;
    provider: Pick<AppDataProvider, 'getAppInfo'>;
    archive?: VendorArchiver;
    now?: () => Date;
}
function registeredStoreTargets(profile: {
    playPackageId?: string | null;
    appStoreId?: string | null;
}): Array<{
    store: AppStoreKind;
    appId: string;
}> {
    return STORES.flatMap((store) => {
        const appId = appIdFor(profile, store);
        return appId ? [{ store, appId }] : [];
    });
}
export interface AppListingProcessorOutcome {
    runId: string;
    status: 'stored' | 'partial' | 'already_stored' | 'skipped';
    storedStores: AppStoreKind[];
    failedStores: AppStoreKind[];
    engineVersion: typeof APP_LISTING_ENGINE_VERSION;
}
type AppListingJob = Pick<Job, 'data'>;
function appIdFor(profile: {
    playPackageId?: string | null;
    appStoreId?: string | null;
}, store: AppStoreKind): string | null {
    return store === 'google_play'
        ? profile.playPackageId ?? null
        : profile.appStoreId ?? null;
}
function normalizeAppId(store: AppStoreKind, appId: string): string {
    const normalized = appId.trim();
    return store === 'google_play' ? normalized.toLocaleLowerCase() : normalized;
}
function failureIsRetryable(error: unknown): boolean {
    if (error instanceof UnrecoverableError)
        return false;
    return !(error instanceof ProviderError) || error.retryable;
}
function permanentFailure(error: unknown): UnrecoverableError {
    if (error instanceof UnrecoverableError)
        return error;
    const operation = error instanceof ProviderError ? error.operation : 'app-data-info';
    return new UnrecoverableError(`non-retryable app listing failure: ${operation}`);
}
export function createAppListingProcessor(deps: AppListingProcessorDeps) {
    return async (job: AppListingJob): Promise<AppListingProcessorOutcome> => {
        const payload = parseConsumedPayload(appSeoListingJobSchema, job.data);
        const site = await Site.findOne({
            _id: payload.siteId,
            accountId: payload.accountId,
            deletionStartedAt: null,
        }).select({ _id: 1, paused: 1 });
        if (!site || site.paused === true) {
            return {
                runId: payload.runId,
                status: 'skipped',
                storedStores: [],
                failedStores: [],
                engineVersion: APP_LISTING_ENGINE_VERSION,
            };
        }
        const profile = await AppProfile.findOne({
            _id: payload.profileId,
            accountId: payload.accountId,
            siteId: payload.siteId,
        }).select({ paired: 1, playPackageId: 1, appStoreId: 1 });
        if (!profile)
            throw new UnrecoverableError('app listing profile not found');
        const registeredTargets = registeredStoreTargets(profile);
        if (registeredTargets.length === 0) {
            throw new UnrecoverableError('app listing profile has no registered stores');
        }
        const capturedAt = new Date(payload.capturedAt);
        const scope = and(eq(appListingSnapshots.accountId, payload.accountId), eq(appListingSnapshots.siteId, payload.siteId), eq(appListingSnapshots.profileId, payload.profileId), eq(appListingSnapshots.capturedAt, capturedAt));
        const existingRows = await deps.db
            .select()
            .from(appListingSnapshots)
            .where(scope);
        const byStore: Record<AppStoreKind, AppInfo | null> = {
            google_play: null,
            app_store: null,
        };
        for (const row of existingRows) {
            const listing = appInfoSchema.parse(row.listing);
            listingEngineOutputSchema.parse(row.findings);
            if (listing.store !== row.store) {
                throw new UnrecoverableError('stored app listing scope does not match its payload');
            }
            byStore[row.store] = listing;
        }
        const newlyCaptured = new Map<AppStoreKind, AppInfo>();
        const failures: Array<{
            store: AppStoreKind;
            error: unknown;
        }> = [];
        for (const { store, appId } of registeredTargets) {
            if (byStore[store])
                continue;
            try {
                const captured = await captureVendorCost(() => deps.provider.getAppInfo({
                    store,
                    appId,
                    locationCode: payload.locationCode,
                    languageCode: payload.languageCode,
                }));
                const listing = appInfoSchema.parse(captured.value);
                if (listing.store !== store
                    || normalizeAppId(store, listing.appId) !== normalizeAppId(store, appId)) {
                    throw new UnrecoverableError('app listing provider returned the wrong store identity');
                }
                if (deps.archive) {
                    await deps.archive({
                        capability: 'keyword',
                        operation: 'app-data-info',
                        params: {
                            profileId: payload.profileId,
                            store,
                            locationCode: payload.locationCode,
                            languageCode: payload.languageCode,
                        },
                        payload: listing,
                        accountId: payload.accountId,
                        siteId: payload.siteId,
                        costMicros: captured.costMicros,
                        fetchedAt: deps.now?.() ?? new Date(),
                    });
                }
                byStore[store] = listing;
                newlyCaptured.set(store, listing);
            }
            catch (error) {
                failures.push({ store, error });
            }
        }
        const phraseRows = await deps.db
            .select({ phrase: appKeywords.phrase })
            .from(appKeywords)
            .where(and(eq(appKeywords.accountId, payload.accountId), eq(appKeywords.siteId, payload.siteId), eq(appKeywords.profileId, payload.profileId), eq(appKeywords.active, true)));
        const trackedPhrases = [...new Set(phraseRows.map((row) => row.phrase.trim()))]
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right));
        const findings = evaluateAppListing({
            profile: {
                paired: profile.paired,
                playPackageId: profile.playPackageId ?? null,
                appStoreId: profile.appStoreId ?? null,
            },
            byStore,
            trackedPhrases,
        });
        if (newlyCaptured.size > 0 || existingRows.length > 0) {
            await deps.db.transaction(async (tx) => {
                const values = [...newlyCaptured.values()].map((listing) => ({
                    accountId: payload.accountId,
                    siteId: payload.siteId,
                    profileId: payload.profileId,
                    store: listing.store,
                    capturedAt,
                    listing,
                    findings,
                    observationMeta: listing.observationMeta,
                }));
                if (values.length > 0) {
                    await tx.insert(appListingSnapshots).values(values);
                }
                await tx
                    .update(appListingSnapshots)
                    .set({ findings })
                    .where(scope);
            });
        }
        const storedStores = registeredTargets
            .map(({ store }) => store)
            .filter((store) => byStore[store] !== null);
        const failedStores = failures.map((failure) => failure.store);
        if (failures.length === 0) {
            return {
                runId: payload.runId,
                status: newlyCaptured.size === 0 ? 'already_stored' : 'stored',
                storedStores,
                failedStores,
                engineVersion: findings.engineVersion,
            };
        }
        if (failures.some((failure) => failureIsRetryable(failure.error))) {
            throw failures.find((failure) => failureIsRetryable(failure.error))?.error;
        }
        if (storedStores.length > 0) {
            // Partial evidence is kept. The failed store remains an explicit
            // not-observed note and no defect is inferred for its missing fields.
            return {
                runId: payload.runId,
                status: 'partial',
                storedStores,
                failedStores,
                engineVersion: findings.engineVersion,
            };
        }
        throw permanentFailure(failures[0]?.error);
    };
}
export const appListingProcessorTestables = Object.freeze({
    appIdFor,
    normalizeAppId,
    registeredStoreTargets,
    failureIsRetryable,
    permanentFailure,
});
