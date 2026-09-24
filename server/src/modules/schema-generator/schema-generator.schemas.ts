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
import { EVIDENCE_SOURCES } from './evidence.js';
import { SUPPORTED_SCHEMA_TYPES } from './schema-types.registry.js';
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
const withSafeUrlForFetchPath = <T extends z.ZodTypeAny>(schema: T) => schema.superRefine((value: {
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
