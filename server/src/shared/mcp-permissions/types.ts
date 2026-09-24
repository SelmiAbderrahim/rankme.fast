/**
 * MCP permission shapes.
 *
 * One spec shape serves BOTH permission levels:
 *   - the account-level defaults stored by `modules/mcp-permissions`, and
 *   - the per-API-key `scopes` jsonb column on `api_keys`.
 *
 * A missing spec — or any missing field inside one — is PERMISSIVE: existing
 * API keys (null scopes) and accounts that never touched the settings tab
 * keep working exactly as before. Key scopes can only RESTRICT what the
 * account defaults allow, never widen (see `engine.ts`).
 */
import { z } from 'zod';
/**
 * Zod shape for a stored permission spec. `.strict()` so a malformed stored
 * blob (unknown keys, wrong types) fails parsing as a whole — callers treat
 * a failed parse as "no spec" (permissive) rather than half-applying it.
 */
export const mcpPermissionSpecSchema = z
    .object({
    /** Per-tool allow map. Missing tool name = allowed. */
    tools: z.record(z.string().min(1).max(64), z.boolean()).optional(),
    /** Site allow-list (Mongo ObjectId hex strings). Missing = all sites. */
    allowedSiteIds: z.array(z.string().min(1).max(64)).max(500).optional(),
    /** Whether spending tools (start_audit) may run. Missing = allowed. */
    allowSpend: z.boolean().optional(),
})
    .strict();
export type McpPermissionSpec = z.infer<typeof mcpPermissionSpecSchema>;
/** Fully-resolved permissions after intersecting account defaults ∩ key scopes. */
export interface EffectiveMcpPermissions {
    /** One entry per registry tool name — true = registered/callable. */
    tools: Record<string, boolean>;
    /** null = every owned site; otherwise the intersection allow-list. */
    allowedSiteIds: string[] | null;
    allowSpend: boolean;
}
/**
 * Parse a stored scopes blob (jsonb column / Mongo doc field). Malformed
 * values collapse to null — the permissive default — so a bad historical row
 * can never lock an integration out or, worse, half-apply.
 */
export function parseStoredScopes(value: unknown): McpPermissionSpec | null {
    if (value === null || value === undefined)
        return null;
    const parsed = mcpPermissionSpecSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
