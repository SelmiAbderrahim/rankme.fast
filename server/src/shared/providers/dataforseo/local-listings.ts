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
  *   searchBusinesses -> a Google place ID / CID is looked
  *      up with My Business Info live (`keyword: "place_id:…"` / `"cid:…"`,
  *      documented for both My Business Info and Q&A live); a name runs
  *      Business Listings Search live (`title`, limit 10, items carry
  *      `place_id`, `cid`, `address`, `latitude`, `longitude`) and, when that
  *      finds nothing (addresses), one My Business Info live lookup by text.
  *      Worst case $0.012 + 10 × $0.00036 + $0.0054 = $0.021 per search.
  *
  * With a selected business, reviews and Q&A are fetched by its `place_id:` /
  * `cid:` keyword and listings are compared against its own listing row, so
  * the identity the owner chose is what the refresh describes.
  */
import type { Logger } from 'pino';
import { z } from 'zod';
import { VendorMalformedError } from '../errors.js';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import type {
    BusinessListingRow,
    LocalBusinessCandidate,
    LocalBusinessIdentity,
    LocalBusinessSearchInput,
    LocalListingTarget,
    LocalListingsProvider,
    QaSummary,
    ReviewsSummary,
} from '../types.js';
import { normalizeSerpDomain } from './serp.js';

export interface DataForSeoLocalListingsProviderConfig extends DataForSeoConfig {
    /** Max listing rows requested from Business Listings Search live. */
    listingsLimit?: number;
    /** Max Google Q&A rows requested. */
    qaDepth?: number;
    logger?: Logger;
}

const DEFAULT_LISTINGS_LIMIT = 20;
const DEFAULT_QA_DEPTH = 100;
/** Setup search results shown to the owner (and the per-item cost bound). */
export const BUSINESS_SEARCH_LIMIT = 10;

const CTX_LISTINGS = { provider: 'dataforseo', operation: 'business-listings' };
const CTX_REVIEWS = { provider: 'dataforseo', operation: 'google-business-reviews-summary' };
const CTX_QA = { provider: 'dataforseo', operation: 'google-questions-and-answers' };
const CTX_SEARCH = { provider: 'dataforseo', operation: 'business-search' };

const businessListingsResultSchema = z
    .array(
        z
            .object({
                items: z
                    .array(
                        z
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
                                place_id: z.string().nullable().optional(),
                                cid: z.union([z.string(), z.number()]).nullable().optional(),
                                category: z.string().nullable().optional(),
                                latitude: z.number().nullable().optional(),
                                longitude: z.number().nullable().optional(),
                            })
                            .passthrough(),
                    )
                    .nullable()
                    .optional(),
            })
            .passthrough(),
    )
    .min(1);

const reviewsResultSchema = z
    .array(
        z
            .object({
                items: z
                    .array(
                        z
                            .object({
                                title: z.string().nullable().optional(),
                                address: z.string().nullable().optional(),
                                phone: z.string().nullable().optional(),
                                domain: z.string().nullable().optional(),
                                url: z.string().nullable().optional(),
                                category: z.string().nullable().optional(),
                                place_id: z.string().nullable().optional(),
                                cid: z.union([z.string(), z.number()]).nullable().optional(),
                                latitude: z.number().nullable().optional(),
                                longitude: z.number().nullable().optional(),
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
                            .passthrough(),
                    )
                    .nullable()
                    .optional(),
            })
            .passthrough(),
    )
    .min(1);

const qaResultSchema = z
    .array(
        z
            .object({
                items_count: z.number().nullable().optional(),
                items: z
                    .array(
                        z
                            .object({
                                question_text: z.string().nullable().optional(),
                                items: z.array(z.unknown()).nullable().optional(),
                                answers: z.array(z.unknown()).nullable().optional(),
                            })
                            .passthrough(),
                    )
                    .nullable()
                    .optional(),
            })
            .passthrough(),
    )
    .min(1);

type RawBusinessListingItem = NonNullable<
    z.infer<typeof businessListingsResultSchema>[number]['items']
>[number];

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
    if (explicit && explicit.trim().length > 0) return explicit.trim().toLowerCase();
    const domain = item.domain ?? item.url;
    if (!domain) return item.type ?? 'unknown';
    return normalizeSerpDomain(domain);
}

function firstPhone(item: RawBusinessListingItem): string | null {
    if (typeof item.phone === 'string' && item.phone.length > 0) return item.phone;
    const first = item.phone_numbers?.[0];
    return typeof first === 'string' && first.length > 0 ? first : null;
}

export function computeNapConsistency(
    rows: Array<Omit<BusinessListingRow, 'consistent'>>,
): BusinessListingRow[] {
    const google = rows.find((row) => row.source === 'google');
    if (!google) return rows.map((row) => ({ ...row, consistent: true }));
    const googleName = normalizeText(google.name);
    const googleAddress = normalizeText(google.address);
    const googlePhone = normalizePhone(google.phone);
    return rows.map((row) => ({
        ...row,
        consistent:
            normalizeText(row.name) === googleName &&
            normalizeText(row.address) === googleAddress &&
            normalizePhone(row.phone) === googlePhone,
    }));
}

export function normalizeBusinessListings(
    result: z.infer<typeof businessListingsResultSchema>,
): BusinessListingRow[] {
    const raw = result[0]?.items ?? [];
    const rows = raw
        .map((item) => {
            const name = item.name ?? item.title ?? item.original_title;
            if (!name || name.trim().length === 0) return null;
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

export function normalizeReviewsSummary(
    result: z.infer<typeof reviewsResultSchema>,
): ReviewsSummary {
    const item = result[0]?.items?.[0];
    const averageRating =
        typeof item?.rating?.value === 'number' ? item.rating.value : null;
    const reviewCount =
        typeof item?.reviews_count === 'number'
            ? item.reviews_count
            : typeof item?.rating?.votes_count === 'number'
                ? item.rating.votes_count
                : 0;
    const recentReviewCount =
        typeof item?.items_count === 'number'
            ? item.items_count
            : Array.isArray(item?.reviews)
                ? item.reviews.length
                : null;
    return { averageRating, reviewCount, recentReviewCount };
}

export function normalizeQaSummary(result: z.infer<typeof qaResultSchema>): QaSummary {
    const items = result[0]?.items ?? [];
    const questionCount =
        typeof result[0]?.items_count === 'number' ? result[0].items_count : items.length;
    const unansweredCount = items.filter((item) => {
        const answers = item.items ?? item.answers ?? [];
        return answers.length === 0;
    }).length;
    return { questionCount, unansweredCount };
}

/**
  * A place ID or CID typed into the setup search. `place_id:…` / `cid:…` are
  * the vendor's own keyword syntax; a bare `ChIJ…` place ID or an all-digit
  * CID is accepted too. Anything else is a name or address.
  */
export function parseBusinessIdQuery(query: string): { placeId: string } | { cid: string } | null {
    const text = query.trim();
    const prefixed = /^(place_id|cid):(\S+)$/i.exec(text);
    if (prefixed) {
        const [, kind, value] = prefixed;
        if (kind!.toLowerCase() === 'cid') return /^\d{5,25}$/.test(value!) ? { cid: value! } : null;
        return { placeId: value! };
    }
    if (/^ChIJ[A-Za-z0-9_-]{10,}$/.test(text)) return { placeId: text };
    if (/^\d{10,25}$/.test(text)) return { cid: text };
    return null;
}

/** The vendor keyword that names one business: `place_id:…` or `cid:…`. */
export function businessKeyword(business: LocalBusinessIdentity): string {
    return business.placeId ? `place_id:${business.placeId}` : `cid:${business.cid}`;
}

function idOf(value: string | number | null | undefined): string | null {
    if (typeof value === 'number') return String(value);
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** The website host of a listing's domain or URL, for comparing businesses. */
function hostOf(value: string): string {
    return normalizeSerpDomain(value.trim()).split(/[/?#]/)[0]!;
}

function finiteOrNull(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

type RawBusinessInfoItem = NonNullable<z.infer<typeof reviewsResultSchema>[number]['items']>[number];

interface CandidateFields {
    name: string | null | undefined;
    placeId: string | number | null | undefined;
    cid: string | number | null | undefined;
    address: string | null | undefined;
    phone: string | null;
    domain: string | null | undefined;
    category: string | null | undefined;
    latitude: number | null | undefined;
    longitude: number | null | undefined;
}

/** A selectable candidate; a row without a name or an id cannot be refreshed and is dropped. */
function toCandidate(fields: CandidateFields): LocalBusinessCandidate | null {
    const name = fields.name?.trim();
    const placeId = idOf(fields.placeId);
    const cid = idOf(fields.cid);
    if (!name || (!placeId && !cid)) return null;
    return {
        placeId,
        cid,
        name,
        address: fields.address ?? null,
        phone: fields.phone,
        domain: fields.domain ? hostOf(fields.domain) : null,
        category: fields.category ?? null,
        latitude: finiteOrNull(fields.latitude),
        longitude: finiteOrNull(fields.longitude),
    };
}

export function candidateFromListing(item: RawBusinessListingItem): LocalBusinessCandidate | null {
    return toCandidate({
        name: item.name ?? item.title ?? item.original_title,
        placeId: item.place_id,
        cid: item.cid,
        address: item.address,
        phone: firstPhone(item),
        domain: item.domain ?? item.url,
        category: item.category,
        latitude: item.latitude,
        longitude: item.longitude,
    });
}

export function candidateFromProfile(item: RawBusinessInfoItem): LocalBusinessCandidate | null {
    return toCandidate({
        name: item.title,
        placeId: item.place_id,
        cid: item.cid,
        address: item.address,
        phone: item.phone ?? null,
        domain: item.domain ?? item.url,
        category: item.category,
        latitude: item.latitude,
        longitude: item.longitude,
    });
}

/** De-duplicated by place ID / CID, in vendor order, bounded. */
export function normalizeBusinessCandidates(
    candidates: ReadonlyArray<LocalBusinessCandidate | null>,
): LocalBusinessCandidate[] {
    const seen = new Set<string>();
    const out: LocalBusinessCandidate[] = [];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const key = candidate.placeId ?? `cid:${candidate.cid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(candidate);
        if (out.length >= BUSINESS_SEARCH_LIMIT) break;
    }
    return out;
}

/**
  * Listings for a selected business: its own listing row is the reference
  * (`google`); other rows count only when they share its website, and each is
  * compared against that row. No reference row → nothing to compare.
  */
export function normalizeIdentityListings(
    result: z.infer<typeof businessListingsResultSchema>,
    business: LocalBusinessIdentity,
): BusinessListingRow[] {
    const raw = result[0]?.items ?? [];
    const matches = (item: RawBusinessListingItem) =>
        (business.placeId !== null && idOf(item.place_id) === business.placeId) ||
        (business.cid !== null && idOf(item.cid) === business.cid);
    const reference = raw.find(matches);
    if (!reference) return [];
    const referenceDomain = reference.domain ?? reference.url;
    const domain = referenceDomain ? hostOf(referenceDomain) : null;
    const rows = raw
        .filter((item) => {
            if (item === reference) return true;
            const own = item.domain ?? item.url;
            return domain !== null && own ? hostOf(own) === domain : false;
        })
        .map((item) => ({
            source: item === reference ? 'google' : sourceFromListing(item),
            name: (item.name ?? item.title ?? item.original_title ?? business.name).trim(),
            address: item.address ?? null,
            phone: firstPhone(item),
        }));
    return computeNapConsistency(rows);
}

export function createDataForSeoLocalListingsProvider(
    cfg: DataForSeoLocalListingsProviderConfig,
): LocalListingsProvider {
    const listingsLimit = cfg.listingsLimit ?? DEFAULT_LISTINGS_LIMIT;
    const qaDepth = cfg.qaDepth ?? DEFAULT_QA_DEPTH;

    async function listingsSearch(task: Record<string, unknown>, ctx: typeof CTX_LISTINGS) {
        const outcomes = await dataForSeoRequest(
            cfg,
            '/business_data/business_listings/search/live',
            [task],
            businessListingsResultSchema,
            { operation: ctx.operation },
        );
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('business listings returned no ok tasks', ctx);
        }
        return outcome.result;
    }

    async function businessInfo(keyword: string, market: { locationCode: number; languageCode: string }, ctx: typeof CTX_REVIEWS) {
        const outcomes = await dataForSeoRequest(
            cfg,
            '/business_data/google/my_business_info/live',
            [{ keyword, location_code: market.locationCode, language_code: market.languageCode }],
            reviewsResultSchema,
            { operation: ctx.operation },
        );
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('business info returned no ok tasks', ctx);
        }
        return outcome.result;
    }

    // Both result schemas require at least one bucket, so `[0]` is always set.
    async function searchBusinesses(input: LocalBusinessSearchInput): Promise<LocalBusinessCandidate[]> {
        const query = input.query.trim();
        if (query.length === 0) {
            throw new VendorMalformedError('business search requires a non-empty query', CTX_SEARCH);
        }
        const id = parseBusinessIdQuery(query);
        if (id) {
            const keyword = 'placeId' in id ? `place_id:${id.placeId}` : `cid:${id.cid}`;
            const result = await businessInfo(keyword, input, CTX_SEARCH);
            return normalizeBusinessCandidates((result[0]!.items ?? []).map(candidateFromProfile));
        }
        const listings = await listingsSearch({ title: query, limit: BUSINESS_SEARCH_LIMIT }, CTX_SEARCH);
        const found = normalizeBusinessCandidates((listings[0]!.items ?? []).map(candidateFromListing));
        if (found.length > 0) return found;
        // Titles only match names; an address is matched by the profile lookup.
        const profile = await businessInfo(query, input, CTX_SEARCH);
        return normalizeBusinessCandidates((profile[0]!.items ?? []).map(candidateFromProfile));
    }

    async function getBusinessListings(target: LocalListingTarget): Promise<BusinessListingRow[]> {
        if (target.business) {
            const result = await listingsSearch(
                { title: target.business.name, limit: listingsLimit },
                CTX_LISTINGS,
            );
            return normalizeIdentityListings(result, target.business);
        }
        const domain = normalizeLocalTarget(target.domain);
        if (domain.length === 0) {
            throw new VendorMalformedError('business listings requires a non-empty domain', CTX_LISTINGS);
        }
        const result = await listingsSearch(
            { title: domain, filters: [['domain', '=', domain]], limit: listingsLimit },
            CTX_LISTINGS,
        );
        return normalizeBusinessListings(result);
    }

    function keywordFor(target: LocalListingTarget, ctx: typeof CTX_REVIEWS, what: string): string {
        if (target.business) return businessKeyword(target.business);
        const domain = normalizeLocalTarget(target.domain);
        if (domain.length === 0) throw new VendorMalformedError(`${what} requires a non-empty domain`, ctx);
        return domain;
    }

    async function getReviews(target: LocalListingTarget): Promise<ReviewsSummary> {
        const keyword = keywordFor(target, CTX_REVIEWS, 'reviews summary');
        const result = await businessInfo(keyword, target, CTX_REVIEWS);
        return normalizeReviewsSummary(result);
    }

    async function getQuestionsAndAnswers(target: LocalListingTarget): Promise<QaSummary> {
        const keyword = keywordFor(target, CTX_QA, 'questions and answers');
        const outcomes = await dataForSeoRequest(
            cfg,
            '/business_data/google/questions_and_answers/live',
            [
                {
                    keyword,
                    location_code: target.locationCode,
                    language_code: target.languageCode,
                    depth: qaDepth,
                },
            ],
            qaResultSchema,
            { operation: 'google-questions-and-answers' },
        );
        const outcome = outcomes[0];
        if (!outcome || outcome.status !== 'ok') {
            throw new VendorMalformedError('questions and answers returned no ok tasks', CTX_QA);
        }
        return normalizeQaSummary(outcome.result);
    }

    return { searchBusinesses, getBusinessListings, getReviews, getQuestionsAndAnswers };
}
