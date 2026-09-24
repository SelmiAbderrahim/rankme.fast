/**
 * Review Intelligence sync consumer.
 *
 * Fans out to at most three `ReviewsProvider.getReviews` calls — one per
 * requested source — and books each independently:
 *
 *   provider threw a terminal VendorError   → `failed`
 *   returned rows, all already stored       → `zeroNew`
 *   returned at least one unseen row        → `ok`
 *
 * Dedupe is the `(profileId, source, sourceReviewId)` unique index. A rerun
 * re-fetches, collides, and appends nothing. Rows are ordered newest-first
 * before insert so a depth-truncated vendor page always contributes its most
 * recent reviews first.
 *
 * The run is settled exactly once (`settleReviewSyncRun` claims on
 * `status ∈ {queued, running}`).
 *
 * Review text never reaches a log line from this file.
 */
import { UnrecoverableError, type Job } from 'bullmq';
import { Types } from 'mongoose';
import type { Db } from '../../db/client.js';
import { ProviderError, captureVendorCost, type ReviewRow, type ReviewsResult, type ReviewsProvider, } from '../../shared/providers/index.js';
import { reviewSyncJobSchema, type ReviewSyncJob } from '../../shared/queue/index.js';
import { isSupportedLocale } from '../../shared/i18n/locales.js';
import { createVendorArchiver, createVendorCacheRepo } from '../../shared/vendor-cache/index.js';
import { LocalSeoReviewRow, LocalSeoReviewSyncRun, REVIEW_AUTHOR_MAX_CHARS, REVIEW_LANGUAGE_MAX_CHARS, REVIEW_SOURCE_ID_MAX_CHARS, REVIEW_TEXT_MAX_CHARS, REVIEW_TITLE_MAX_CHARS, type ReviewSourceName, } from './review-sync.model.js';
import { resolveConfiguredTargets, settleReviewSyncRun, type ReviewSourceSettlement, } from './review-sync.service.js';
import { runReviewThemesPass, type ReviewThemesDeps } from './review-themes.service.js';
export interface ReviewSyncProcessorDeps {
    db: Db;
    provider: ReviewsProvider;
    now?: () => Date;
    /**
     * Review-themes AI pass. Optional so the vendor-only pipeline stays testable
     * in isolation; the worker always supplies it. Without a runner the run
     * settles with `aiTerminalState: 'pending'` and a later replay picks the
     * theme pass up once a runner is configured.
     */
    ai?: ReviewThemesDeps['ai'];
    aiProviderOrder?: ReviewThemesDeps['aiProviderOrder'];
}
const EMAIL_PATTERN = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[A-Za-z]{2,}/g;
function clamp(value: string, max: number): string {
    const codePoints = [...value];
    return codePoints.length > max ? codePoints.slice(0, max).join('') : value;
}
/**
 * Defence in depth over the provider normalization: re-clamp every
 * bounded field and re-mask in-body emails before anything is persisted. A
 * future adapter that forgets a bound cannot widen what we store.
 */
export function normalizeReviewRow(row: ReviewRow): {
    rating: number | null;
    title: string | null;
    text: string;
    authorDisplayName: string | null;
    language: string | null;
    reviewedAt: Date | null;
    sourceReviewId: string;
} {
    const reviewedAt = row.reviewedAt ? new Date(row.reviewedAt) : null;
    return {
        rating: row.rating === null || !Number.isFinite(row.rating)
            ? null
            : Math.min(5, Math.max(0, row.rating)),
        title: row.title === null ? null : clamp(row.title.replace(EMAIL_PATTERN, '[email]'), REVIEW_TITLE_MAX_CHARS),
        text: clamp(row.text.replace(EMAIL_PATTERN, '[email]'), REVIEW_TEXT_MAX_CHARS),
        authorDisplayName: row.authorDisplayName === null
            ? null
            : clamp(row.authorDisplayName.replace(EMAIL_PATTERN, '[email]'), REVIEW_AUTHOR_MAX_CHARS),
        language: row.language === null ? null : clamp(row.language, REVIEW_LANGUAGE_MAX_CHARS),
        reviewedAt: reviewedAt && !Number.isNaN(reviewedAt.getTime()) ? reviewedAt : null,
        sourceReviewId: clamp(row.sourceReviewId, REVIEW_SOURCE_ID_MAX_CHARS),
    };
}
/** Newest-first; rows with no `reviewedAt` sort last, then by source id. */
export function orderNewestFirst(rows: ReviewRow[]): ReviewRow[] {
    return [...rows].sort((left, right) => {
        const leftAt = left.reviewedAt ? Date.parse(left.reviewedAt) : Number.NaN;
        const rightAt = right.reviewedAt ? Date.parse(right.reviewedAt) : Number.NaN;
        const leftMissing = Number.isNaN(leftAt);
        const rightMissing = Number.isNaN(rightAt);
        if (leftMissing && rightMissing)
            return left.sourceReviewId.localeCompare(right.sourceReviewId);
        if (leftMissing)
            return 1;
        if (rightMissing)
            return -1;
        if (leftAt !== rightAt)
            return rightAt - leftAt;
        return left.sourceReviewId.localeCompare(right.sourceReviewId);
    });
}
interface PersistInput {
    accountId: string;
    profileId: string;
    runId: string;
    source: ReviewSourceName;
    rows: ReviewRow[];
    fetchedAt: Date;
}
/** Appends only previously-unseen rows; returns how many actually landed. */
export async function persistUnseenRows(input: PersistInput): Promise<number> {
    if (input.rows.length === 0)
        return 0;
    const ordered = orderNewestFirst(input.rows);
    const incomingIds = [...new Set(ordered.map((row) => row.sourceReviewId))];
    const existing = await LocalSeoReviewRow.find({
        profileId: input.profileId,
        source: input.source,
        sourceReviewId: { $in: incomingIds },
    }).select({ sourceReviewId: 1 });
    const seen = new Set(existing.map((doc) => doc.sourceReviewId));
    const documents = [];
    for (const row of ordered) {
        if (seen.has(row.sourceReviewId))
            continue;
        seen.add(row.sourceReviewId);
        documents.push({
            accountId: new Types.ObjectId(input.accountId),
            profileId: new Types.ObjectId(input.profileId),
            source: input.source,
            firstSeenRunId: new Types.ObjectId(input.runId),
            fetchedAt: input.fetchedAt,
            ...normalizeReviewRow(row),
        });
    }
    if (documents.length === 0)
        return 0;
    // `ordered: false` keeps a concurrent duplicate from aborting the batch;
    // the unique index remains the authority on what "unseen" means.
    const inserted = await LocalSeoReviewRow.insertMany(documents, {
        ordered: false,
        rawResult: true,
    }).catch((error: unknown) => {
        const bulkError = error as {
            code?: number;
            insertedDocs?: unknown[];
            writeErrors?: Array<{
                code?: number;
            }>;
        };
        const duplicateOnly = bulkError.code === 11000 ||
            (bulkError.writeErrors?.length !== undefined &&
                bulkError.writeErrors.length > 0 &&
                bulkError.writeErrors.every((writeError) => writeError.code === 11000));
        if (duplicateOnly && Array.isArray(bulkError.insertedDocs)) {
            return { insertedCount: bulkError.insertedDocs.length };
        }
        throw error;
    });
    const result = inserted as {
        insertedCount: number;
        mongoose?: {
            validationErrors?: unknown[];
        };
    };
    const validationError = result.mongoose?.validationErrors?.[0];
    if (validationError !== undefined)
        throw validationError;
    return result.insertedCount;
}
export function createReviewSyncProcessor(deps: ReviewSyncProcessorDeps) {
    const nowFn = deps.now ?? (() => new Date());
    const failInvalidLocaleJob = async (data: unknown): Promise<never> => {
        const candidate = data as Partial<Record<'accountId' | 'runId', unknown>> | null;
        if (candidate &&
            typeof candidate.accountId === 'string' &&
            typeof candidate.runId === 'string' &&
            Types.ObjectId.isValid(candidate.accountId) &&
            Types.ObjectId.isValid(candidate.runId)) {
            const completedAt = nowFn();
            await LocalSeoReviewSyncRun.updateOne({
                _id: candidate.runId,
                accountId: candidate.accountId,
                $or: [
                    { status: { $in: ['queued', 'running'] } },
                    {
                        status: { $in: ['succeeded', 'partial'] },
                        aiTerminalState: 'pending',
                    },
                ],
            }, {
                $set: {
                    status: 'failed',
                    aiTerminalState: 'ai-failed-reviews-intact',
                    aiCompletedAt: completedAt,
                    completedAt,
                },
            });
        }
        throw new UnrecoverableError('review-sync job has no valid frozen output locale');
    };
    /**
     * Bundled theme pass. Runs after the per-source outcomes are
     * recorded, only for a run that is not a total vendor failure and that has
     * review material behind it.
     */
    const runThemes = async (accountId: string, runId: string): Promise<void> => {
        if (!deps.ai || !deps.aiProviderOrder)
            return;
        await runReviewThemesPass({ accountId, runId }, { ai: deps.ai, aiProviderOrder: deps.aiProviderOrder });
    };
    return async (job: Job<ReviewSyncJob>): Promise<void> => {
        const parsed = reviewSyncJobSchema.safeParse(job.data);
        if (!parsed.success)
            return failInvalidLocaleJob(job.data);
        const data = parsed.data;
        const run = await LocalSeoReviewSyncRun.findOne({
            _id: data.runId,
            accountId: data.accountId,
        });
        // A replay after the run settled is a no-op for the vendor pipeline —
        // never a second fan-out. It DOES resume a theme
        // pass that a crash left at `pending` (the claim inside the pass keeps
        // that from double-dispatching).
        if (!run)
            return;
        if (['succeeded', 'partial', 'failed'].includes(run.status)) {
            if (run.status !== 'failed' && run.aiTerminalState === 'pending') {
                if (!isSupportedLocale(run.outputLocale) || run.outputLocale !== data.outputLocale) {
                    return failInvalidLocaleJob(data);
                }
                await runThemes(data.accountId, data.runId);
            }
            return;
        }
        if (!isSupportedLocale(run.outputLocale) || run.outputLocale !== data.outputLocale) {
            return failInvalidLocaleJob(data);
        }
        const accountId = String(run.accountId);
        const profileId = String(run.profileId);
        const sources = run.sources as ReviewSourceName[];
        const targets = await resolveConfiguredTargets(accountId, profileId, sources);
        run.status = 'running';
        await run.save();
        const archive = createVendorArchiver(createVendorCacheRepo(deps.db));
        const outcomes: ReviewSourceSettlement[] = [];
        for (const source of sources) {
            const fetchedAt = nowFn();
            // `targets` is complete — resolveConfiguredTargets throws on any gap.
            const target = targets[source]!;
            let captured: {
                value: ReviewsResult;
                costMicros: bigint | null;
            };
            try {
                captured = await captureVendorCost(() => deps.provider.getReviews({ source, target, depth: run.depth }));
            }
            catch (error) {
                // A terminal provider failure becomes a per-source outcome;
                // storage/archive/programming errors rethrow so BullMQ retries the
                // run instead of misclassifying an infrastructure fault as an
                // all-sources-failed run.
                if (!(error instanceof ProviderError))
                    throw error;
                outcomes.push({ source, outcome: 'failed', retained: 0, errorCode: error.name });
                continue;
            }
            // Save-everything: per-account archive row (public review listings are
            // still tied to one customer's configured business profile).
            await archive({
                // Reviews ride the existing `local-listings` capability slot —
                // they are a local-business signal, and the archive stays
                // per-account (never served cross-user).
                capability: 'local-listings',
                operation: `reviews-sync-${source}`,
                params: { source, target, depth: run.depth },
                payload: captured.value,
                accountId,
                costMicros: captured.costMicros,
                fetchedAt,
            });
            const retained = await persistUnseenRows({
                accountId,
                profileId,
                runId: data.runId,
                source,
                rows: captured.value.rows,
                fetchedAt,
            });
            outcomes.push({
                source,
                outcome: retained > 0 ? 'ok' : 'zeroNew',
                retained,
                errorCode: null,
            });
        }
        const settled = await settleReviewSyncRun({ accountId, runId: data.runId, outcomes, completedAt: nowFn() });
        // Every source failed → there is nothing to theme. Any other terminal
        // runs the bundled theme pass.
        if (settled.status !== 'failed') {
            await runThemes(accountId, data.runId);
        }
    };
}
