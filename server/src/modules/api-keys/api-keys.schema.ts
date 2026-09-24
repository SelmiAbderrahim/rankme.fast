import { z } from 'zod';
import { mcpPermissionSpecSchema } from '../../shared/mcp-permissions/index.js';
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;
/**
 * Per-key MCP scope input — the same spec shape the
 * account defaults use, with site ids constrained to ObjectId hex at the
 * request boundary. Tool names + site ownership are validated in the
 * controller against the MCP registry / the account's sites.
 */
export const apiKeyScopesSchema = mcpPermissionSpecSchema.extend({
    allowedSiteIds: z.array(z.string().regex(OBJECT_ID_HEX)).max(500).optional(),
});
// Zod boundary schema for POST /api/api-keys.
export const createApiKeySchema = z.object({
    name: z.string().trim().min(1).max(60),
    scopes: apiKeyScopesSchema.optional(),
});
export type CreateApiKeyBody = z.infer<typeof createApiKeySchema>;
// Zod boundary schema for PATCH /api/api-keys/:id/scopes — replaces the
// stored scopes wholesale; `scopes: null` clears them (unscoped key).
export const patchApiKeyScopesSchema = z.object({
    scopes: apiKeyScopesSchema.nullable(),
});
export type PatchApiKeyScopesBody = z.infer<typeof patchApiKeyScopesSchema>;
