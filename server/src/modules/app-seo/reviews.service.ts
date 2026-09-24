import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import type { AppStoreKind } from '../../shared/providers/app-data.js';
import { enqueueAppSeoReviewJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
import { loadOwnedSite } from '../sites/sites.guard.js';
import { AppProfile } from './app-profile.model.js';
import { getAppSeoTrackingQueue } from './keywords.queue-holder.js';
import { AppReviewRun, type AppReviewRunDocument } from './reviews.model.js';
import type { AppReviewRunInput } from './reviews.schema.js';
const NOT_FOUND_KEY = 'appSeo.errors.notFound';
export interface AppReviewHistogramBucketDto {
    star: number;
    count: number;
}
export interface AppReviewTrendPointDto {
    period: string;
    count: number;
    averageRating: number;
}
export interface AppReviewStatsDto {
    total: number;
    averageRating: number | null;
    histogram: AppReviewHistogramBucketDto[];
    ratingMix: {
        positive: number;
        neutral: number;
        negative: number;
    };
    volumeTrend: AppReviewTrendPointDto[];
}
export interface AppReviewClusterCitationDto {
    reviewId: string;
    quote: string;
    authorName: string | null;
    rating: number;
    at: string | null;
}
export interface AppReviewClusterDto {
    label: string;
    sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
    citedReviewIds: string[];
    citations: AppReviewClusterCitationDto[];
    observationMeta: ObservationMeta;
}
export interface AppReviewRunListItemDto {
    id: string;
    profileId: string;
    store: AppStoreKind;
    status: 'queued' | 'pulling' | 'clustering' | 'completed' | 'failed';
    clusterState: 'pending' | 'available' | 'thin_evidence' | 'unavailable';
    reviewCount: number;
    averageRating: number | null;
    createdAt: string;
    completedAt: string | null;
}
export interface AppReviewRunDetailDto extends AppReviewRunListItemDto {
    locationCode: number;
    languageCode: string;
    stats: AppReviewStatsDto | null;
    clusters: AppReviewClusterDto[];
    observationMeta: ObservationMeta | null;
}
type ReviewRunWithId = AppReviewRunDocument & {
    _id: unknown;
};
function toListDto(run: ReviewRunWithId): AppReviewRunListItemDto {
    return {
        id: String(run._id),
        profileId: String(run.profileId),
        store: run.store,
        status: run.status,
        clusterState: run.clusterState,
        reviewCount: run.reviews.length,
        averageRating: run.stats?.averageRating ?? null,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
    };
}
function toStatsDto(run: ReviewRunWithId): AppReviewStatsDto | null {
    if (!run.stats)
        return null;
    const mix = run.stats.ratingMix;
    return {
        total: run.stats.total,
        averageRating: run.stats.averageRating ?? null,
        histogram: run.stats.histogram.map((bucket) => ({ star: bucket.star, count: bucket.count })),
        ratingMix: {
            positive: mix?.positive ?? 0,
            neutral: mix?.neutral ?? 0,
            negative: mix?.negative ?? 0,
        },
        volumeTrend: run.stats.volumeTrend.map((point) => ({
            period: point.period,
            count: point.count,
            averageRating: point.averageRating,
        })),
    };
}
function toDetailDto(run: ReviewRunWithId): AppReviewRunDetailDto {
    const reviews = new Map(run.reviews.map((review) => [review.id, review]));
    const clusters: AppReviewClusterDto[] = run.clusters.map((cluster) => ({
        label: cluster.label,
        sentiment: cluster.sentiment,
        citedReviewIds: [...cluster.citedReviewIds],
        citations: cluster.quotes.flatMap((quote) => {
            const review = reviews.get(quote.reviewId);
            if (!review)
                return [];
            return [{
                    reviewId: quote.reviewId,
                    quote: quote.quote,
                    authorName: review.authorName ?? null,
                    rating: review.rating,
                    at: review.at?.toISOString() ?? null,
                }];
        }),
        observationMeta: cluster.observationMeta as ObservationMeta,
    }));
    return {
        ...toListDto(run),
        locationCode: run.locationCode,
        languageCode: run.languageCode,
        stats: toStatsDto(run),
        clusters,
        observationMeta: run.observationMeta as ObservationMeta | null,
    };
}
function reviewsEnabled(): boolean {
    return env.APP_SEO_ENABLED && env.APP_REVIEWS_ENABLED;
}
function requireReviewsEnabled(): void {
    // A disabled spend surface is intentionally indistinguishable from an
    // absent route. Stored GETs do not call this gate and remain readable.
    if (!reviewsEnabled()) {
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    }
}
async function requireOwnedProfile(input: {
    accountId: string;
    siteId: string;
    profileId: string;
    store: AppStoreKind;
    allowPaused: boolean;
}) {
    await loadOwnedSite(input.accountId, input.siteId, { allowPaused: input.allowPaused });
    if (!Types.ObjectId.isValid(input.profileId))
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const profile = await AppProfile.findOne({
        _id: input.profileId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
    const appId = input.store === 'google_play'
        ? profile?.playPackageId
        : profile?.appStoreId;
    if (!profile || !appId)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return profile;
}
export function previewAppReviewRun(): SpendPreview {
    return { deploymentMode: 'community', capacityEnforced: false };
}
export async function createAppReviewRun(input: {
    accountId: string;
    siteId: string;
    run: AppReviewRunInput;
    locale: SupportedLocale;
}): Promise<{
    preview: SpendPreview;
    queued: boolean;
    run: AppReviewRunListItemDto | null;
}> {
    requireReviewsEnabled();
    await requireOwnedProfile({
        accountId: input.accountId,
        siteId: input.siteId,
        profileId: input.run.profileId,
        store: input.run.store,
        allowPaused: false,
    });
    const preview = previewAppReviewRun();
    if (!input.run.confirm)
        return { preview, queued: false, run: null };
    const runId = new Types.ObjectId().toHexString();
    const created = await AppReviewRun.create({
        _id: runId,
        accountId: input.accountId,
        siteId: input.siteId,
        profileId: input.run.profileId,
        store: input.run.store,
        locationCode: input.run.locationCode,
        languageCode: input.run.languageCode.toLocaleLowerCase(),
        locale: input.locale,
        status: 'queued',
    }) as ReviewRunWithId;
    const queue = getAppSeoTrackingQueue();
    if (!queue) {
        await AppReviewRun.updateOne({ _id: runId, accountId: input.accountId, status: 'queued' }, { $set: { status: 'failed', completedAt: new Date() } });
        throw HttpError.internal({ code: 'APP_SEO_ERRORS_PRODUCT_UNAVAILABLE', messageKey: 'appSeo.errors.productUnavailable' });
    }
    try {
        await enqueueAppSeoReviewJob(queue, {
            accountId: input.accountId,
            siteId: input.siteId,
            profileId: input.run.profileId,
            runId,
        });
    }
    catch (error) {
        await AppReviewRun.updateOne({ _id: runId, accountId: input.accountId, status: 'queued' }, { $set: { status: 'failed', completedAt: new Date() } });
        throw error;
    }
    return { preview, queued: true, run: toListDto(created) };
}
export async function listAppReviewRuns(input: {
    accountId: string;
    siteId: string;
    profileId?: string;
    store?: AppStoreKind;
    limit: number;
}) {
    await loadOwnedSite(input.accountId, input.siteId, { allowPaused: true });
    if (input.profileId && !Types.ObjectId.isValid(input.profileId)) {
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    }
    const scope = {
        accountId: input.accountId,
        siteId: input.siteId,
        ...(input.profileId ? { profileId: input.profileId } : {}),
        ...(input.store ? { store: input.store } : {}),
    };
    const runs = await AppReviewRun.find(scope).sort({ createdAt: -1, _id: -1 }).limit(input.limit);
    return {
        items: runs.map((run) => toListDto(run as ReviewRunWithId)),
        reviewsEnabled: reviewsEnabled(),
    };
}
export async function getAppReviewRun(input: {
    accountId: string;
    siteId: string;
    runId: string;
}): Promise<AppReviewRunDetailDto> {
    await loadOwnedSite(input.accountId, input.siteId, { allowPaused: true });
    if (!Types.ObjectId.isValid(input.runId))
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const run = await AppReviewRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
    if (!run)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return toDetailDto(run as ReviewRunWithId);
}
export const appReviewServiceTestables = Object.freeze({
    toListDto,
    toStatsDto,
    toDetailDto,
    reviewsEnabled,
    requireReviewsEnabled,
    requireOwnedProfile,
});
