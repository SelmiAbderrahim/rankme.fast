import { z } from 'zod';
import { ACTION_SOURCE_TYPES, ACTION_STATES, } from '../../db/schema/action-events.js';
export const listActionsQuerySchema = z.object({
    state: z
        .union([
        z.enum(ACTION_STATES),
        z.array(z.enum(ACTION_STATES)).max(4),
    ])
        .optional(),
    source: z
        .union([
        z.enum(ACTION_SOURCE_TYPES),
        z.array(z.enum(ACTION_SOURCE_TYPES)).max(7),
    ])
        .optional(),
    severity: z
        .union([
        z.enum(['critical', 'warning', 'info']),
        z.array(z.enum(['critical', 'warning', 'info'])).max(3),
    ])
        .optional(),
    confidence: z
        .union([
        z.enum(['high', 'medium', 'low']),
        z.array(z.enum(['high', 'medium', 'low'])).max(3),
    ])
        .optional(),
    effort: z
        .union([
        z.enum(['low', 'medium', 'high']),
        z.array(z.enum(['low', 'medium', 'high'])).max(3),
    ])
        .optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    // Offset cursor minted by the server (`nextCursor`); digits only.
    cursor: z.string().regex(/^\d{1,9}$/).optional(),
});
export type ListActionsQuery = z.infer<typeof listActionsQuerySchema>;
export const actionIdParamsSchema = z.object({
    siteId: z.string().min(1),
    actionId: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ActionIdParams = z.infer<typeof actionIdParamsSchema>;
export const siteIdParamsSchema = z.object({
    siteId: z.string().min(1),
});
export type ActionsSiteIdParams = z.infer<typeof siteIdParamsSchema>;
export const mutateActionStateSchema = z.object({
    state: z.enum(ACTION_STATES),
    expectedVersion: z.number().int().min(0),
    note: z.string().max(2000).optional(),
    clientKey: z.string().min(1).max(200),
});
export type MutateActionStateBody = z.infer<typeof mutateActionStateSchema>;
export const retestActionBodySchema = z
    .object({
    clientKey: z.string().min(1).max(200).optional(),
})
    .default({});
export type RetestActionBody = z.infer<typeof retestActionBodySchema>;
