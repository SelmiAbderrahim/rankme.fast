import { z } from 'zod';
// Zod boundary schemas for /api/keyword-research/*.
// Client cap: 50 phrases per request — DataForSEO accepts 1000 but the panel
// makes small, interactive lookups; anything larger belongs to a background
// batch (not implemented — noted in `/docs/keyword-research.<locale>.md`).
export const CLIENT_KEYWORD_LIMIT = 50;
const phraseSchema = z
    .string()
    .trim()
    .min(1, 'keywordResearch.errors.phraseRequired')
    .max(80, 'keywordResearch.errors.phraseTooLong');
const locationCodeSchema = z
    .number({ invalid_type_error: 'keywordResearch.errors.locationInvalid' })
    .int()
    .positive();
const languageCodeSchema = z
    .string()
    .trim()
    .min(2, 'keywordResearch.errors.languageInvalid')
    .max(10, 'keywordResearch.errors.languageInvalid');
export const metricsRequestSchema = z.object({
    keywords: z
        .array(phraseSchema)
        .min(1, 'keywordResearch.errors.keywordsRequired')
        .max(CLIENT_KEYWORD_LIMIT, 'keywordResearch.errors.tooManyKeywords'),
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
    // The client may mount the panel with a throwaway "probe" lookup. Probe
    // requests behave identically except they are excluded from the
    // research-history log.
    probe: z.boolean().optional().default(false),
});
export type MetricsRequest = z.infer<typeof metricsRequestSchema>;
export const relatedRequestSchema = z.object({
    keyword: phraseSchema,
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
});
export type RelatedRequest = z.infer<typeof relatedRequestSchema>;
// Search-intent classification — same phrase-list contract as /metrics.
export const intentRequestSchema = z.object({
    keywords: z
        .array(phraseSchema)
        .min(1, 'keywordResearch.errors.keywordsRequired')
        .max(CLIENT_KEYWORD_LIMIT, 'keywordResearch.errors.tooManyKeywords'),
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
});
export type IntentRequest = z.infer<typeof intentRequestSchema>;
// Keyword ideas from a single seed. `limit` is optional (service clamps 1..1000).
export const ideasRequestSchema = z.object({
    seed: phraseSchema,
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
    limit: z.number().int().positive().max(1000).optional(),
});
export type IdeasRequest = z.infer<typeof ideasRequestSchema>;
export const longTailRequestSchema = z.object({
    seed: phraseSchema,
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
});
export type LongTailRequest = z.infer<typeof longTailRequestSchema>;
// Research-history list — keyset cursor + bounded page size (mirrors the
// ranks `listKeywordsQuerySchema` contract).
export const historyQuerySchema = z.object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
// ---------------------------------------------------------------------------
// Keyword gap / overview / trends / preview
// ---------------------------------------------------------------------------
// Per-pair upper bound; also enforced in the service. Kept in
// sync there so a client hitting `overview` gets a symmetric ceiling.
export const GAP_COMPETITORS_MAX = 3;
export const OVERVIEW_PHRASE_MAX = 20;
export const TRENDS_PHRASE_MAX = 10;
// Domains are validated as lowercased FQDNs after zod normalization. We
// deliberately reject `http(s)://…` inputs — this endpoint accepts a bare
// domain (the whole `keyword-research` module is domain-scoped, not URL-scoped).
const domainSchema = z
    .string()
    .trim()
    .transform((value) => value.toLowerCase().replace(/\.$/, ''))
    .refine((v) => v.length >= 3 && v.length <= 253, {
    message: 'keywordResearch.errors.domainInvalid',
})
    .refine((v) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v), {
    message: 'keywordResearch.errors.domainInvalid',
});
// Shared refinement — dedupe competitors after normalization and reject the
// own domain in the competitor list. Applied both to the paid `gapRequestSchema`
// and inline to the `gap` arm of `previewRequestSchema`.
function refineGapCompetitors<T extends {
    ownDomain: string;
    competitors: string[];
}>(value: T, ctx: z.RefinementCtx): void {
    const seen = new Set<string>();
    for (const c of value.competitors) {
        if (seen.has(c)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['competitors'],
                message: 'keywordResearch.errors.competitorsDuplicate',
            });
            return;
        }
        seen.add(c);
    }
    if (seen.has(value.ownDomain)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['competitors'],
            message: 'keywordResearch.errors.gapDomainConflict',
        });
    }
}
const gapRequestObject = z.object({
    ownDomain: domainSchema,
    competitors: z
        .array(domainSchema)
        .min(1, 'keywordResearch.errors.competitorsRequired')
        .max(GAP_COMPETITORS_MAX, 'keywordResearch.errors.tooManyCompetitors'),
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
});
export const gapRequestSchema = gapRequestObject.superRefine(refineGapCompetitors);
export type GapRequest = z.infer<typeof gapRequestSchema>;
export const overviewRequestSchema = z.object({
    keywords: z
        .array(phraseSchema)
        .min(1, 'keywordResearch.errors.keywordsRequired')
        .max(OVERVIEW_PHRASE_MAX, 'keywordResearch.errors.tooManyKeywords'),
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
});
export type OverviewRequest = z.infer<typeof overviewRequestSchema>;
export const trendsRequestSchema = z.object({
    keywords: z
        .array(phraseSchema)
        .min(1, 'keywordResearch.errors.keywordsRequired')
        .max(TRENDS_PHRASE_MAX, 'keywordResearch.errors.tooManyKeywords'),
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
});
export type TrendsRequest = z.infer<typeof trendsRequestSchema>;
// Preview: a discriminated union over the three cached lookup operations.
// Preview NEVER calls a provider or writes to `keyword_research_history`.
// Each arm carries the same shape as its provider-backed counterpart plus a literal `operation`
// discriminator. The gap arm re-applies `refineGapCompetitors` post-parse.
const gapPreviewShape = gapRequestObject.extend({
    operation: z.literal('gap'),
});
const overviewPreviewShape = z.object({
    operation: z.literal('overview'),
    keywords: z
        .array(phraseSchema)
        .min(1, 'keywordResearch.errors.keywordsRequired')
        .max(OVERVIEW_PHRASE_MAX, 'keywordResearch.errors.tooManyKeywords'),
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
});
const trendsPreviewShape = z.object({
    operation: z.literal('trends'),
    keywords: z
        .array(phraseSchema)
        .min(1, 'keywordResearch.errors.keywordsRequired')
        .max(TRENDS_PHRASE_MAX, 'keywordResearch.errors.tooManyKeywords'),
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
});
export const previewRequestSchema = z
    .discriminatedUnion('operation', [
    gapPreviewShape,
    overviewPreviewShape,
    trendsPreviewShape,
])
    .superRefine((value, ctx) => {
    if (value.operation === 'gap') {
        refineGapCompetitors(value, ctx);
    }
});
export type PreviewRequest = z.infer<typeof previewRequestSchema>;
// ---------------------------------------------------------------------------
// Cited AI clustering pipeline
// ---------------------------------------------------------------------------
export const CLUSTER_PHRASE_MIN = 10;
export const CLUSTER_PHRASE_MAX = 200;
export const clusterRunRequestSchema = z.object({
    locationCode: locationCodeSchema,
    languageCode: languageCodeSchema,
    // 10–200 phrases The empty-after-normalize dropout in
    // `sortedNormalizedPhrases` is applied after parsing; here we validate the
    // wire-shape only.
    phrases: z
        .array(phraseSchema)
        .min(CLUSTER_PHRASE_MIN, 'keywordResearch.errors.keywordsRequired')
        .max(CLUSTER_PHRASE_MAX, 'keywordResearch.errors.tooManyKeywords'),
});
export type ClusterRunRequest = z.infer<typeof clusterRunRequestSchema>;
// Runs list — keyset pagination on (createdAt DESC, id DESC).
export const clusterListQuerySchema = z.object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ClusterListQuery = z.infer<typeof clusterListQuerySchema>;
export const runIdParamSchema = z.object({
    runId: z.string().regex(/^[a-f0-9]{64}$/, 'keywordResearch.errors.runIdInvalid'),
});
// ---------------------------------------------------------------------------
// Cluster decision routing
// ---------------------------------------------------------------------------
/** Bounded length matches the DB check constraint on the events table. */
export const DECISION_NOTE_MAX_LEN = 500;
export const DECISION_IDEMPOTENCY_KEY_MAX_LEN = 200;
export const runIdClusterIdParamSchema = z.object({
    runId: z.string().regex(/^[a-f0-9]{64}$/, 'keywordResearch.errors.runIdInvalid'),
    // Cluster ids are the 32-hex prefix of a sha256 (clustering pipeline
    // `slice(0, 32)`) — NOT the 64-hex run id shape.
    clusterId: z
        .string()
        .regex(/^[a-f0-9]{32}$/, 'keywordResearch.errors.clusterIdInvalid'),
});
// ---------------------------------------------------------------------------
// Keyword Trends (live exploration)
// ---------------------------------------------------------------------------
// Per-exploration keyword ceiling — matches the frozen numeric contract
// (1..5 phrases per unit).
export const TRENDS_EXPLORE_PHRASE_MAX = 5;
const trendsPhraseSchema = z
    .string()
    .trim()
    .min(1, 'keywordResearch.trends.errors.phraseRequired')
    .max(200, 'keywordResearch.trends.errors.phraseTooLong');
const trendsGeoSchema = z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(['us', 'gb', 'de', 'fr'], {
    errorMap: () => ({ message: 'keywordResearch.trends.errors.geoInvalid' }),
}));
const trendsLanguageSchema = z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z
    .string()
    .regex(/^[a-z]{2}$/, 'keywordResearch.trends.errors.languageInvalid'));
// Site id: 24-hex Mongo ObjectId (same shape as the decision schema uses).
const trendsSiteIdSchema = z
    .string()
    .regex(/^[a-f0-9]{24}$/, 'keywordResearch.trends.errors.siteIdInvalid');
export const trendsExploreRequestSchema = z.object({
    keywords: z
        .array(trendsPhraseSchema)
        .min(1, 'keywordResearch.trends.errors.keywordsRequired')
        .max(TRENDS_EXPLORE_PHRASE_MAX, 'keywordResearch.trends.errors.tooManyKeywords'),
    geo: trendsGeoSchema.optional(),
    language: trendsLanguageSchema.optional(),
    siteId: trendsSiteIdSchema.optional(),
});
export type TrendsExploreRequest = z.infer<typeof trendsExploreRequestSchema>;
// Preview request shares the exploration request contract
// verbatim (same 1..5 keyword bound, same optional geo/language, same
// site id). Preview NEVER calls a provider or writes a run row.
export const trendsExplorePreviewRequestSchema = trendsExploreRequestSchema;
export type TrendsExplorePreviewRequest = z.infer<typeof trendsExplorePreviewRequestSchema>;
// Cursor is a base64url'd `{ createdAt: iso, id: 24-hex }` — reuses the
// clustering-list convention. Kept generic here: the controller decodes.
export const trendsListQuerySchema = z.object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    siteId: trendsSiteIdSchema.optional(),
});
export type TrendsListQuery = z.infer<typeof trendsListQuerySchema>;
export const trendsRunIdParamSchema = z.object({
    runId: z
        .string()
        .regex(/^[a-f0-9]{24}$/, 'keywordResearch.trends.errors.runIdInvalid'),
});
export const decisionRequestSchema = z
    .object({
    kind: z.enum(['accepted', 'dismissed'], {
        required_error: 'keywordResearch.errors.decisionKindInvalid',
        invalid_type_error: 'keywordResearch.errors.decisionKindInvalid',
    }),
    idempotencyKey: z
        .string()
        .trim()
        .min(1, 'keywordResearch.errors.idempotencyKeyRequired')
        .max(DECISION_IDEMPOTENCY_KEY_MAX_LEN, 'keywordResearch.errors.idempotencyKeyTooLong'),
    // Bounded free-text — matches KEYWORD_CLUSTER_DECISION_NOTE_MAX_LEN.
    note: z
        .string()
        .trim()
        .max(DECISION_NOTE_MAX_LEN, 'keywordResearch.errors.noteTooLong')
        .optional(),
    // The Mongo Site model uses an ObjectId hex id (24 lowercase hex chars).
    siteId: z
        .string()
        .regex(/^[a-f0-9]{24}$/, 'keywordResearch.errors.siteIdInvalid')
        .optional(),
})
    .superRefine((value, ctx) => {
    if (value.kind === 'accepted' && !value.siteId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['siteId'],
            message: 'keywordResearch.errors.siteRequired',
        });
    }
    if (value.kind === 'dismissed' && value.siteId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['siteId'],
            message: 'keywordResearch.errors.siteNotAllowed',
        });
    }
});
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
