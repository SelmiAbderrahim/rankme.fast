import { z } from 'zod';
import { sanitizeTranslationVars } from '../../../shared/i18n/errors.js';
import { SUPPORTED_LOCALES } from '../../../shared/i18n/locales.js';
export const LANDSCAPE_MAX_COMPETITORS = 10;
export const LANDSCAPE_ROWS_PER_LEG = 100;
export const LANDSCAPE_MAX_ROWS = 3000;
export const LANDSCAPE_MAX_REPORT_PAGES = 30;
export const LANDSCAPE_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const LANDSCAPE_STATES = [
    'queued',
    'collecting',
    'aggregating',
    'completed',
    'partial',
    'failed',
    'cancelled',
] as const;
export const landscapeStateSchema = z.enum(LANDSCAPE_STATES);
export type LandscapeState = z.infer<typeof landscapeStateSchema>;
export const LANDSCAPE_TERMINAL_STATES = [
    'completed',
    'partial',
    'failed',
    'cancelled',
] as const satisfies readonly LandscapeState[];
export const LANDSCAPE_LEGS = [
    'shared',
    'owned_only',
    'competitor_only',
] as const;
export const landscapeLegSchema = z.enum(LANDSCAPE_LEGS);
export type LandscapeLeg = z.infer<typeof landscapeLegSchema>;
export const LANDSCAPE_CLASSES = [
    'missing',
    'owned_only',
    'shared_behind',
    'shared_ahead',
    'shared_even',
] as const;
export const landscapeClassSchema = z.enum(LANDSCAPE_CLASSES);
export type LandscapeClass = z.infer<typeof landscapeClassSchema>;
const rawHtmlPattern = /(?:<\s*\/?\s*[a-z][^>]*>|<![^>]*>|<\?[^>]*>)/i;
const inertString = (max: number, min = 0) => z
    .string()
    .min(min)
    .max(max)
    .refine((value) => !rawHtmlPattern.test(value), 'validation.issue.invalidString');
const inertPattern = (max: number, pattern: RegExp) => z
    .string()
    .max(max)
    .regex(pattern)
    .refine((value) => !rawHtmlPattern.test(value), 'validation.issue.invalidString');
const boundedId = z.string().min(1).max(128);
const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/);
const profileUuid = z.string().uuid();
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const nullableUrl = z
    .string()
    .max(2048)
    .url()
    .refine((value) => value.startsWith('http://') || value.startsWith('https://'))
    .refine((value) => !rawHtmlPattern.test(value), 'validation.issue.invalidString')
    .nullable();
const nullablePosition = z.number().int().positive().nullable();
export const landscapeStartInputSchema = z
    .object({
    competitorProfileIds: z
        .array(profileUuid)
        .min(1)
        .max(LANDSCAPE_MAX_COMPETITORS)
        .refine((ids) => new Set(ids).size === ids.length, 'validation.issue.custom'),
    locale: z.enum(SUPPORTED_LOCALES),
    idempotencyKey: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[\x21-\x7e]+$/, 'validation.issue.invalidString'),
})
    .strict();
export type LandscapeStartInput = z.infer<typeof landscapeStartInputSchema>;
export const landscapePreviewInputSchema = landscapeStartInputSchema
    .omit({ locale: true, idempotencyKey: true })
    .strict();
export type LandscapePreviewInput = z.infer<typeof landscapePreviewInputSchema>;
export const landscapeMarketSchema = z
    .object({
    locationCode: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    languageCode: z.string().regex(/^[a-z]{2,10}$/),
    source: z.enum(['tracked_keyword_mode', 'default']),
    eligibleTrackedKeywords: z.number().int().nonnegative(),
})
    .strict();
export type LandscapeMarket = z.infer<typeof landscapeMarketSchema>;
export const frozenCompetitorSchema = z
    .object({
    profileId: profileUuid,
    domain: inertPattern(253, /^[a-z0-9.-]+$/),
})
    .strict();
export type FrozenCompetitor = z.infer<typeof frozenCompetitorSchema>;
export const landscapeProgressSchema = z
    .object({
    completedLegs: z.number().int().min(0).max(30),
    totalLegs: z.number().int().min(3).max(30),
    stage: landscapeStateSchema,
})
    .strict();
export const normalizedLandscapeRowSchema = z
    .object({
    keyword: inertString(200, 1),
    normalizedKeyword: inertString(200, 1),
    ownedPosition: nullablePosition,
    competitorPosition: nullablePosition,
    ownedRankAbsolute: nullablePosition,
    competitorRankAbsolute: nullablePosition,
    ownedUrl: nullableUrl,
    competitorUrl: nullableUrl,
    searchVolume: z.number().int().nonnegative().nullable(),
    keywordDifficulty: z.number().min(0).max(100).nullable(),
    intent: z
        .enum(['informational', 'navigational', 'commercial', 'transactional'])
        .nullable(),
})
    .strict();
export type NormalizedLandscapeRow = z.infer<typeof normalizedLandscapeRowSchema>;
const legRowsSchema = z.array(normalizedLandscapeRowSchema).max(LANDSCAPE_ROWS_PER_LEG);
export const landscapeKeywordSetsSchema = z
    .object({
    shared: legRowsSchema,
    ownedOnly: legRowsSchema,
    competitorOnly: legRowsSchema,
})
    .strict();
export type LandscapeKeywordSets = z.infer<typeof landscapeKeywordSetsSchema>;
export const landscapeProvenanceSchema = z
    .object({
    provider: inertString(64, 1),
    operation: z.literal('domain_intersection_live'),
    leg: landscapeLegSchema,
    intersections: z.boolean(),
    targetOrder: z.enum(['owned_competitor', 'competitor_owned']),
    itemTypes: z.tuple([z.literal('organic')]),
    limit: z.literal(LANDSCAPE_ROWS_PER_LEG),
    cache: z.enum(['hit', 'miss']),
    status: z.enum(['success', 'timeout', 'malformed', 'quota', 'failed']),
    capturedAt: z.string().datetime().nullable(),
    returnedRows: z.number().int().min(0).max(LANDSCAPE_ROWS_PER_LEG),
    truncated: z.boolean(),
})
    .strict();
export type LandscapeProvenance = z.infer<typeof landscapeProvenanceSchema>;
export const landscapeReportRowSchema = normalizedLandscapeRowSchema
    .extend({
    id: boundedId,
    class: landscapeClassSchema,
    competitorProfileId: profileUuid,
    competitorDomain: inertPattern(253, /^[a-z0-9.-]+$/),
    positionDelta: z.number().int().nullable(),
    competitorCoverage: z.number().int().min(1).max(10),
    provenanceIndexes: z.array(z.number().int().min(0).max(29)).max(30),
})
    .strict();
export type LandscapeReportRow = z.infer<typeof landscapeReportRowSchema>;
export const landscapePortfolioRollupSchema = z
    .object({
    normalizedKeyword: inertString(200, 1),
    competitorCoverage: z.number().int().min(1).max(10),
    competitorProfileIds: z.array(profileUuid).min(1).max(10),
    classes: z.array(landscapeClassSchema).min(1).max(5),
    maxSearchVolume: z.number().int().nonnegative().nullable(),
})
    .strict();
export const landscapePageSuggestionSchema = z
    .object({
    id: boundedId,
    competitorProfileId: profileUuid,
    ownedUrl: nullableUrl.unwrap(),
    competitorUrl: nullableUrl.unwrap(),
    keywordKeys: z.array(inertString(200, 1)).min(1).max(20),
    reasonCode: z.enum(['same_keyword', 'highest_coverage', 'closest_rank']),
    confidence: z.enum(['high', 'medium', 'low']),
    rubricVersion: z.literal('2026-08-08.1'),
})
    .strict();
export const LANDSCAPE_WARNING_CODES = [
    'LEG_TIMEOUT',
    'LEG_MALFORMED',
    'LEG_QUOTA',
    'LEG_FAILED',
    'LEG_TRUNCATED',
    'SHARED_POSITION_MISSING',
    'DUPLICATE_LEG_CONFLICT',
    'RANKING_URL_INVALID',
    'PARTIAL_COMPETITOR',
] as const;
export const landscapeWarningSchema = z
    .object({
    code: z.enum(LANDSCAPE_WARNING_CODES),
    competitorProfileId: profileUuid.nullable(),
    leg: landscapeLegSchema.nullable(),
    count: z.number().int().positive().max(LANDSCAPE_MAX_ROWS),
})
    .strict();
export const landscapeErrorSchema = z
    .object({
    code: inertPattern(64, /^[A-Z0-9_]+$/),
    competitorProfileId: profileUuid.nullable(),
    leg: landscapeLegSchema.nullable(),
    retryable: z.boolean(),
})
    .strict();
export const LANDSCAPE_OPPORTUNITY_TITLE_KEYS = [
    'competitors.landscape.opportunities.missingTitle',
    'competitors.landscape.opportunities.behindTitle',
] as const;
export const LANDSCAPE_OPPORTUNITY_RECOMMENDATION_KEYS = [
    'competitors.landscape.opportunities.missingRecommendation',
    'competitors.landscape.opportunities.behindRecommendation',
] as const;
const landscapeCopyVarsSchema = z
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
    .superRefine((vars, context) => {
    if (Object.keys(vars).length > 16) {
        context.addIssue({ code: 'custom', message: 'validation.issue.custom' });
    }
});
const landscapeFindingBaseSchema = z
    .object({
    id: boundedId,
    kind: z.enum(['missing_keyword', 'ranking_deficit']),
    competitorProfileIds: z.array(profileUuid).min(1).max(10),
    keywordKeys: z.array(inertString(200, 1)).min(1).max(50),
    evidenceRowIds: z.array(boundedId).min(1).max(50),
    confidence: z.enum(['high', 'medium', 'low']),
    labels: z
        .object({
        evidence: z.literal('observed'),
        conclusion: z.literal('derived'),
        prose: z.literal('generated'),
    })
        .strict(),
})
    .strict();
const semanticLandscapeFindingSchema = landscapeFindingBaseSchema
    .extend({
    titleKey: z.enum(LANDSCAPE_OPPORTUNITY_TITLE_KEYS),
    titleVars: landscapeCopyVarsSchema.optional(),
    recommendationKey: z.enum(LANDSCAPE_OPPORTUNITY_RECOMMENDATION_KEYS),
    recommendationVars: landscapeCopyVarsSchema.optional(),
})
    .strict();
const legacyLandscapeFindingSchema = landscapeFindingBaseSchema
    .extend({
    title: inertString(160, 1),
    recommendation: inertString(1000, 1),
})
    .strict();
/**
 * New manifests store only semantic copy. Legacy frozen prose is accepted at
 * the persistence seam, discarded, and deterministically upgraded from kind
 * plus keyword count; the owned URL is completed from evidence at read time.
 */
export const landscapeFindingSchema = z
    .union([semanticLandscapeFindingSchema, legacyLandscapeFindingSchema])
    .transform((finding) => {
    if ('titleKey' in finding)
        return finding;
    const count = finding.keywordKeys.length;
    const titleKey = finding.kind === 'missing_keyword'
        ? LANDSCAPE_OPPORTUNITY_TITLE_KEYS[0]
        : LANDSCAPE_OPPORTUNITY_TITLE_KEYS[1];
    const recommendationKey = finding.kind === 'missing_keyword'
        ? LANDSCAPE_OPPORTUNITY_RECOMMENDATION_KEYS[0]
        : LANDSCAPE_OPPORTUNITY_RECOMMENDATION_KEYS[1];
    const { title: _legacyTitle, recommendation: _legacyRecommendation, ...stable } = finding;
    return {
        ...stable,
        titleKey,
        titleVars: { count },
        recommendationKey,
        recommendationVars: { count },
    };
});
export const landscapeCoverageSchema = z
    .object({
    requestedCompetitors: z.number().int().min(1).max(10),
    usableCompetitors: z.number().int().min(0).max(10),
    requestedLegs: z.number().int().min(3).max(30),
    succeededLegs: z.number().int().min(0).max(30),
    failedLegs: z.number().int().min(0).max(30),
    truncatedLegs: z.number().int().min(0).max(30),
    unclassifiedSharedRows: z.number().int().min(0).max(1000),
    rowsByClass: z.record(landscapeClassSchema, z.number().int().min(0).max(LANDSCAPE_MAX_ROWS)),
})
    .strict();
export const landscapeSourceDateSchema = z
    .object({
    competitorProfileId: profileUuid,
    leg: landscapeLegSchema,
    capturedAt: z.string().datetime().nullable(),
})
    .strict();
export const landscapeReportManifestSchema = z
    .object({
    reportVersion: z.literal(1),
    schemaVersion: z.literal('competitor-landscape/1'),
    taxonomyVersion: z.literal('2026-08-08.1'),
    ownedDomain: inertPattern(253, /^[a-z0-9.-]+$/),
    locale: z.enum(SUPPORTED_LOCALES),
    market: landscapeMarketSchema,
    competitors: z.array(frozenCompetitorSchema).min(1).max(10),
    coverage: landscapeCoverageSchema,
    provenance: z.array(landscapeProvenanceSchema).max(30),
    warnings: z.array(landscapeWarningSchema).max(500),
    errors: z.array(landscapeErrorSchema).max(30),
    pageSuggestions: z.array(landscapePageSuggestionSchema).max(100),
    opportunities: z.array(landscapeFindingSchema).max(100),
    sourceDates: z.array(landscapeSourceDateSchema).max(30),
    pageCount: z.number().int().min(0).max(LANDSCAPE_MAX_REPORT_PAGES),
    rowCount: z.number().int().min(0).max(LANDSCAPE_MAX_ROWS),
    completedAt: z.string().datetime(),
})
    .strict()
    .superRefine((manifest, context) => {
    if (manifest.rowCount > manifest.pageCount * LANDSCAPE_ROWS_PER_LEG) {
        context.addIssue({
            code: 'custom',
            path: ['rowCount'],
            message: 'validation.issue.custom',
        });
    }
});
export type LandscapeReportManifest = z.infer<typeof landscapeReportManifestSchema>;
export const landscapeReportPageSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
    pageIndex: z.number().int().min(0).max(29),
    rows: z.array(landscapeReportRowSchema).min(1).max(100),
    rowCount: z.number().int().min(1).max(100),
    pageHash: sha256Hex,
})
    .strict()
    .refine((page) => page.rows.length === page.rowCount, {
    path: ['rowCount'],
    message: 'validation.issue.custom',
});
export const landscapeCheckpointSchema = z
    .object({
    accountId: objectIdHex,
    siteId: objectIdHex,
    runId: objectIdHex,
    competitorProfileId: profileUuid,
    leg: landscapeLegSchema,
    state: z.enum(['pending', 'dispatched', 'succeeded', 'failed']),
    attempt: z.union([z.literal(0), z.literal(1)]),
    cache: z.enum(['hit', 'miss']),
    dispatchMarkedAt: z.date().nullable(),
    safeErrorCode: inertPattern(64, /^[A-Z0-9_]+$/).nullable(),
    provenance: landscapeProvenanceSchema.nullable(),
    rows: legRowsSchema,
})
    .strict();
