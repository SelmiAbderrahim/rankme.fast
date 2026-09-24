/**
 * Zod schemas for Audience Research API routes.
 *
 * Wraps the core `audienceResearchInputSchema` with the URL-param /
 * query-string envelopes used by the 5 site-scoped endpoints. Every string
 * input reaching a Mongo query is bounded so an untyped body cannot smuggle
 * a regex/operator through.
 */
import { z } from 'zod';
import { audienceResearchInputSchema } from './audience-research.schemas.js';
/** Better Auth id shape (ObjectId-compatible 24-char hex). */
const objectIdHex = z
    .string()
    .regex(/^[0-9a-f]{24}$/, 'validation.issue.invalidString');
export const siteIdParamsSchema = z
    .object({ siteId: objectIdHex })
    .strict();
export const runIdParamsSchema = z
    .object({
    siteId: objectIdHex,
    runId: objectIdHex,
})
    .strict();
/**
 * Cursor-paginated list query. `limit` defaults to 20, capped at 50; the
 * cursor is an opaque HMAC string produced by `createPaginationCursorCodec`.
 */
export const listRunsQuerySchema = z
    .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(512).optional(),
})
    .strict();
/** POST /preview and POST /runs share the same input body. */
export const runInputBodySchema = audienceResearchInputSchema;
/**
 * Signal-decision endpoint. The signalId is not a Mongo id
 * (it is a nanoid-style opaque string minted by the clustering pipeline);
 * we bound the length so an untrusted body cannot smuggle a regex operator.
 */
export const signalIdParamsSchema = z
    .object({
    siteId: objectIdHex,
    runId: objectIdHex,
    signalId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9_.:-]+$/, 'validation.issue.invalidString'),
})
    .strict();
/**
 * Discriminated body for POST /decision.
 *   { decision: 'accepted', destination, idempotencyKey }
 *   { decision: 'dismissed', reason?, idempotencyKey }
 * The client NEVER sends evidence, confidence, priority, or action prose —
 * the server derives every non-idempotency field from the immutable
 * audience-research signal.
 */
export const decisionBodySchema = z.discriminatedUnion('decision', [
    z
        .object({
        decision: z.literal('accepted'),
        destination: z.enum(['content', 'comparison_page', 'product', 'seo']),
        idempotencyKey: z
            .string()
            .min(8)
            .max(128)
            .regex(/^[A-Za-z0-9_-]+$/, 'validation.issue.invalidString'),
    })
        .strict(),
    z
        .object({
        decision: z.literal('dismissed'),
        reason: z
            .enum([
            'not_relevant',
            'already_addressed',
            'low_confidence',
            'duplicate',
            'other',
        ])
            .optional(),
        idempotencyKey: z
            .string()
            .min(8)
            .max(128)
            .regex(/^[A-Za-z0-9_-]+$/, 'validation.issue.invalidString'),
    })
        .strict(),
]);
export type SiteIdParams = z.infer<typeof siteIdParamsSchema>;
export type RunIdParams = z.infer<typeof runIdParamsSchema>;
export type SignalIdParams = z.infer<typeof signalIdParamsSchema>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
export type RunInputBody = z.infer<typeof runInputBodySchema>;
export type DecisionBody = z.infer<typeof decisionBodySchema>;
