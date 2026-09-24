import { and, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { competitorProfiles, landscapePageMatchReviews, type LandscapePageMatchReviewRow, } from '../../../db/schema/index.js';
import { fetchPublicUrlSafeWithFinalUrl, type FetchPublicUrlSafeOptions, } from '../../../shared/security/index.js';
import { HttpError } from '../../../shared/utils/http-error.js';
import { Site } from '../../sites/index.js';
import { registrableDomainKey } from '../../competitor-content/index.js';
import { CompetitorLandscapeReportPage, CompetitorLandscapeRun, } from './landscape.model.js';
import { landscapeReportManifestSchema, type LandscapeReportManifest, } from './landscape.schemas.js';
export interface PublicPageMatchReview {
    state: 'unreviewed' | 'approved' | 'rejected';
    ownedUrl: string | null;
    competitorUrl: string | null;
    version: number;
    reviewedAt: string | null;
}
export interface ReviewPageMatchInput {
    accountId: string;
    siteId: string;
    reportId: string;
    suggestionId: string;
    reviewedByUserId: string;
    idempotencyKey: string;
    decision: 'approved' | 'rejected';
    ownedUrl: string | null;
    competitorUrl: string | null;
    version: number;
}
export type ReviewedUrlAuthority = (url: string) => Promise<URL>;
export interface ReviewPageMatchDeps {
    db: ApplicationDb;
    validateUrl?: ReviewedUrlAuthority;
    fetchOptions?: FetchPublicUrlSafeOptions;
    /** Deterministic concurrency seam used to verify optimistic-write races. */
    beforeWrite?: () => Promise<void>;
}
function publicReview(row: LandscapePageMatchReviewRow): PublicPageMatchReview {
    return {
        state: row.decision,
        ownedUrl: row.ownedUrl,
        competitorUrl: row.competitorUrl,
        version: row.version,
        reviewedAt: row.reviewedAt.toISOString(),
    };
}
export const UNREVIEWED_PAGE_MATCH: PublicPageMatchReview = {
    state: 'unreviewed',
    ownedUrl: null,
    competitorUrl: null,
    version: 0,
    reviewedAt: null,
};
function boundedReviewedFetchOptions(fetchOptions: FetchPublicUrlSafeOptions = {}): FetchPublicUrlSafeOptions {
    return {
        ...fetchOptions,
        maxRedirects: Math.min(fetchOptions.maxRedirects ?? 3, 3),
        deadlineMs: Math.min(fetchOptions.deadlineMs ?? 10000, 10000),
        maxResponseBytes: Math.min(fetchOptions.maxResponseBytes ?? 1024, 1024),
    };
}
async function defaultReviewedUrlAuthority(rawUrl: string, fetchOptions?: FetchPublicUrlSafeOptions): Promise<URL> {
    const result = await fetchPublicUrlSafeWithFinalUrl(rawUrl, { method: 'HEAD' }, boundedReviewedFetchOptions(fetchOptions));
    return result.finalUrl;
}
function sameRegistrableDomain(url: URL, expectedDomain: string): boolean {
    return registrableDomainKey(url.hostname) === registrableDomainKey(expectedDomain);
}
function sameOrigin(url: URL, expectedUrl: string): boolean {
    return url.origin === new URL(expectedUrl).origin;
}
function idempotencyValid(value: string): boolean {
    return value.length >= 1 && value.length <= 128 && /^[\x21-\x7e]+$/.test(value);
}
async function findByIdempotency(db: ApplicationDb, accountId: string, idempotencyKey: string) {
    const rows = await db
        .select()
        .from(landscapePageMatchReviews)
        .where(and(eq(landscapePageMatchReviews.accountId, accountId), eq(landscapePageMatchReviews.idempotencyKey, idempotencyKey)))
        .limit(1);
    return rows[0] ?? null;
}
async function findReview(db: ApplicationDb, input: Pick<ReviewPageMatchInput, 'accountId' | 'reportId' | 'suggestionId'>) {
    const rows = await db
        .select()
        .from(landscapePageMatchReviews)
        .where(and(eq(landscapePageMatchReviews.accountId, input.accountId), eq(landscapePageMatchReviews.reportId, input.reportId), eq(landscapePageMatchReviews.suggestionId, input.suggestionId)))
        .limit(1);
    return rows[0] ?? null;
}
function sameReview(row: LandscapePageMatchReviewRow, input: ReviewPageMatchInput): boolean {
    return (row.siteId === input.siteId &&
        row.reportId === input.reportId &&
        row.suggestionId === input.suggestionId &&
        row.decision === input.decision &&
        row.ownedUrl === input.ownedUrl &&
        row.competitorUrl === input.competitorUrl);
}
/** Review/override one immutable ranking-page suggestion. This performs no crawl. */
export async function reviewLandscapePageMatch(input: ReviewPageMatchInput, deps: ReviewPageMatchDeps): Promise<{
    review: PublicPageMatchReview;
    replayed: boolean;
}> {
    if (!Types.ObjectId.isValid(input.siteId) || !Types.ObjectId.isValid(input.reportId)) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    }
    if (!idempotencyValid(input.idempotencyKey)) {
        throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_IDEMPOTENCY_INVALID', messageKey: 'competitors.landscape.errors.idempotencyInvalid' });
    }
    if (!Number.isInteger(input.version) ||
        input.version < 0 ||
        (input.decision === 'approved' && (!input.ownedUrl || !input.competitorUrl)) ||
        (input.decision === 'rejected' && (input.ownedUrl !== null || input.competitorUrl !== null))) {
        throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_PAGE_MATCH_INVALID', messageKey: 'competitors.landscape.errors.pageMatchInvalid' });
    }
    const [site, run] = await Promise.all([
        Site.findOne({
            _id: input.siteId,
            accountId: input.accountId,
            deletionStartedAt: null,
        }).lean(),
        CompetitorLandscapeRun.findOne({
            _id: input.reportId,
            accountId: input.accountId,
            siteId: input.siteId,
            state: { $in: ['completed', 'partial'] },
        }).lean(),
    ]);
    if (!site || !run?.reportManifest) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    }
    const manifest = landscapeReportManifestSchema.parse(run.reportManifest);
    const suggestion = manifest.pageSuggestions.find((candidate) => candidate.id === input.suggestionId);
    if (!suggestion) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_PAGE_MATCH_NOT_FOUND', messageKey: 'competitors.landscape.errors.pageMatchNotFound' });
    }
    const frozenProfile = run.competitors.find((candidate) => candidate.profileId === suggestion.competitorProfileId);
    if (!frozenProfile) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_PAGE_MATCH_NOT_FOUND', messageKey: 'competitors.landscape.errors.pageMatchNotFound' });
    }
    const profiles = await deps.db
        .select()
        .from(competitorProfiles)
        .where(and(eq(competitorProfiles.id, suggestion.competitorProfileId), eq(competitorProfiles.accountId, input.accountId), eq(competitorProfiles.siteId, input.siteId), eq(competitorProfiles.status, 'active')))
        .limit(1);
    const profile = profiles[0];
    if (!profile || profile.registrableDomain !== frozenProfile.domain) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_PROFILE_INACTIVE', messageKey: 'competitors.landscape.errors.profileInactive' });
    }
    const idempotent = await findByIdempotency(deps.db, input.accountId, input.idempotencyKey);
    if (idempotent) {
        if (!sameReview(idempotent, input)) {
            throw HttpError.conflict({ code: 'ACTIONS_ERRORS_IDEMPOTENCY_MISMATCH', messageKey: 'actions.errors.idempotencyMismatch' });
        }
        return { review: publicReview(idempotent), replayed: true };
    }
    let ownedUrl: string | null = null;
    let competitorUrl: string | null = null;
    if (input.decision === 'approved') {
        const validate = deps.validateUrl ?? ((url) => defaultReviewedUrlAuthority(url, deps.fetchOptions));
        let ownedSafe: URL;
        let competitorSafe: URL;
        try {
            [ownedSafe, competitorSafe] = await Promise.all([
                validate(input.ownedUrl!),
                validate(input.competitorUrl!),
            ]);
        }
        catch {
            throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_PAGE_MATCH_UNSAFE', messageKey: 'competitors.landscape.errors.pageMatchUnsafe' });
        }
        if (!sameOrigin(ownedSafe, site.url)) {
            throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_OWNED_URL_OFF_ORIGIN', messageKey: 'competitors.landscape.errors.ownedUrlOffOrigin' });
        }
        if (!sameRegistrableDomain(competitorSafe, profile.registrableDomain)) {
            throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_COMPETITOR_URL_OFF_DOMAIN', messageKey: 'competitors.landscape.errors.competitorUrlOffDomain' });
        }
        ownedUrl = ownedSafe.toString();
        competitorUrl = competitorSafe.toString();
    }
    const existing = await findReview(deps.db, input);
    if ((existing?.version ?? 0) !== input.version) {
        throw HttpError.conflict({ code: 'COMPETITORS_LANDSCAPE_ERRORS_PAGE_MATCH_VERSION_CONFLICT', messageKey: 'competitors.landscape.errors.pageMatchVersionConflict' });
    }
    await deps.beforeWrite?.();
    const reviewedAt = new Date();
    if (existing) {
        const updated = await deps.db
            .update(landscapePageMatchReviews)
            .set({
            decision: input.decision,
            ownedUrl,
            competitorUrl,
            reviewedByUserId: input.reviewedByUserId,
            idempotencyKey: input.idempotencyKey,
            version: existing.version + 1,
            reviewedAt,
        })
            .where(and(eq(landscapePageMatchReviews.id, existing.id), eq(landscapePageMatchReviews.version, input.version)))
            .returning();
        if (!updated[0]) {
            throw HttpError.conflict({ code: 'COMPETITORS_LANDSCAPE_ERRORS_PAGE_MATCH_VERSION_CONFLICT', messageKey: 'competitors.landscape.errors.pageMatchVersionConflict' });
        }
        return { review: publicReview(updated[0]), replayed: false };
    }
    try {
        const inserted = await deps.db
            .insert(landscapePageMatchReviews)
            .values({
            accountId: input.accountId,
            siteId: input.siteId,
            reportId: input.reportId,
            suggestionId: input.suggestionId,
            competitorProfileId: suggestion.competitorProfileId,
            decision: input.decision,
            ownedUrl,
            competitorUrl,
            reviewedByUserId: input.reviewedByUserId,
            idempotencyKey: input.idempotencyKey,
            version: 1,
            reviewedAt,
        })
            .returning();
        return { review: publicReview(inserted[0]!), replayed: false };
    }
    catch (error) {
        const raced = await findReview(deps.db, input);
        if (raced && sameReview(raced, { ...input, ownedUrl, competitorUrl })) {
            return { review: publicReview(raced), replayed: true };
        }
        throw error;
    }
}
export async function listLandscapePageMatchReviews(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    reportId: string;
}): Promise<LandscapePageMatchReviewRow[]> {
    return db
        .select()
        .from(landscapePageMatchReviews)
        .where(and(eq(landscapePageMatchReviews.accountId, input.accountId), eq(landscapePageMatchReviews.siteId, input.siteId), eq(landscapePageMatchReviews.reportId, input.reportId)));
}
export async function overlayLandscapePageMatchReviews(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    reportId: string;
    manifest: LandscapeReportManifest;
}) {
    const rows = await listLandscapePageMatchReviews(db, input);
    const reviews = new Map(rows.map((row) => [row.suggestionId, publicReview(row)]));
    return {
        ...input.manifest,
        pageSuggestions: input.manifest.pageSuggestions.map((suggestion) => ({
            ...suggestion,
            review: reviews.get(suggestion.id) ?? UNREVIEWED_PAGE_MATCH,
        })),
    };
}
export interface FrozenReviewedPageMatch {
    landscapeReportId: string;
    landscapeOpportunityId: string | null;
    suggestionId: string;
    competitorProfileId: string;
    suggestedUrl: string;
    selectedUrl: string;
    ownedUrl: string;
    keywordEvidence: Array<{
        keyword: string;
        class: 'missing' | 'owned_only' | 'shared_behind' | 'shared_ahead' | 'shared_even' | null;
        ownedPosition: number | null;
        competitorPosition: number | null;
        ownedUrl: string | null;
        competitorUrl: string | null;
        searchVolume: number | null;
        intent: 'informational' | 'navigational' | 'commercial' | 'transactional' | null;
        provenanceIndexes: number[];
    }>;
}
function approvedReviewedPageMatch(suggestion: LandscapeReportManifest['pageSuggestions'][number] | undefined, review: LandscapePageMatchReviewRow | null) {
    if (!suggestion ||
        !review ||
        review.decision !== 'approved' ||
        !review.ownedUrl ||
        !review.competitorUrl) {
        return null;
    }
    return {
        suggestion,
        review: {
            ...review,
            ownedUrl: review.ownedUrl,
            competitorUrl: review.competitorUrl,
        },
    };
}
/** Resolve an approved review into the immutable, bounded content-run handoff. */
export async function loadFrozenReviewedPageMatch(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    reportId: string;
    suggestionId: string;
    opportunityId?: string | null;
}): Promise<FrozenReviewedPageMatch> {
    const detail = await CompetitorLandscapeRun.findOne({
        _id: input.reportId,
        accountId: input.accountId,
        siteId: input.siteId,
        state: { $in: ['completed', 'partial'] },
    }).lean();
    if (!detail?.reportManifest) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    }
    const manifest = landscapeReportManifestSchema.parse(detail.reportManifest);
    const suggestion = manifest.pageSuggestions.find((item) => item.id === input.suggestionId);
    const review = await findReview(db, {
        accountId: input.accountId,
        reportId: input.reportId,
        suggestionId: input.suggestionId,
    });
    const approved = approvedReviewedPageMatch(suggestion, review);
    if (!approved) {
        throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_PAGE_MATCH_NOT_APPROVED', messageKey: 'competitors.landscape.errors.pageMatchNotApproved' });
    }
    const approvedSuggestion = approved.suggestion;
    const approvedReview = approved.review;
    const frozenProfile = detail.competitors.find((candidate) => candidate.profileId === approvedSuggestion.competitorProfileId);
    const currentProfiles = await db
        .select()
        .from(competitorProfiles)
        .where(and(eq(competitorProfiles.id, approvedSuggestion.competitorProfileId), eq(competitorProfiles.accountId, input.accountId), eq(competitorProfiles.siteId, input.siteId), eq(competitorProfiles.status, 'active')))
        .limit(1);
    if (!frozenProfile || currentProfiles[0]?.registrableDomain !== frozenProfile.domain) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_PROFILE_INACTIVE', messageKey: 'competitors.landscape.errors.profileInactive' });
    }
    const opportunity = input.opportunityId
        ? manifest.opportunities.find((item) => item.id === input.opportunityId)
        : null;
    if (input.opportunityId && !opportunity) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_OPPORTUNITY_NOT_FOUND', messageKey: 'competitors.landscape.errors.opportunityNotFound' });
    }
    const rowPages = await CompetitorLandscapeReportPage.find({
        accountId: input.accountId,
        siteId: input.siteId,
        runId: input.reportId,
    }).lean();
    const rows = rowPages.flatMap((page) => page.rows).filter((row) => {
        const candidate = row as {
            competitorProfileId?: unknown;
            normalizedKeyword?: unknown;
        };
        return (candidate.competitorProfileId === approvedSuggestion.competitorProfileId &&
            typeof candidate.normalizedKeyword === 'string' &&
            approvedSuggestion.keywordKeys.includes(candidate.normalizedKeyword));
    }) as Array<{
        normalizedKeyword: string;
        class: FrozenReviewedPageMatch['keywordEvidence'][number]['class'];
        ownedPosition: number | null;
        competitorPosition: number | null;
        ownedUrl: string | null;
        competitorUrl: string | null;
        searchVolume: number | null;
        intent: FrozenReviewedPageMatch['keywordEvidence'][number]['intent'];
        provenanceIndexes: number[];
    }>;
    return {
        landscapeReportId: input.reportId,
        landscapeOpportunityId: opportunity?.id ?? null,
        suggestionId: approvedSuggestion.id,
        competitorProfileId: approvedSuggestion.competitorProfileId,
        suggestedUrl: approvedSuggestion.competitorUrl,
        selectedUrl: approvedReview.competitorUrl,
        ownedUrl: approvedReview.ownedUrl,
        keywordEvidence: approvedSuggestion.keywordKeys.map((keyword) => {
            const evidence = rows.find((row) => row.normalizedKeyword === keyword);
            return {
                keyword,
                class: evidence?.class ?? null,
                ownedPosition: evidence?.ownedPosition ?? null,
                competitorPosition: evidence?.competitorPosition ?? null,
                ownedUrl: evidence?.ownedUrl ?? null,
                competitorUrl: evidence?.competitorUrl ?? null,
                searchVolume: evidence?.searchVolume ?? null,
                intent: evidence?.intent ?? null,
                provenanceIndexes: evidence?.provenanceIndexes ?? [],
            };
        }),
    };
}
export const landscapeReviewTestables = Object.freeze({
    approvedReviewedPageMatch,
    boundedReviewedFetchOptions,
    defaultReviewedUrlAuthority,
    idempotencyValid,
    sameOrigin,
    sameRegistrableDomain,
    sameReview,
});
