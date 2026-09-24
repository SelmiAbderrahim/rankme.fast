/**
 * Request, persistence-boundary, and wire schemas for SERP-overlap clustering.
 *
 * Every bound here is authority for BOTH the pure grouping function and the
 * stored document, so a drifted cluster cannot be written or served.
 */
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const KEYWORD_CLUSTER_RUN_STATUSES = [
    'queued',
    'processing',
    'completed',
    'failed',
] as const;
export type KeywordClusterRunStatus = (typeof KEYWORD_CLUSTER_RUN_STATUSES)[number];
export const KEYWORD_CLUSTER_AI_STATUSES = [
    'pending',
    'applied',
    'output_rejected',
    'provider_failed',
    /** No multi-member cluster existed, so labelling had nothing to name. */
    'skipped',
] as const;
export type KeywordClusterAiStatus = (typeof KEYWORD_CLUSTER_AI_STATUSES)[number];
/** Why a tracked keyword could not take part. Never silently dropped. */
export const KEYWORD_CLUSTER_BLOCK_REASONS = [
    'missing',
    'stale',
    'empty',
] as const;
export type KeywordClusterBlockReason = (typeof KEYWORD_CLUSTER_BLOCK_REASONS)[number];
export const KEYWORD_CLUSTER_ERROR_CATEGORIES = [
    'queue_failed',
    'processing_failed',
] as const;
export type KeywordClusterErrorCategory = (typeof KEYWORD_CLUSTER_ERROR_CATEGORIES)[number];
/** Frozen on every run so a later constant change cannot restate old output. */
export const KEYWORD_CLUSTER_RULES_VERSION = '2026-08-04.1';
/** Only the first ten organic results participate in the comparison. */
export const KEYWORD_CLUSTER_TOP_URLS = 10;
/** Three of ten shared results — two is noise on commercial SERPs. */
export const KEYWORD_CLUSTER_MIN_SHARED_URLS = 3;
/** An observation older than this cannot feed a run. */
export const KEYWORD_CLUSTER_OBSERVATION_FRESHNESS_DAYS = 7;
/** SEC-BOUND: pairwise work is bounded at 200 x 200 set intersections. */
export const KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN = 200;
/** One cluster per keyword in the all-singleton worst case. */
export const KEYWORD_CLUSTER_MAX_CLUSTERS = KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN;
/** Evidence can never exceed the compared window. */
export const KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED = KEYWORD_CLUSTER_TOP_URLS;
/** AI label bound, enforced at the schema AND at the code-point level. */
export const KEYWORD_CLUSTER_MAX_LABEL_CODE_POINTS = 60;
/** Clusters sent to the labelling profile in one request. */
export const KEYWORD_CLUSTER_MAX_AI_CLUSTERS = 50;
/** Member keywords disclosed to the labelling profile per cluster. */
export const KEYWORD_CLUSTER_MAX_AI_MEMBERS = 50;
/** Blocked keywords echoed in a preview or refusal payload. */
export const KEYWORD_CLUSTER_MAX_BLOCKED_DISCLOSED = 20;
/** Clustering one keyword is meaningless; two is the smallest honest run. */
export const KEYWORD_CLUSTER_MIN_READY_KEYWORDS = 2;
export const KEYWORD_CLUSTER_MAX_PHRASE_LENGTH = 400;
export const KEYWORD_CLUSTER_MAX_URL_LENGTH = 2048;
const objectIdSchema = z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'validation.issue.invalidString');
const uuidSchema = z.string().uuid();
export const keywordClusterSiteParamsSchema = z
    .object({ siteId: objectIdSchema })
    .strict();
export const keywordClusterRunParamsSchema = z
    .object({ runId: objectIdSchema })
    .strict();
export const keywordClusterStartBodySchema = z
    .object({
    /** Omitted or empty = every ready tracked Google keyword for the site. */
    keywordIds: z
        .array(uuidSchema)
        .max(KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN)
        .optional(),
    locale: z.enum(SUPPORTED_LOCALES).default('en'),
})
    .strict()
    .default({});
export const keywordClusterListQuerySchema = z
    .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
    .strict();
export function codePointLength(value: string): number {
    return [...value].length;
}
export const keywordClusterLabelSchema = z
    .string()
    .min(1)
    // UTF-16 pre-bound keeps the code-point test from scanning a huge string.
    .max(KEYWORD_CLUSTER_MAX_LABEL_CODE_POINTS * 4)
    .refine((value) => codePointLength(value) <= KEYWORD_CLUSTER_MAX_LABEL_CODE_POINTS, { message: 'validation.issue.invalidString' });
const sharedUrlsSchema = z
    .array(z.string().min(1).max(KEYWORD_CLUSTER_MAX_URL_LENGTH))
    .max(KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED);
export const keywordClusterMemberSchema = z
    .object({
    keywordId: uuidSchema,
    phrase: z.string().min(1).max(KEYWORD_CLUSTER_MAX_PHRASE_LENGTH),
    observedAt: z.string().datetime(),
    isPivot: z.boolean(),
    sharedUrls: sharedUrlsSchema,
    sharedUrlCount: z
        .number()
        .int()
        .min(0)
        .max(KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED),
})
    .strict();
export type KeywordClusterMember = z.infer<typeof keywordClusterMemberSchema>;
export const keywordClusterSchema = z
    .object({
    id: z.string().regex(/^cluster-[1-9][0-9]{0,3}$/u),
    size: z.number().int().min(1).max(KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN),
    pivotKeywordId: uuidSchema,
    sharedUrls: sharedUrlsSchema,
    members: z
        .array(keywordClusterMemberSchema)
        .min(1)
        .max(KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN),
    label: keywordClusterLabelSchema.nullable(),
    labelSource: z.literal('ai').nullable(),
})
    .strict()
    .superRefine((cluster, ctx) => {
    if (cluster.size !== cluster.members.length) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'validation.issue.custom',
        });
    }
    if (cluster.members[0]?.isPivot !== true) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'validation.issue.custom',
        });
    }
    // The honesty invariant: a grouped member that cannot show its overlap
    // evidence must not serialize at all.
    for (const member of cluster.members) {
        if (member.isPivot)
            continue;
        if (member.sharedUrlCount < KEYWORD_CLUSTER_MIN_SHARED_URLS) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'validation.issue.custom',
            });
        }
    }
    if ((cluster.label === null) !== (cluster.labelSource === null)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'validation.issue.custom',
        });
    }
});
export type KeywordCluster = z.infer<typeof keywordClusterSchema>;
export const keywordClusterSetSchema = z
    .array(keywordClusterSchema)
    .max(KEYWORD_CLUSTER_MAX_CLUSTERS);
export const keywordClusterBlockedSchema = z
    .object({
    keywordId: uuidSchema,
    phrase: z.string().min(1).max(KEYWORD_CLUSTER_MAX_PHRASE_LENGTH),
    reason: z.enum(KEYWORD_CLUSTER_BLOCK_REASONS),
    observedAt: z.string().datetime().nullable(),
})
    .strict();
export type KeywordClusterBlocked = z.infer<typeof keywordClusterBlockedSchema>;
