/**
 * DataForSEO Local SEO adapter.
 *
 * Implements LocalListingsProvider over DataForSEO Business Data API:
 *   getBusinessListings       -> POST /business_data/business_listings/search/live
 *      Docs: Business Listings Search live returns `items[]` with business
 *      rows including `title`, `address`, and contact fields.
 *      https://docs.dataforseo.com/v3/business_data/business_listings/search/live/
 *   getReviews                -> POST /business_data/google/my_business_info/live
 *      Docs: Google My Business Info live exposes `rating.value` and
 *      `reviews_count`; the Google Reviews async task_get endpoint carries
 *      review bodies but the task_post response itself returns null results.
 *      https://docs.dataforseo.com/v3/business_data/google/my_business_info/live/
 *   getQuestionsAndAnswers    -> POST /business_data/google/questions_and_answers/live
 *      Docs: Google Q&A live returns question rows with nested `items[]`
 *      answers; missing answers are normalized as unanswered questions.
 *      https://docs.dataforseo.com/v3/business_data/google/questions_and_answers/live/
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { VendorMalformedError } from '../errors.js';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import type { BusinessListingRow, LocalListingsProvider, QaSummary, ReviewsSummary, } from '../types.js';
import { normalizeSerpDomain } from './serp.js';
export interface DataForSeoLocalListingsProviderConfig extends DataForSeoConfig {
    /** Default Google location for review/Q&A summary lookups. US = 2840. */
    locationCode?: number;
    /** Default Google language for review/Q&A summary lookups. */
    languageCode?: string;
    /** Max listing rows requested from Business Listings Search live. */
    listingsLimit?: number;
    /** Max Google Q&A rows requested. */
    qaDepth?: number;
    logger?: Logger;
}
const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = 'en';
const DEFAULT_LISTINGS_LIMIT = 20;
const DEFAULT_QA_DEPTH = 100;
const CTX_LISTINGS = { provider: 'dataforseo', operation: 'business-listings' };
const CTX_REVIEWS = { provider: 'dataforseo', operation: 'google-business-reviews-summary' };
const CTX_QA = { provider: 'dataforseo', operation: 'google-questions-and-answers' };
const businessListingsResultSchema = z
    .array(z
    .object({
    items: z
        .array(z
        .object({
        type: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
        directory: z.string().nullable().optional(),
        platform: z.string().nullable().optional(),
        domain: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        original_title: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        phone_numbers: z.array(z.string()).nullable().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
})
    .passthrough())
    .min(1);
const reviewsResultSchema = z
    .array(z
    .object({
    items: z
        .array(z
        .object({
        rating: z
            .object({
            value: z.number().nullable().optional(),
            votes_count: z.number().nullable().optional(),
        })
            .passthrough()
            .nullable()
            .optional(),
        reviews_count: z.number().nullable().optional(),
        items_count: z.number().nullable().optional(),
        reviews: z.array(z.unknown()).nullable().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
})
    .passthrough())
    .min(1);
const qaResultSchema = z
    .array(z
    .object({
    items_count: z.number().nullable().optional(),
    items: z
        .array(z
        .object({
        question_text: z.string().nullable().optional(),
        items: z.array(z.unknown()).nullable().optional(),
        answers: z.array(z.unknown()).nullable().optional(),
    })
        .passthrough())
        .nullable()
        .optional(),
})
    .passthrough())
    .min(1);
type RawBusinessListingItem = NonNullable<z.infer<typeof businessListingsResultSchema>[number]['items']>[number];
function normalizeLocalTarget(domain: string): string {
    return normalizeSerpDomain(domain.trim());
}
function normalizeText(value: string | null): string {
    return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function normalizePhone(value: string | null): string {
    return (value ?? '').replace(/[^\d+]/g, '');
}
function sourceFromListing(item: RawBusinessListingItem): string {
    const explicit = item.source ?? item.directory ?? item.platform;
    if (explicit && explicit.trim().length > 0)
        return explicit.trim().toLowerCase();
    const domain = item.domain ?? item.url;
    if (!domain)
        return item.type ?? 'unknown';
    return normalizeSerpDomain(domain);
}
function firstPhone(item: RawBusinessListingItem): string | null {
    if (typeof item.phone === 'string' && item.phone.length > 0)
        return item.phone;
    const first = item.phone_numbers?.[0];
    return typeof first === 'string' && first.length > 0 ? first : null;
}
export function computeNapConsistency(rows: Array<Omit<BusinessListingRow, 'consistent'>>): BusinessListingRow[] {
    const google = rows.find((row) => row.source === 'google');
    if (!google)
        return rows.map((row) => ({ ...row, consistent: true }));
    const googleName = normalizeText(google.name);
    const googleAddress = normalizeText(google.address);
    const googlePhone = normalizePhone(google.phone);
    return rows.map((row) => ({
        ...row,
        consistent: normalizeText(row.name) === googleName &&
            normalizeText(row.address) === googleAddress &&
            normalizePhone(row.phone) === googlePhone,
    }));
}
export function normalizeBusinessListings(result: z.infer<typeof businessListingsResultSchema>): BusinessListingRow[] {
    const raw = result[0]?.items ?? [];
    const rows = raw
        .map((item) => {
        const name = item.name ?? item.title ?? item.original_title;
        if (!name || name.trim().length === 0)
            return null;
        return {
            source: sourceFromListing(item),
            name,
            address: item.address ?? null,
            phone: firstPhone(item),
        };
    })
        .filter((row): row is Omit<BusinessListingRow, 'consistent'> => row !== null);
    return computeNapConsistency(rows);
}
export function normalizeReviewsSummary(result: z.infer<typeof reviewsResultSchema>): ReviewsSummary {
    const item = result[0]?.items?.[0];
    const averageRating = typeof item?.rating?.value === 'number' ? item.rating.value : null;
    const reviewCount = typeof item?.reviews_count === 'number'
        ? item.reviews_count
        : typeof item?.rating?.votes_count === 'number'
            ? item.rating.votes_count
            : 0;
    const recentReviewCount = typeof item?.items_count === 'number'
        ? item.items_count
        : Array.isArray(item?.reviews)
            ? item.reviews.length
            : null;
    return { averageRating, reviewCount, recentReviewCount };
}
export function normalizeQaSummary(result: z.infer<typeof qaResultSchema>): QaSummary {
    const items = result[0]?.items ?? [];
    const questionCount = typeof result[0]?.items_count === 'number' ? result[0].items_count : items.length;
    const unansweredCount = items.filter((item) => {
        const answers = item.items ?? item.answers ?? [];
        return answers.length === 0;
    }).length;
    return { questionCount, unansweredCount };
}
export function createDataForSeoLocalListingsProvider(cfg: DataForSeoLocalListingsProviderConfig): LocalListingsProvider {
    const locationCode = cfg.locationCode ?? DEFAULT_LOCATION_CODE;
    const languageCode = cfg.languageCode ?? DEFAULT_LANGUAGE_CODE;
    const listingsLimit = cfg.listingsLimit ?? DEFAULT_LISTINGS_LIMIT;
    const qaDepth = cfg.qaDepth ?? DEFAULT_QA_DEPTH;
    async function getBusinessListings(domain: string): Promise<BusinessListingRow[]> {
        const target = normalizeLocalTarget(domain);
        if (target.length === 0) {
            throw new VendorMalformedError('business listings requires a non-empty domain', CTX_LISTINGS);
        }
        const outcomes = await dataForSeoRequest(cfg, '/business_data/business_listings/search/live', [
            {
                title: target,
                filters: [['domain', '=', target]],
                limit: listingsLimit,
            },
        ], businessListingsResultSchema, { operation: 'business-listings' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('business listings returned no ok tasks', CTX_LISTINGS);
        }
        return normalizeBusinessListings(outcome.result);
    }
    async function getReviews(domain: string): Promise<ReviewsSummary> {
        const target = normalizeLocalTarget(domain);
        if (target.length === 0) {
            throw new VendorMalformedError('reviews summary requires a non-empty domain', CTX_REVIEWS);
        }
        const outcomes = await dataForSeoRequest(cfg, '/business_data/google/my_business_info/live', [{ keyword: target, location_code: locationCode, language_code: languageCode }], reviewsResultSchema, { operation: 'google-business-reviews-summary' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('reviews summary returned no ok tasks', CTX_REVIEWS);
        }
        return normalizeReviewsSummary(outcome.result);
    }
    async function getQuestionsAndAnswers(domain: string): Promise<QaSummary> {
        const target = normalizeLocalTarget(domain);
        if (target.length === 0) {
            throw new VendorMalformedError('questions and answers requires a non-empty domain', CTX_QA);
        }
        const outcomes = await dataForSeoRequest(cfg, '/business_data/google/questions_and_answers/live', [
            {
                keyword: target,
                location_code: locationCode,
                language_code: languageCode,
                depth: qaDepth,
            },
        ], qaResultSchema, { operation: 'google-questions-and-answers' });
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('questions and answers returned no ok tasks', CTX_QA);
        }
        return normalizeQaSummary(outcome.result);
    }
    return { getBusinessListings, getReviews, getQuestionsAndAnswers };
}
