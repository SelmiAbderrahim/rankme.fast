/**
 * Content Intelligence — deterministic analysis schemas + versions.
 *
 * These schemas describe every persisted piece of the analysis pipeline
 * (owned page facts, keyword+SERP evidence, competitor evidence, scorecard,
 * recommendations). They are provider-neutral — the DataForSEO / Firecrawl
 * shapes never leak past the provider seam.
 *
 * Version constants are stamped into every scorecard + brief output so a
 * downstream re-scoring engine can filter its inputs by shape/version.
 */
import { z } from 'zod';
export const SCHEMA_VERSION = '2026-07-15.1';
export const SCORE_VERSION = '2026-07-15.1';
export const SCORECARD_SECTIONS = [
    'intent',
    'coverage',
    'structure',
    'links',
    'schema',
    'technical',
] as const;
export type ScorecardSectionKey = (typeof SCORECARD_SECTIONS)[number];
/** Section weights — MUST sum to 100 (see score.ts assertion). */
export const SECTION_WEIGHTS: Readonly<Record<ScorecardSectionKey, number>> = {
    intent: 25,
    coverage: 25,
    structure: 20,
    links: 10,
    schema: 15,
    technical: 5,
};
export const ownedPageFactsSchema = z
    .object({
    url: z.string().min(1).max(2048),
    title: z.string().nullable(),
    description: z.string().nullable(),
    canonical: z.string().nullable(),
    language: z.string().nullable(),
    wordCount: z.number().int().min(0),
    headingCount: z.number().int().min(0),
    schemaTypes: z.array(z.string().min(1).max(200)).max(50),
    hasSchemaOrgArticle: z.boolean(),
    internalLinkCount: z.number().int().min(0),
    externalLinkCount: z.number().int().min(0),
    contentHash: z.string().min(1).max(128),
    excerpt: z.string().max(8000),
})
    .strict();
export type OwnedPageFacts = z.infer<typeof ownedPageFactsSchema>;
export const keywordEvidenceSchema = z
    .object({
    keyword: z.string().min(1).max(400),
    locationCode: z.number().int(),
    languageCode: z.string().min(2).max(16),
    volume: z.number().int().nullable(),
    difficulty: z.number().nullable(),
    intent: z.enum([
        'informational',
        'commercial',
        'transactional',
        'navigational',
    ]).nullable(),
})
    .strict();
export type KeywordEvidence = z.infer<typeof keywordEvidenceSchema>;
export const serpEvidenceSchema = z
    .object({
    device: z.enum(['desktop', 'mobile']),
    ownedPosition: z.number().int().nullable(),
    topUrls: z.array(z.string().min(1).max(2048)).max(50),
})
    .strict();
export type SerpEvidence = z.infer<typeof serpEvidenceSchema>;
export const competitorEvidenceSchema = z
    .object({
    sourceId: z.string().min(1).max(128),
    url: z.string().min(1).max(2048),
    title: z.string().nullable(),
    wordCount: z.number().int().min(0),
    headingCount: z.number().int().min(0),
    schemaTypes: z.array(z.string().min(1).max(200)).max(50),
    hasSchemaOrgArticle: z.boolean(),
    snippet: z.string().max(600),
    contentHash: z.string().min(1).max(128),
})
    .strict();
export type CompetitorEvidence = z.infer<typeof competitorEvidenceSchema>;
export const competitorFailureSchema = z
    .object({
    url: z.string().min(1).max(2048),
    reason: z.enum(['unavailable', 'unsafe', 'malformed', 'quota', 'timeout']),
})
    .strict();
export type CompetitorFailure = z.infer<typeof competitorFailureSchema>;
export const scorecardSectionSchema = z
    .object({
    key: z.enum(SCORECARD_SECTIONS),
    score: z.number().min(0).max(100),
    weight: z.number().int().min(0).max(100),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(400),
})
    .strict();
export type ScorecardSection = z.infer<typeof scorecardSectionSchema>;
export const scorecardSchema = z
    .object({
    version: z.string().min(1).max(64),
    total: z.number().min(0).max(100),
    sections: z.array(scorecardSectionSchema).length(SCORECARD_SECTIONS.length),
})
    .strict();
export type Scorecard = z.infer<typeof scorecardSchema>;
export const recommendationSchema = z
    .object({
    id: z.string().min(1).max(128),
    section: z.enum(SCORECARD_SECTIONS),
    ruleId: z.string().min(1).max(128),
    direction: z.enum(['add', 'strengthen', 'clarify', 'remove']),
    confidence: z.number().min(0).max(1),
    messageKey: z.string().min(1).max(200),
    evidenceSourceIds: z.array(z.string().min(1).max(128)).max(10),
})
    .strict();
export type Recommendation = z.infer<typeof recommendationSchema>;
export const stageLedgerEntrySchema = z
    .object({
    stage: z.string().min(1).max(64),
    inputHash: z.string().min(1).max(128),
    result: z.enum(['ok', 'skipped', 'failed']),
    durationMs: z.number().int().min(0),
    costMicros: z.number().int().min(0),
    aiCostMicros: z.number().int().min(0),
    reason: z.string().max(200).nullable(),
})
    .strict();
export type StageLedgerEntry = z.infer<typeof stageLedgerEntrySchema>;
