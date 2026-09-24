import type { Job } from 'bullmq';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { buildObservationMeta } from '../../shared/observations/observations.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import { captureVendorCost, type AppDataProvider, type AppReview, } from '../../shared/providers/index.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import { appSeoReviewJobSchema, parseConsumedPayload, } from '../../shared/queue/index.js';
import { Site } from '../sites/index.js';
import { AppProfile } from './app-profile.model.js';
import { AppReviewRun, APP_REVIEW_CLUSTER_MIN_REVIEWS, APP_REVIEW_RUN_MAX_REVIEWS, } from './reviews.model.js';
export const APP_REVIEW_CLUSTER_PROFILE_NAME = 'app_review_clusters' as const;
interface StoredReview {
    id: string;
    rating: number;
    title: string | null;
    text: string;
    authorName: string | null;
    at: Date | null;
}
export interface AppReviewDeterministicStats {
    total: number;
    averageRating: number | null;
    histogram: Array<{
        star: number;
        count: number;
    }>;
    ratingMix: {
        positive: number;
        neutral: number;
        negative: number;
    };
    volumeTrend: Array<{
        period: string;
        count: number;
        averageRating: number;
    }>;
}
interface GeneratedCluster {
    label: string;
    sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
    citedReviewIds: string[];
    quotes: Array<{
        reviewId: string;
        quote: string;
    }>;
}
interface GeneratedClusters {
    clusters: GeneratedCluster[];
    citations: string[];
}
export interface AppReviewProcessorDeps {
    provider: Pick<AppDataProvider, 'getAppReviews'>;
    ai: Pick<AiProfileRunner, 'run'>;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    now?: () => Date;
}
export interface AppReviewProcessorOutcome {
    runId: string;
    status: 'completed' | 'failed' | 'already_terminal';
    reviewCount: number;
    clusterCount: number;
}
function clampText(value: string, maximum: number): string {
    return value.length <= maximum ? value : value.slice(0, maximum);
}
function processorNow(now?: () => Date): Date {
    return now ? now() : new Date();
}
export function normalizeAppReviews(rows: readonly AppReview[]): StoredReview[] {
    return rows.slice(0, APP_REVIEW_RUN_MAX_REVIEWS).map((review, index) => ({
        id: `review-${String(index + 1).padStart(3, '0')}`,
        rating: Math.max(0, Math.min(5, review.rating)),
        title: review.title === null ? null : clampText(review.title, 700),
        text: clampText(review.text, 20000),
        authorName: review.authorDisplayName === null
            ? null
            : clampText(review.authorDisplayName, 300),
        at: review.reviewedAt === null ? null : new Date(review.reviewedAt),
    }));
}
export function computeAppReviewStats(reviews: readonly Pick<StoredReview, 'rating' | 'at'>[]): AppReviewDeterministicStats {
    const histogram = [1, 2, 3, 4, 5].map((star) => ({ star, count: 0 }));
    const trend = new Map<string, {
        count: number;
        ratingSum: number;
    }>();
    let ratingSum = 0;
    let positive = 0;
    let neutral = 0;
    let negative = 0;
    for (const review of reviews) {
        const star = Math.max(1, Math.min(5, Math.round(review.rating)));
        histogram[star - 1]!.count += 1;
        ratingSum += review.rating;
        if (review.rating >= 4)
            positive += 1;
        else if (review.rating >= 3)
            neutral += 1;
        else
            negative += 1;
        if (review.at && !Number.isNaN(review.at.getTime())) {
            const period = review.at.toISOString().slice(0, 7);
            const current = trend.get(period) ?? { count: 0, ratingSum: 0 };
            current.count += 1;
            current.ratingSum += review.rating;
            trend.set(period, current);
        }
    }
    return {
        total: reviews.length,
        averageRating: reviews.length === 0
            ? null
            : Math.round((ratingSum / reviews.length) * 100) / 100,
        histogram,
        ratingMix: { positive, neutral, negative },
        volumeTrend: [...trend.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(-24)
            .map(([period, value]) => ({
            period,
            count: value.count,
            averageRating: Math.round((value.ratingSum / value.count) * 100) / 100,
        })),
    };
}
/**
 * Citation-and-quote boundary. A cluster survives only when every cited id
 * exists in the stored run and has a returned quote that is an exact substring
 * of that same review. Unknown ids, paraphrases, and under-cited clusters drop.
 */
export function enforceAppReviewClusters(generated: readonly GeneratedCluster[], reviews: readonly Pick<StoredReview, 'id' | 'text'>[], observationMeta: ObservationMeta) {
    const stored = new Map(reviews.map((review) => [review.id, review.text]));
    return generated.flatMap((cluster) => {
        const citedReviewIds = [...new Set(cluster.citedReviewIds)];
        if (citedReviewIds.length < 2 || citedReviewIds.some((id) => !stored.has(id)))
            return [];
        const validQuotes = new Map<string, string>();
        for (const candidate of cluster.quotes) {
            if (validQuotes.has(candidate.reviewId) || !citedReviewIds.includes(candidate.reviewId)) {
                continue;
            }
            const text = stored.get(candidate.reviewId);
            if (!text || !text.includes(candidate.quote))
                continue;
            validQuotes.set(candidate.reviewId, candidate.quote);
        }
        if (citedReviewIds.some((id) => !validQuotes.has(id)))
            return [];
        return [{
                label: cluster.label.trim(),
                sentiment: cluster.sentiment,
                citedReviewIds,
                quotes: citedReviewIds.map((reviewId) => ({
                    reviewId,
                    quote: validQuotes.get(reviewId)!,
                })),
                observationMeta,
            }];
    }).filter((cluster) => cluster.label.length > 0);
}
async function failBeforeEvidence(deps: AppReviewProcessorDeps, accountId: string, runId: string): Promise<AppReviewProcessorOutcome> {
    await AppReviewRun.updateOne({ _id: runId, accountId, status: { $in: ['queued', 'pulling'] } }, {
        $set: {
            status: 'failed',
            clusterState: 'unavailable',
            completedAt: processorNow(deps.now),
        },
    });
    return { runId, status: 'failed', reviewCount: 0, clusterCount: 0 };
}
export function createAppReviewProcessor(deps: AppReviewProcessorDeps) {
    const now = () => processorNow(deps.now);
    return async (job: Pick<Job, 'data'>): Promise<AppReviewProcessorOutcome> => {
        const payload = parseConsumedPayload(appSeoReviewJobSchema, job.data);
        let run = await AppReviewRun.findOne({
            _id: payload.runId,
            accountId: payload.accountId,
            siteId: payload.siteId,
            profileId: payload.profileId,
        });
        if (!run) {
            return { runId: payload.runId, status: 'already_terminal', reviewCount: 0, clusterCount: 0 };
        }
        if (run.status === 'completed' || run.status === 'failed') {
            return {
                runId: payload.runId,
                status: 'already_terminal',
                reviewCount: run.reviews.length,
                clusterCount: run.clusters.length,
            };
        }
        const hasRetainedEvidence = run.stats !== null && run.observationMeta !== null;
        if (!hasRetainedEvidence) {
            await AppReviewRun.updateOne({ _id: run._id, accountId: payload.accountId, status: 'queued' }, { $set: { status: 'pulling', startedAt: now() } });
            const site = await Site.findOne({
                _id: payload.siteId,
                accountId: payload.accountId,
                deletionStartedAt: null,
                paused: { $ne: true },
            }).select({ _id: 1 });
            const profile = await AppProfile.findOne({
                _id: payload.profileId,
                accountId: payload.accountId,
                siteId: payload.siteId,
            }).select({ playPackageId: 1, appStoreId: 1 });
            const appId = run.store === 'google_play'
                ? profile?.playPackageId
                : profile?.appStoreId;
            if (!site || !profile || !appId) {
                return failBeforeEvidence(deps, payload.accountId, payload.runId);
            }
            const requestStore = run.store;
            const requestLocationCode = run.locationCode;
            const requestLanguageCode = run.languageCode;
            let page;
            try {
                const captured = await captureVendorCost(() => deps.provider.getAppReviews({
                    store: requestStore,
                    appId,
                    locationCode: requestLocationCode,
                    languageCode: requestLanguageCode,
                    depth: APP_REVIEW_RUN_MAX_REVIEWS,
                }));
                page = captured.value;
            }
            catch {
                // No vendor evidence was retained, so the run fails outright.
                return failBeforeEvidence(deps, payload.accountId, payload.runId);
            }
            const reviews = normalizeAppReviews(page.rows);
            const stats = computeAppReviewStats(reviews);
            run = await AppReviewRun.findOneAndUpdate({
                _id: payload.runId,
                accountId: payload.accountId,
                status: { $in: ['queued', 'pulling'] },
            }, {
                $set: {
                    reviews,
                    stats,
                    observationMeta: page.observationMeta,
                    status: 'clustering',
                },
            }, { new: true, runValidators: true });
            if (!run) {
                return { runId: payload.runId, status: 'already_terminal', reviewCount: 0, clusterCount: 0 };
            }
        }
        if (run.reviews.length < APP_REVIEW_CLUSTER_MIN_REVIEWS) {
            await AppReviewRun.updateOne({ _id: payload.runId, accountId: payload.accountId, status: 'clustering' }, {
                $set: {
                    status: 'completed',
                    clusterState: 'thin_evidence',
                    clusters: [],
                    completedAt: now(),
                },
            });
            return {
                runId: payload.runId,
                status: 'completed',
                reviewCount: run.reviews.length,
                clusterCount: 0,
            };
        }
        const aiStartedAt = now();
        const claimed = await AppReviewRun.findOneAndUpdate({
            _id: payload.runId,
            accountId: payload.accountId,
            status: 'clustering',
            aiPassStartedAt: null,
        }, { $set: { aiPassStartedAt: aiStartedAt } }, { new: true });
        if (!claimed) {
            // An earlier attempt already dispatched the one allowed AI pass. Never
            // dispatch a second pass; settle the replay and keep the retained evidence.
            await AppReviewRun.updateOne({ _id: payload.runId, accountId: payload.accountId, status: 'clustering' }, { $set: { status: 'completed', clusterState: 'unavailable', completedAt: now() } });
            return {
                runId: payload.runId,
                status: 'completed',
                reviewCount: run.reviews.length,
                clusterCount: 0,
            };
        }
        let generated;
        try {
            generated = await deps.ai.run<GeneratedClusters>({
                profile: APP_REVIEW_CLUSTER_PROFILE_NAME,
                input: {
                    reviews: claimed.reviews.map((review) => ({
                        id: review.id,
                        rating: review.rating,
                        title: review.title ?? null,
                        text: review.text,
                        at: review.at?.toISOString() ?? null,
                    })),
                },
                locale: claimed.locale,
                correlationId: `app-review-clusters-${payload.runId}`,
                usage: {
                    accountId: payload.accountId,
                    siteId: payload.siteId,
                    jobId: payload.runId,
                },
                configuredProviderOrder: deps.aiProviderOrder,
            });
        }
        catch {
            await AppReviewRun.updateOne({ _id: payload.runId, accountId: payload.accountId, status: 'clustering' }, {
                $set: {
                    status: 'completed',
                    clusterState: 'unavailable',
                    clusters: [],
                    completedAt: now(),
                },
            });
            return {
                runId: payload.runId,
                status: 'completed',
                reviewCount: claimed.reviews.length,
                clusterCount: 0,
            };
        }
        const observedMarket = claimed.observationMeta?.market;
        const aiObservation = buildObservationMeta({
            sourceKind: 'ai_interpretation',
            sourceLabel: 'rankme_ai',
            observedAt: now(),
            market: observedMarket ? {
                country: observedMarket.country,
                region: observedMarket.region ?? null,
                city: observedMarket.city ?? null,
                language: observedMarket.language,
                device: observedMarket.device,
            } : null,
            sampleCount: claimed.reviews.length,
            coverageNoteKey: 'observations.coverage.aiInterpretation',
        });
        const clusters = enforceAppReviewClusters(generated.object.clusters, claimed.reviews, aiObservation);
        await AppReviewRun.updateOne({ _id: payload.runId, accountId: payload.accountId, status: 'clustering' }, {
            $set: {
                status: 'completed',
                clusterState: clusters.length > 0 ? 'available' : 'thin_evidence',
                clusters,
                aiCostMicros: Number(generated.provenance.actualOrEstimatedCostMicros),
                completedAt: now(),
            },
        }, { runValidators: true });
        return {
            runId: payload.runId,
            status: 'completed',
            reviewCount: claimed.reviews.length,
            clusterCount: clusters.length,
        };
    };
}
/** Unexpected terminal worker failure still settles the run to a terminal status. */
export async function onAppReviewJobExhausted(job: Pick<Job, 'data'> | undefined, deps: Pick<AppReviewProcessorDeps, 'now'> = {}): Promise<void> {
    if (!job)
        return;
    const parsed = appSeoReviewJobSchema.safeParse(job.data);
    if (!parsed.success)
        return;
    const payload = parsed.data;
    const run = await AppReviewRun.findOne({
        _id: payload.runId,
        accountId: payload.accountId,
        siteId: payload.siteId,
        profileId: payload.profileId,
    });
    if (!run || run.status === 'completed' || run.status === 'failed')
        return;
    const completedAt = processorNow(deps.now);
    if (run.stats !== null && run.observationMeta !== null) {
        await AppReviewRun.updateOne({ _id: payload.runId, accountId: payload.accountId }, {
            $set: {
                status: 'completed',
                clusterState: 'unavailable',
                completedAt,
            },
        });
        return;
    }
    await AppReviewRun.updateOne({ _id: payload.runId, accountId: payload.accountId }, {
        $set: {
            status: 'failed',
            clusterState: 'unavailable',
            completedAt,
        },
    });
}
export const appReviewProcessorTestables = Object.freeze({
    clampText,
    processorNow,
    failBeforeEvidence,
});
