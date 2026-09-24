/**
 * Competitor content intelligence — request + result schemas.
 *
 * Provider-neutral, deterministic shapes for the whole competitor-content
 * pipeline: the confirm/manual-add body (SEC-URL via `safeUrlString`), the
 * run-start body (SEC-BOUND zod ceilings from structural constants), the
 * per-competitor derived page facts (NO raw HTML — facts + hashes + one bounded
 * snippet), the deterministic deltas, and the source-linked opportunities.
 *
 * The DataForSEO / content-source shapes never leak past the provider seam.
 * Every attacker-influenced string is length-capped BEFORE any tokenization
 * (SEC-INJECT), and the copy-similarity threshold is a versioned catalog
 * constant.
 */
import { z } from 'zod';
import { sanitizeTranslationVars } from '../../shared/i18n/errors.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { safeUrlString } from '../../shared/security/index.js';
export const COMPETITOR_CONTENT_SCHEMA_VERSION = '2026-07-20.1';
export const COMPETITOR_CONTENT_THRESHOLDS_VERSION = '2026-07-20.1';
/** Confidence ladder for opportunity findings. */
export const COMPETITOR_CONTENT_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type CompetitorContentConfidence = (typeof COMPETITOR_CONTENT_CONFIDENCE_LEVELS)[number];
// ---------------------------------------------------------------------------
// Competitor profile management (confirm / manual-add / list).
// ---------------------------------------------------------------------------
export const siteIdParamsSchema = z
    .object({ siteId: z.string().min(1).max(64) })
    .strict();
export const competitorIdParamsSchema = z
    .object({
    siteId: z.string().min(1).max(64),
    competitorId: z.string().min(1).max(64),
})
    .strict();
export const runIdParamsSchema = z
    .object({
    siteId: z.string().min(1).max(64),
    runId: z.string().min(1).max(64),
})
    .strict();
/** Confirm a suggested domain OR add a manual one. Public URL only (SEC-URL). */
export const addCompetitorBodySchema = z
    .object({
    url: safeUrlString,
    source: z.enum(['suggested', 'manual']).default('manual'),
})
    .strict();
export type AddCompetitorBody = z.infer<typeof addCompetitorBodySchema>;
export const listCompetitorsQuerySchema = z
    .object({
    status: z.enum(['active', 'archived', 'all']).default('active'),
})
    .strict();
// ---------------------------------------------------------------------------
// Run start.
// ---------------------------------------------------------------------------
const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/);
const profileUuid = z.string().uuid();
export const reviewedPageMatchReferenceSchema = z
    .object({
    landscapeReportId: objectIdHex,
    landscapeOpportunityId: z.string().min(1).max(128).nullable().optional(),
    suggestionId: z.string().min(1).max(128),
})
    .strict();
export type ReviewedPageMatchReference = z.infer<typeof reviewedPageMatchReferenceSchema>;
export const legacyExplicitCompetitorUrlSchema = z
    .object({
    competitorId: profileUuid,
    url: safeUrlString,
})
    .strict();
export const startCompetitorRunBodySchema = z
    .object({
    /** Legacy profile selector. Origin-only starts are rejected by the service. */
    competitorIds: z
        .array(z.string().min(1).max(64))
        .max(COMPETITOR_PORTFOLIO_MAX_COMPETITORS)
        .default([]),
    /** Legacy owned page; retained for explicit-URL compatibility only. */
    ownedUrl: safeUrlString.optional(),
    /** Preferred contract: references to approved landscape page reviews. */
    reviewedPageMatches: z
        .array(reviewedPageMatchReferenceSchema)
        .max(COMPETITOR_CONTENT_PAGES_PER_RUN)
        .default([]),
    /** Compatibility adapter. Every URL must be explicit, public, and same-profile-domain. */
    competitorUrls: z
        .array(legacyExplicitCompetitorUrlSchema)
        .max(COMPETITOR_CONTENT_PAGES_PER_RUN)
        .default([]),
    /** Optional focus keyword/query (bounds "like intent" comparison). */
    keyword: z.string().min(1).max(200).optional(),
    /** Hard ceiling on competitor pages scraped this run (SEC-BOUND). */
    pageLimit: z.coerce
        .number()
        .int()
        .min(1)
        .max(COMPETITOR_CONTENT_PAGES_PER_RUN)
        .default(COMPETITOR_CONTENT_PAGES_PER_RUN),
    locale: z.enum(SUPPORTED_LOCALES),
    /** Optional client dedup key — omitting it makes an identical request
     *  idempotent; supplying a fresh one forces a brand-new run. */
    clientKey: z.string().min(1).max(200).optional(),
})
    .strict()
    .superRefine((body, context) => {
    if (body.reviewedPageMatches.length === 0 &&
        body.competitorIds.length === 0 &&
        body.competitorUrls.length === 0) {
        context.addIssue({
            code: 'custom',
            path: ['reviewedPageMatches'],
            message: 'validation.issue.required',
        });
    }
    if (body.reviewedPageMatches.length > body.pageLimit) {
        context.addIssue({
            code: 'custom',
            path: ['reviewedPageMatches'],
            message: 'validation.issue.custom',
        });
    }
    if (body.competitorUrls.length > body.pageLimit) {
        context.addIssue({
            code: 'custom',
            path: ['competitorUrls'],
            message: 'validation.issue.custom',
        });
    }
    if (body.reviewedPageMatches.length > 0 && body.competitorUrls.length > 0) {
        context.addIssue({
            code: 'custom',
            path: ['competitorUrls'],
            message: 'validation.issue.custom',
        });
    }
});
export type StartCompetitorRunBody = z.infer<typeof startCompetitorRunBodySchema>;
export const landscapeKeywordEvidenceSchema = z
    .object({
    keyword: z.string().min(1).max(200),
    class: z.enum([
        'missing',
        'owned_only',
        'shared_behind',
        'shared_ahead',
        'shared_even',
    ]).nullable(),
    ownedPosition: z.number().int().positive().nullable(),
    competitorPosition: z.number().int().positive().nullable(),
    ownedUrl: z.string().min(1).max(2048).nullable(),
    competitorUrl: z.string().min(1).max(2048).nullable(),
    searchVolume: z.number().int().nonnegative().nullable(),
    intent: z
        .enum(['informational', 'navigational', 'commercial', 'transactional'])
        .nullable(),
    provenanceIndexes: z.array(z.number().int().min(0).max(29)).max(30),
})
    .strict();
export type LandscapeKeywordEvidence = z.infer<typeof landscapeKeywordEvidenceSchema>;
/** Frozen, consume-time-authoritative reviewed page leg persisted on the run. */
export const frozenCompetitorPageMatchSchema = z
    .object({
    source: z.enum(['landscape_review', 'legacy_explicit']),
    landscapeReportId: objectIdHex.nullable(),
    landscapeOpportunityId: z.string().min(1).max(128).nullable(),
    suggestionId: z.string().min(1).max(128).nullable(),
    competitorProfileId: profileUuid,
    competitorDomain: z.string().min(1).max(253),
    suggestedRankingUrl: z.string().min(1).max(2048),
    selectedUrl: z.string().min(1).max(2048),
    ownedUrl: z.string().min(1).max(2048).nullable(),
    keywordEvidence: z.array(landscapeKeywordEvidenceSchema).max(20),
})
    .strict();
export type FrozenCompetitorPageMatch = z.infer<typeof frozenCompetitorPageMatchSchema>;
export const listRunsQuerySchema = z
    .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(512).optional(),
})
    .strict();
// ---------------------------------------------------------------------------
// Derived per-page facts — NO raw HTML; one bounded snippet.
// ---------------------------------------------------------------------------
export const competitorPageFactsSchema = z
    .object({
    url: z.string().min(1).max(2048),
    role: z.enum(['owned', 'competitor']),
    competitorDomain: z.string().min(1).max(253).nullable(),
    statusCode: z.number().int(),
    title: z.string().max(1024).nullable(),
    description: z.string().max(4000).nullable(),
    headings: z.array(z.string().min(1).max(1024)).max(200),
    wordCount: z.number().int().min(0),
    schemaTypes: z.array(z.string().min(1).max(200)).max(50),
    hasSchemaOrgArticle: z.boolean(),
    internalLinkCount: z.number().int().min(0),
    externalLinkCount: z.number().int().min(0),
    contentHash: z.string().min(1).max(128),
    primaryTopics: z.array(z.string().min(1).max(120)).max(20),
    secondaryTopics: z.array(z.string().min(1).max(120)).max(40),
    /** Bounded, sanitized evidence fragment — never reproducible prose. */
    snippet: z.string().max(COMPETITOR_CONTENT_SNIPPET_MAX_CHARS),
})
    .strict();
export type CompetitorPageFacts = z.infer<typeof competitorPageFactsSchema>;
// ---------------------------------------------------------------------------
// Deterministic deltas + opportunities.
// ---------------------------------------------------------------------------
export const competitorDeltaSchema = z
    .object({
    competitorDomain: z.string().min(1).max(253),
    competitorUrl: z.string().min(1).max(2048),
    /** Defaults keep origin-era findings readable without inventing evidence. */
    ownedUrl: z.string().min(1).max(2048).default(''),
    landscapeReportId: objectIdHex.nullable().default(null),
    landscapeOpportunityId: z.string().min(1).max(128).nullable().default(null),
    suggestionId: z.string().min(1).max(128).nullable().default(null),
    keywordEvidence: z.array(landscapeKeywordEvidenceSchema).max(20).default([]),
    /** Positive = competitor has more; negative = owned has more. */
    wordCountDelta: z.number().int(),
    headingCountDelta: z.number().int(),
    internalLinkDelta: z.number().int(),
    externalLinkDelta: z.number().int(),
    /** Schema types the competitor declares that the owned page does not. */
    missingSchemaTypes: z.array(z.string().min(1).max(200)).max(50),
    /** Topics the competitor covers that the owned page does not. */
    missingTopics: z.array(z.string().min(1).max(120)).max(40),
    /** Topics the owned page covers that the competitor does not (strengths). */
    ownedOnlyTopics: z.array(z.string().min(1).max(120)).max(40),
    /** Shared "like intent" queries backing the comparison (evidence). */
    sharedQueries: z.array(z.string().min(1).max(400)).max(50),
    /** Bounded competitor snippet source id (`snippet:<domain>`). */
    snippetSourceId: z.string().min(1).max(256),
})
    .strict();
export type CompetitorDelta = z.infer<typeof competitorDeltaSchema>;
export const COMPETITOR_OPPORTUNITY_KINDS = [
    'topic_gap',
    'schema_gap',
    'format_gap',
    'internal_linking_gap',
    'differentiated_strength',
    'target_keyword',
] as const;
export type CompetitorOpportunityKind = (typeof COMPETITOR_OPPORTUNITY_KINDS)[number];
export const COMPETITOR_OPPORTUNITY_MESSAGE_KEYS = [
    'contentIntelligence.competitorContent.opportunityCopy.topicGap',
    'contentIntelligence.competitorContent.opportunityCopy.schemaGap',
    'contentIntelligence.competitorContent.opportunityCopy.formatGap',
    'contentIntelligence.competitorContent.opportunityCopy.internalLinkingGap',
    'contentIntelligence.competitorContent.opportunityCopy.differentiatedStrength',
    'contentIntelligence.competitorContent.opportunityCopy.targetKeyword',
] as const;
const competitorOpportunityVarsSchema = z
    .record(z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/)
    .refine((value) => !['constructor', 'prototype'].includes(value)), z.union([
    z
        .string()
        .min(1)
        .max(200)
        .refine((value) => sanitizeTranslationVars({ value })?.value === value),
    z.number().finite(),
]))
    .refine((vars) => Object.keys(vars).length <= 16, {
    message: 'validation.issue.custom',
});
const competitorOpportunityBaseSchema = z
    .object({
    id: z.string().min(1).max(128),
    kind: z.enum(COMPETITOR_OPPORTUNITY_KINDS),
    confidence: z.enum(COMPETITOR_CONTENT_CONFIDENCE_LEVELS),
    /** Source ids backing the finding (domain:<d>, query:<q>, schema:<t>...). */
    evidenceSourceIds: z.array(z.string().min(1).max(256)).max(50),
    /** Structured landscape evidence behind this finding. Defaults preserve
     *  readable historical runs created before ranking-page integration. */
    keywordEvidence: z.array(landscapeKeywordEvidenceSchema).max(20).default([]),
})
    .strict();
const semanticCompetitorOpportunitySchema = competitorOpportunityBaseSchema
    .extend({
    messageKey: z.enum(COMPETITOR_OPPORTUNITY_MESSAGE_KEYS),
    messageVars: competitorOpportunityVarsSchema.optional(),
})
    .strict();
const legacyCompetitorOpportunitySchema = competitorOpportunityBaseSchema
    .extend({ label: z.string().min(1).max(400) })
    .strict();
const opportunityKeyByKind = {
    topic_gap: COMPETITOR_OPPORTUNITY_MESSAGE_KEYS[0],
    schema_gap: COMPETITOR_OPPORTUNITY_MESSAGE_KEYS[1],
    format_gap: COMPETITOR_OPPORTUNITY_MESSAGE_KEYS[2],
    internal_linking_gap: COMPETITOR_OPPORTUNITY_MESSAGE_KEYS[3],
    differentiated_strength: COMPETITOR_OPPORTUNITY_MESSAGE_KEYS[4],
    target_keyword: COMPETITOR_OPPORTUNITY_MESSAGE_KEYS[5],
} as const;
function legacyOpportunityVars(kind: CompetitorOpportunityKind, evidenceSourceIds: readonly string[]) {
    const prefix = kind === 'topic_gap'
        ? 'topic:'
        : kind === 'schema_gap'
            ? 'schema:'
            : kind === 'differentiated_strength'
                ? 'owned-topic:'
                : kind === 'target_keyword'
                    ? 'query:'
                    : null;
    if (!prefix)
        return undefined;
    const value = evidenceSourceIds
        .find((sourceId) => sourceId.startsWith(prefix))
        ?.slice(prefix.length, prefix.length + 200);
    if (!value)
        return undefined;
    if (kind === 'schema_gap')
        return { schemaType: value };
    if (kind === 'target_keyword')
        return { query: value };
    return { topic: value };
}
/** Legacy English labels are discarded and rebuilt from stable evidence. */
export const competitorOpportunitySchema = z
    .union([semanticCompetitorOpportunitySchema, legacyCompetitorOpportunitySchema])
    .transform((opportunity) => {
    if ('messageKey' in opportunity)
        return opportunity;
    const { label: _legacyLabel, ...stable } = opportunity;
    const messageVars = legacyOpportunityVars(opportunity.kind, opportunity.evidenceSourceIds);
    return {
        ...stable,
        messageKey: opportunityKeyByKind[opportunity.kind],
        ...(messageVars ? { messageVars } : {}),
    };
});
export type CompetitorOpportunity = z.infer<typeof competitorOpportunitySchema>;
export const competitorContentFindingsSchema = z
    .object({
    version: z.string().min(1).max(64),
    thresholdsVersion: z.string().min(1).max(64),
    ownedUrl: z.string().min(1).max(2048),
    keyword: z.string().max(200).nullable(),
    deltas: z.array(competitorDeltaSchema).max(COMPETITOR_PORTFOLIO_MAX_COMPETITORS),
    opportunities: z.array(competitorOpportunitySchema).max(500),
    /** Domains that could not be read (access-denied / unsafe) — never a
     *  "weakness"; reported as a partial-coverage label only. */
    partialDomains: z.array(z.string().min(1).max(253)).max(COMPETITOR_PORTFOLIO_MAX_COMPETITORS),
    /** Optional plain-language AI explanation; findings are complete without it,
     *  and it is dropped when the copy-similarity guard rejects it. */
    aiExplanation: z.string().max(8000).nullable(),
})
    .strict();
export type CompetitorContentFindings = z.infer<typeof competitorContentFindingsSchema>;
import { COMPETITOR_CONTENT_PAGES_PER_RUN, COMPETITOR_CONTENT_SNIPPET_MAX_CHARS, COMPETITOR_PORTFOLIO_MAX_COMPETITORS } from '../../shared/safety/feature-limits.js';
