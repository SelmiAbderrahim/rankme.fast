/**
 * Request-boundary zod schemas for the MCP permission settings routes.
 */
import { z } from 'zod';
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;
export const updateMcpPermissionsSchema = z
    .object({
    /** Per-tool allow map; names are validated against the MCP registry. */
    tools: z.record(z.string().min(1).max(64), z.boolean()).optional(),
    /** Owned-site allow-list. Empty = every owned site. */
    allowedSiteIds: z.array(z.string().regex(OBJECT_ID_HEX)).max(500).optional(),
    allowSpend: z.boolean().optional(),
})
    .strict();
export type UpdateMcpPermissionsInput = z.infer<typeof updateMcpPermissionsSchema>;
