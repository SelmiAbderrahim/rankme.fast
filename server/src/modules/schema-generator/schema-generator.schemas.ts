/**
 * Request schemas for the schema generator.
 *
 * SEC-INJECT / SEC-BOUND: every attacker-influenced field is zod-bounded here
 * before it reaches a Mongo query, the outbound fetch authority, or a stored
 * document. The pasted URL additionally goes through the shared
 * `safeUrlString` guard, which rejects credentials, encoded hosts and any
 * scheme other than `https:`.
 */
import { z } from 'zod';
import { safeUrlString } from '../../shared/security/input-guards.js';
import { EVIDENCE_SOURCES } from './evidence-sources.js';
import { SUPPORTED_SCHEMA_TYPES, USER_FACT_KINDS, type UserFactProperty } from './schema-types.registry.js';
const objectIdSchema = z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'validation.issue.invalidString');
/** Longest URL the pasted-URL path accepts before any DNS work happens. */
export const MAX_PAGE_URL_CHARS = 2048;
export const generationIdParamsSchema = z
    .object({ generationId: objectIdSchema })
    .strict();
export const sourcesQuerySchema = z.object({ siteId: objectIdSchema }).strict();
const pageUrlSchema = z.string().min(1).max(MAX_PAGE_URL_CHARS);
const generationBodyShape = {
    siteId: objectIdSchema,
    source: z.enum(EVIDENCE_SOURCES),
    pageUrl: pageUrlSchema,
    schemaType: z.enum(SUPPORTED_SCHEMA_TYPES),
    runId: objectIdSchema.optional(),
};
/**
 * The pasted-URL path gets the full SSRF-safe URL guard; the two stored paths
 * take the URL as a lookup key against documents this account already owns, so
 * they only need the length bound.
 */
const withSafeUrlForFetchPath = <T extends z.ZodType<{ source: string; pageUrl: string }>>(schema: T) => schema.superRefine((value: {
    source: string;
    pageUrl: string;
}, ctx: z.RefinementCtx) => {
    if (value.source !== 'url')
        return;
    const parsed = safeUrlString.safeParse(value.pageUrl);
    if (parsed.success)
        return;
    ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pageUrl'],
        message: 'validation.issue.invalidUrl',
    });
});
export const createGenerationBodySchema = withSafeUrlForFetchPath(z.object(generationBodyShape).strict());
export type CreateGenerationBody = z.infer<typeof createGenerationBodySchema>;
export const previewGenerationBodySchema = withSafeUrlForFetchPath(z
    .object({
    siteId: objectIdSchema,
    source: z.enum(EVIDENCE_SOURCES),
    pageUrl: pageUrlSchema,
    schemaType: z.enum(SUPPORTED_SCHEMA_TYPES).optional(),
})
    .strict());
export type PreviewGenerationBody = z.infer<typeof previewGenerationBodySchema>;
export const listGenerationsQuerySchema = z
    .object({
    siteId: objectIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
})
    .strict();
export type ListGenerationsQuery = z.infer<typeof listGenerationsQuerySchema>;
/** BCP 47 language tag (`en`, `pt-BR`, `zh-Hant-TW`). */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
/** ISO 8601 date, optionally with a time and offset. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const invalid = 'validation.issue.invalidString';
/**
 * Same ceilings as the matching crawled facts (`EVIDENCE_LIMITS` in
 * `evidence.ts`: title 300, meta description 500, language 16, meta date 64).
 * Literal here because this module loads inside the evidence module's import
 * cycle; `schema-generator.units.test.ts` pins the two in step.
 */
export const USER_FACT_LIMITS = { text: 300, longText: 500, language: 16, date: 64 } as const;
const USER_FACT_SCHEMAS = {
    text: z.string().trim().min(1, invalid).max(USER_FACT_LIMITS.text, invalid),
    longText: z.string().trim().min(1, invalid).max(USER_FACT_LIMITS.longText, invalid),
    language: z.string().trim().max(USER_FACT_LIMITS.language, invalid).regex(LANGUAGE_TAG, invalid),
    date: z
        .string()
        .trim()
        .max(USER_FACT_LIMITS.date, invalid)
        .regex(ISO_DATE, invalid)
        .refine((value) => !Number.isNaN(Date.parse(value)), invalid),
    url: safeUrlString,
} as const;
const userFact = (property: UserFactProperty) => USER_FACT_SCHEMAS[USER_FACT_KINDS[property]].optional();
const userFactsShape = {
    name: userFact('name'),
    headline: userFact('headline'),
    description: userFact('description'),
    inLanguage: userFact('inLanguage'),
    datePublished: userFact('datePublished'),
    dateModified: userFact('dateModified'),
    logo: userFact('logo'),
    image: userFact('image'),
    primaryImageOfPage: userFact('primaryImageOfPage'),
} satisfies Record<UserFactProperty, z.ZodTypeAny>;
/**
 * `POST /generations/:generationId/regenerate`: the facts the user supplies for
 * omitted properties. Every value is bounded and shape-checked here; whether the
 * property belongs to the stored type is checked by the service against the
 * registry.
 */
export const regenerateBodySchema = z
    .object({
    facts: z
        .object(userFactsShape)
        .strict()
        .refine((facts) => Object.values(facts).some((value) => value !== undefined), {
        message: invalid,
    }),
})
    .strict();
export type RegenerateBody = z.infer<typeof regenerateBodySchema>;
