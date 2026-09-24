/**
 * Content inventory + cannibalization — request + result schemas.
 *
 * Provider-neutral, deterministic shapes for the whole inventory pipeline:
 * the request body (with SEC-BOUND zod ceilings), the per-page derived facts,
 * and the portfolio-level findings (clusters, duplicates, thin/orphan pages,
 * cannibalization candidates, topical gaps). The DataForSEO / Firecrawl shapes
 * never leak past the provider seam.
 *
 * The similarity thresholds are versioned in code (`THRESHOLDS_VERSION`) so a
 * downstream re-analysis can filter its inputs by version, and so a threshold
 * change is a visible, reviewable diff instead of a silent behaviour drift.
 */
import { z } from 'zod';
import { env } from '../../config/env.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { CANNIBALIZATION_CONFIDENCE_LEVELS, cannibalizationCandidateSchema, type CannibalizationConfidence, } from '../../shared/cannibalization/index.js';
export { cannibalizationCandidateSchema, type CannibalizationCandidate, } from '../../shared/cannibalization/index.js';
export const INVENTORY_SCHEMA_VERSION = '2026-07-20.1';
export const THRESHOLDS_VERSION = '2026-07-20.1';
/**
 * Versioned deterministic thresholds. Every branch in `inventory.analysis.ts`
 * reads from here — no magic numbers inline. Bumping a value MUST bump
 * `THRESHOLDS_VERSION` (pinned by inventory.analysis.test.ts).
 */
export interface InventoryThresholds {
    version: string;
    /** Term-set Jaccard at/above which two pages share a topic cluster. */
    clusterJaccard: number;
    /** Title/heading Jaccard at/above which two pages are NEAR duplicates. */
    nearDuplicateJaccard: number;
    /** Word count below which a page is flagged thin. */
    thinWordCount: number;
    /** Internal in-link count at/below which a page is flagged orphan/weak. */
    orphanInboundLinks: number;
    /** Internal in-link count at/below which a page is weakly linked (> orphan). */
    weakInboundLinks: number;
    /** Max characters of any single string fed to tokenization (SEC-INJECT). */
    maxTokenizedChars: number;
    /** Max distinct terms retained per page (bounds the O(n·m) comparison). */
    maxTermsPerPage: number;
}
export const INVENTORY_THRESHOLDS: InventoryThresholds = {
    version: THRESHOLDS_VERSION,
    clusterJaccard: 0.5,
    nearDuplicateJaccard: 0.8,
    thinWordCount: 250,
    orphanInboundLinks: 0,
    weakInboundLinks: 1,
    maxTokenizedChars: 4000,
    maxTermsPerPage: 200,
};
/**
 * Confidence ladder for cannibalization + gap findings. The values live in the
 * shared cannibalization authority (`shared/cannibalization/`) so the inventory
 * and the cannibalization report grade the same evidence identically; the
 * inventory-flavoured names stay as re-exports for the existing consumers.
 */
export const INVENTORY_CONFIDENCE_LEVELS = CANNIBALIZATION_CONFIDENCE_LEVELS;
export type InventoryConfidence = CannibalizationConfidence;
// ---------------------------------------------------------------------------
// Request body — SEC-BOUND zod ceilings on every attacker-influenced field.
// ---------------------------------------------------------------------------
/** Path-prefix shape: leading slash, url-safe path chars, optional `*` glob. */
const pathPrefixSchema = z
    .string()
    .min(1)
    .max(256)
    .regex(/^\/[\w./*-]*$/, 'validation.issue.invalidString');
export const startInventoryBodySchema = z
    .object({
    // Requested owned-page crawl limit — clamped to the hard operator ceiling
    // so a huge value can never crawl beyond policy (SEC-BOUND).
    pageLimit: z.coerce
        .number()
        .int()
        .min(1)
        .max(env.CONTENT_INVENTORY_MAX_PAGES),
    allowedPaths: z.array(pathPrefixSchema).max(20).default([]),
    excludedPaths: z.array(pathPrefixSchema).max(20).default([]),
    sitemapSeeds: z.array(z.string().min(1).max(2048)).max(5).default([]),
    locale: z.enum(SUPPORTED_LOCALES),
    // Optional client-supplied dedup key — omitting it makes an identical
    // request idempotent (returns the existing run); supplying a fresh one
    // forces a brand-new run.
    clientKey: z.string().min(1).max(200).optional(),
})
    .strict();
export type StartInventoryBody = z.infer<typeof startInventoryBodySchema>;
export const siteIdParamsSchema = z.object({ siteId: z.string().min(1).max(64) }).strict();
export const runIdParamsSchema = z.object({ runId: z.string().min(1).max(64) }).strict();
/** Combined params for the run-scoped routes mounted under `/:siteId/.../:runId`. */
export const inventoryRunParamsSchema = z
    .object({
    siteId: z.string().min(1).max(64),
    runId: z.string().min(1).max(64),
})
    .strict();
export const listInventoryQuerySchema = z
    .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(512).optional(),
})
    .strict();
// ---------------------------------------------------------------------------
// Derived per-page facts — NO raw HTML, only facts + hashes.
// ---------------------------------------------------------------------------
export const inventoryPageFactsSchema = z
    .object({
    url: z.string().min(1).max(2048),
    canonical: z.string().min(1).max(2048).nullable(),
    statusCode: z.number().int(),
    robots: z.array(z.string().min(1).max(64)).max(20),
    language: z.string().min(1).max(32).nullable(),
    title: z.string().max(1024).nullable(),
    description: z.string().max(4000).nullable(),
    headings: z.array(z.string().min(1).max(1024)).max(200),
    wordCount: z.number().int().min(0),
    schemaTypes: z.array(z.string().min(1).max(200)).max(50),
    hasSchemaOrgArticle: z.boolean(),
    internalLinkCount: z.number().int().min(0),
    externalLinkCount: z.number().int().min(0),
    /** Canonicalized same-origin out-links used to build the in-link graph. */
    internalOutLinks: z.array(z.string().min(1).max(2048)).max(500),
    contentHash: z.string().min(1).max(128),
    primaryTopics: z.array(z.string().min(1).max(120)).max(20),
    secondaryTopics: z.array(z.string().min(1).max(120)).max(40),
    targetQueries: z.array(z.string().min(1).max(400)).max(50),
    qualityFlags: z.array(z.enum(['thin', 'orphan', 'weakly_linked', 'noindex', 'missing_title'])).max(10),
})
    .strict();
export type InventoryPageFacts = z.infer<typeof inventoryPageFactsSchema>;
// ---------------------------------------------------------------------------
// Portfolio findings.
// ---------------------------------------------------------------------------
export const topicClusterSchema = z
    .object({
    id: z.string().min(1).max(128),
    label: z.string().min(1).max(200),
    urls: z.array(z.string().min(1).max(2048)).min(1).max(500),
    sharedTerms: z.array(z.string().min(1).max(120)).max(40),
})
    .strict();
export type TopicCluster = z.infer<typeof topicClusterSchema>;
export const duplicateGroupSchema = z
    .object({
    id: z.string().min(1).max(128),
    kind: z.enum(['exact', 'near']),
    field: z.enum(['content', 'title', 'headings']),
    urls: z.array(z.string().min(1).max(2048)).min(2).max(500),
    similarity: z.number().min(0).max(1),
})
    .strict();
export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>;
export const flaggedPageSchema = z
    .object({
    url: z.string().min(1).max(2048),
    reason: z.enum(['thin', 'orphan', 'weakly_linked']),
    wordCount: z.number().int().min(0),
    internalLinkCount: z.number().int().min(0),
})
    .strict();
export type FlaggedPage = z.infer<typeof flaggedPageSchema>;
export const topicalGapSchema = z
    .object({
    id: z.string().min(1).max(128),
    query: z.string().min(1).max(400),
    confidence: z.enum(INVENTORY_CONFIDENCE_LEVELS),
    evidenceSourceIds: z.array(z.string().min(1).max(256)).max(50),
})
    .strict();
export type TopicalGap = z.infer<typeof topicalGapSchema>;
export const inventoryFindingsSchema = z
    .object({
    version: z.string().min(1).max(64),
    thresholdsVersion: z.string().min(1).max(64),
    clusters: z.array(topicClusterSchema).max(1000),
    duplicates: z.array(duplicateGroupSchema).max(1000),
    thinPages: z.array(flaggedPageSchema).max(1000),
    orphanPages: z.array(flaggedPageSchema).max(1000),
    cannibalization: z.array(cannibalizationCandidateSchema).max(1000),
    gaps: z.array(topicalGapSchema).max(1000),
    /** Optional plain-language AI explanation; findings are complete without it. */
    opportunityExplanation: z.string().max(8000).nullable(),
})
    .strict();
export type InventoryFindings = z.infer<typeof inventoryFindingsSchema>;
