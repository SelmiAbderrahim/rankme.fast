/** Request, persistence-boundary, and wire schemas for internal-link guidance. */
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const INTERNAL_LINK_RUN_STATUSES = [
    'queued',
    'processing',
    'completed',
    'failed',
] as const;
export type InternalLinkRunStatus = (typeof INTERNAL_LINK_RUN_STATUSES)[number];
export const INTERNAL_LINK_AI_STATUSES = [
    'pending',
    'applied',
    'output_rejected',
    'provider_failed',
] as const;
export type InternalLinkAiStatus = (typeof INTERNAL_LINK_AI_STATUSES)[number];
export const INTERNAL_LINK_TARGET_FLAGS = ['orphan', 'weakly_linked'] as const;
export type InternalLinkTargetFlag = (typeof INTERNAL_LINK_TARGET_FLAGS)[number];
export const INTERNAL_LINK_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type InternalLinkConfidence = (typeof INTERNAL_LINK_CONFIDENCES)[number];
export const INTERNAL_LINK_RANKING_SOURCES = ['deterministic', 'ai'] as const;
export type InternalLinkRankingSource = (typeof INTERNAL_LINK_RANKING_SOURCES)[number];
export const INTERNAL_LINK_ERROR_CATEGORIES = [
    'queue_failed',
    'processing_failed',
] as const;
export type InternalLinkErrorCategory = (typeof INTERNAL_LINK_ERROR_CATEGORIES)[number];
export const INTERNAL_LINK_CANDIDATE_RULES_VERSION = '2026-08-02.1';
export const INTERNAL_LINK_INVENTORY_FRESHNESS_DAYS = 7;
export const INTERNAL_LINK_MAX_CANDIDATES = 100;
export const INTERNAL_LINK_MAX_SOURCES_PER_TARGET = 5;
export const INTERNAL_LINK_MAX_EVIDENCE_ITEMS = 10;
export const INTERNAL_LINK_MAX_ANCHOR_CODE_POINTS = 120;
const objectIdSchema = z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'validation.issue.invalidString');
export const internalLinkSiteParamsSchema = z
    .object({ siteId: objectIdSchema })
    .strict();
export const internalLinkRunParamsSchema = z
    .object({ runId: objectIdSchema })
    .strict();
export const internalLinkStartBodySchema = z
    .object({ locale: z.enum(SUPPORTED_LOCALES).default('en') })
    .strict()
    .default({});
export const internalLinkListQuerySchema = z
    .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
    .strict();
export function codePointLength(value: string): number {
    return [...value].length;
}
export const internalLinkAnchorSchema = z
    .string()
    .min(1)
    // UTF-16 pre-bound prevents excessive allocation before the code-point test.
    .max(INTERNAL_LINK_MAX_ANCHOR_CODE_POINTS * 2)
    .refine((value) => codePointLength(value) <= INTERNAL_LINK_MAX_ANCHOR_CODE_POINTS, { message: 'validation.issue.invalidString' });
export const internalLinkSuggestionSchema = z
    .object({
    id: z.string().regex(/^link-[0-9a-f]{20}$/u),
    sourceUrl: z.string().min(1).max(2048),
    sourceSection: z.string().min(1).max(256),
    sourceWordCount: z.number().int().min(0),
    targetUrl: z.string().min(1).max(2048),
    targetFlag: z.enum(INTERNAL_LINK_TARGET_FLAGS),
    targetInboundCount: z.number().int().min(0).max(1),
    confidence: z.enum(INTERNAL_LINK_CONFIDENCES),
    sharedQueries: z
        .array(z.string().min(1).max(400))
        .max(INTERNAL_LINK_MAX_EVIDENCE_ITEMS),
    headingMatches: z
        .array(z.string().min(1).max(1024))
        .max(INTERNAL_LINK_MAX_EVIDENCE_ITEMS),
    anchorText: internalLinkAnchorSchema,
    inventoryDate: z.string().datetime(),
    rank: z.number().int().min(1).max(INTERNAL_LINK_MAX_CANDIDATES).nullable(),
    rankingSource: z.enum(INTERNAL_LINK_RANKING_SOURCES),
})
    .strict();
export type InternalLinkSuggestion = z.infer<typeof internalLinkSuggestionSchema>;
export const internalLinkSuggestionSetSchema = z
    .array(internalLinkSuggestionSchema)
    .max(INTERNAL_LINK_MAX_CANDIDATES);
