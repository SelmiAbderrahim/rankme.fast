/**
 * DataForSEO Business Data reviews adapter.
 *
 * Wraps three review sources — Google, Trustpilot, Tripadvisor — using the
 * shared two-call task-based pattern:
 *
 *   POST /v3/business_data/<source>/reviews/task_post
 *      returns `20100 created + task_id`
 *   GET  /v3/business_data/<source>/reviews/task_get/advanced/<task_id>
 *      returns `20000 ok + reviews`
 *
 * Vendor docs:
 *   Google       https://docs.dataforseo.com/v3/business_data/google/reviews/task_post/
 *   Trustpilot   https://docs.dataforseo.com/v3/business_data/trustpilot/reviews/task_post/
 *   Tripadvisor  https://docs.dataforseo.com/v3/business_data/tripadvisor/reviews/task_post/
 *
 * Pinned cost:
 *   google/trustpilot: `$0.002 base + $0.001 * ceil(depth/10)`
 *   tripadvisor:       `$0.004 base + $0.001 * ceil(depth/10)`
 *
 * On-demand only — the adapter fires task_post then immediately calls
 * task_get once. A queued/incomplete task raises `VendorTimeoutError`
 * (job-level retries are BullMQ's problem, per shipped policy).
 *
 * Normalization drops non-public author fields:
 *   - reviewer profile URLs / IDs / emails
 *   - photo URLs / logos / avatars
 * and clamps review text at 1000 characters (SEC-BOUND). Any email-like
 * fragment inside review text is replaced with `[email]` before storage.
 *
 * Provider seam only in this batch — no feature module consumes it yet
 * (the Review Intelligence pipeline will).
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { VendorMalformedError, VendorTimeoutError } from '../errors.js';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import type { ReviewRow, ReviewsInput, ReviewsProvider, ReviewsResult, ReviewsSource, } from '../types.js';
export interface DataForSeoReviewsProviderConfig extends DataForSeoConfig {
    logger?: Logger;
    now?: () => Date;
}
export const REVIEW_TEXT_MAX_CHARS = 1000;
export const REVIEW_TITLE_MAX_CHARS = 200;
export const REVIEW_AUTHOR_MAX_CHARS = 120;
function ctx(source: ReviewsSource, phase: 'task-post' | 'task-get'): {
    provider: string;
    operation: string;
} {
    return { provider: 'dataforseo', operation: `reviews-${source}-${phase}` };
}
/** Zod input schema — SEC-INJECT enforcement at the boundary. */
export const reviewsInputSchema = z
    .object({
    source: z.enum(['google', 'trustpilot', 'tripadvisor']),
    target: z
        .string()
        .transform((s) => s.trim())
        .pipe(z
        .string()
        .min(1)
        .max(200)
        // Reject ASCII control characters (\x00-\x1F, \x7F) AND whitespace
        // (space, \x20). Place ids, Trustpilot domains, and Tripadvisor
        // location ids are always single tokens; feature-layer targets
        // arrive slugged or numeric, so internal whitespace signals
        // injection or malformed input.
        // eslint-disable-next-line no-control-regex
        .regex(/^[^\u0000-\u0020\u007F]+$/, {
        message: 'target must not contain control characters or whitespace',
    })),
    language: z
        .string()
        .regex(/^[a-zA-Z_]{2,15}$/)
        .optional(),
    depth: z.number().int().min(1).max(100),
})
    .strict();
// ---------------------------------------------------------------------------
// Vendor schemas
// ---------------------------------------------------------------------------
const taskPostResultSchema = z
    .array(z
    .object({
    keyword: z.string().nullable().optional(),
})
    .passthrough()
    .nullable())
    .nullable();
const rawReviewItemSchema = z
    .object({
    review_id: z.string().nullable().optional(),
    id: z.string().nullable().optional(),
    rating: z
        .object({
        value: z.number().nullable().optional(),
    })
        .passthrough()
        .nullable()
        .optional(),
    title: z.string().nullable().optional(),
    review_text: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    language_code: z.string().nullable().optional(),
    timestamp: z.string().nullable().optional(),
    review_datetime: z.string().nullable().optional(),
    profile_name: z.string().nullable().optional(),
    author_name: z.string().nullable().optional(),
    // Anything else — profile_url, email, photo_urls, etc. — is DROPPED
    // during normalization. `.passthrough()` keeps the zod check green but
    // the extra fields are ignored below.
})
    .passthrough();
const taskGetResultSchema = z
    .array(z
    .object({
    items: z.array(rawReviewItemSchema).nullable().optional(),
})
    .passthrough())
    .nullable();
// ---------------------------------------------------------------------------
// Pure helpers — exported for direct testing.
// ---------------------------------------------------------------------------
const EMAIL_PATTERN = /[a-z\d._%+-]{1,64}@[a-z\d-]{1,63}(?:\.[a-z\d-]{1,63}){1,4}/gi;
export function scrubEmailFragments(text: string): string {
    return text.replace(EMAIL_PATTERN, '[email]');
}
export function clampReviewText(value: unknown, max: number): string {
    if (typeof value !== 'string')
        return '';
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0)
        return '';
    const scrubbed = scrubEmailFragments(trimmed);
    return scrubbed.length > max ? scrubbed.slice(0, max) : scrubbed;
}
function clampNullableText(value: unknown, max: number): string | null {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed.length === 0)
        return null;
    const scrubbed = scrubEmailFragments(trimmed);
    return scrubbed.length > max ? scrubbed.slice(0, max) : scrubbed;
}
function clampRating(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;
    if (value < 0)
        return 0;
    if (value > 5)
        return 5;
    return value;
}
function normalizeIsoDatetime(value: string | null | undefined): string | null {
    if (typeof value !== 'string' || value.trim().length === 0)
        return null;
    const trimmed = value.trim();
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed.toISOString();
}
export function normalizeReviewRow(raw: z.infer<typeof rawReviewItemSchema>, fallbackId: string): ReviewRow {
    return {
        rating: clampRating(raw.rating?.value ?? null),
        title: clampNullableText(raw.title, REVIEW_TITLE_MAX_CHARS),
        text: clampReviewText(raw.review_text ?? raw.text, REVIEW_TEXT_MAX_CHARS),
        authorDisplayName: clampNullableText(raw.profile_name ?? raw.author_name, REVIEW_AUTHOR_MAX_CHARS),
        language: typeof raw.language_code === 'string' && raw.language_code.trim().length > 0
            ? raw.language_code.toLowerCase()
            : typeof raw.language === 'string' && raw.language.trim().length > 0
                ? raw.language.toLowerCase()
                : null,
        reviewedAt: normalizeIsoDatetime(raw.timestamp ?? raw.review_datetime),
        sourceReviewId: typeof raw.review_id === 'string' && raw.review_id.trim().length > 0
            ? raw.review_id.trim()
            : typeof raw.id === 'string' && raw.id.trim().length > 0
                ? raw.id.trim()
                : fallbackId,
    };
}
export function normalizeReviewRows(result: z.infer<typeof taskGetResultSchema>): ReviewRow[] {
    const items = result?.[0]?.items ?? [];
    return items.map((item, idx) => normalizeReviewRow(item, `row-${idx}`));
}
// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------
export function createDataForSeoReviewsProvider(cfg: DataForSeoReviewsProviderConfig): ReviewsProvider {
    const nowFn = cfg.now ?? (() => new Date());
    async function getReviews(input: ReviewsInput): Promise<ReviewsResult> {
        const parsed = reviewsInputSchema.parse(input);
        // Task_post — kicks off the async task.
        const postBody: Record<string, unknown> = {
            keyword: parsed.target,
            depth: parsed.depth,
        };
        if (parsed.language)
            postBody.language_code = parsed.language.toLowerCase();
        const postOutcomes = await dataForSeoRequest(cfg, `/business_data/${parsed.source}/reviews/task_post`, [postBody], taskPostResultSchema, { operation: ctx(parsed.source, 'task-post').operation });
        const created = postOutcomes[0];
        if (!created) {
            throw new VendorMalformedError(`${parsed.source} reviews task_post returned no outcomes`, ctx(parsed.source, 'task-post'));
        }
        if (created.status === 'in_queue') {
            throw new VendorTimeoutError(`${parsed.source} reviews task_post remained in queue`, ctx(parsed.source, 'task-post'));
        }
        if (created.status !== 'created' || !created.taskId) {
            throw new VendorMalformedError(`${parsed.source} reviews task_post missing task id`, ctx(parsed.source, 'task-post'));
        }
        // Task_get — single poll.
        const getOutcomes = await dataForSeoRequest(cfg, `/business_data/${parsed.source}/reviews/task_get/advanced/${created.taskId}`, [], taskGetResultSchema, { operation: ctx(parsed.source, 'task-get').operation, method: 'GET' });
        const outcome = getOutcomes[0];
        if (!outcome) {
            throw new VendorMalformedError(`${parsed.source} reviews task_get returned no outcomes`, ctx(parsed.source, 'task-get'));
        }
        if (outcome.status === 'in_queue') {
            throw new VendorTimeoutError(`${parsed.source} reviews task_get still in queue`, ctx(parsed.source, 'task-get'));
        }
        if (outcome.status !== 'ok') {
            throw new VendorMalformedError(`${parsed.source} reviews task_get non-ok status`, ctx(parsed.source, 'task-get'));
        }
        return {
            source: parsed.source,
            target: parsed.target,
            rows: normalizeReviewRows(outcome.result),
            fetchedAt: nowFn().toISOString(),
        };
    }
    return { getReviews };
}
