import { z } from 'zod';
import { LINK_GAP_MAX_COMPETITORS } from './backlink-runs.model.js';
const objectIdHexSchema = z
    .string()
    .regex(/^[0-9a-f]{24}$/i, 'backlinks.errors.siteNotFound');
/**
 * The controller performs only the structural parse. Domain normalization is
 * deliberately deferred until after the site ownership lookup in the service.
 */
export const linkGapBodySchema = z
    .object({
    siteId: objectIdHexSchema,
    competitors: z
        .array(z.string().trim().min(1).max(269))
        .min(1)
        .max(LINK_GAP_MAX_COMPETITORS),
})
    .strict();
export const linkGapParamsSchema = z
    .object({ runId: objectIdHexSchema })
    .strict();
export type LinkGapBody = z.infer<typeof linkGapBodySchema>;
