/**
 * Pure MCP permission engine — no I/O.
 *
 * One shared engine filters BOTH consumers:
 *   - the MCP endpoint (bearer key → account defaults ∩ key scopes), and
 *   - the AI Assistant chat tool executor (cookie session → key spec null).
 *
 * Intersection semantics — key scopes can only RESTRICT, never widen:
 *   tool allowed   = (account allows it) && (key allows it)
 *   allowedSiteIds = intersection when both set; whichever is set otherwise;
 *                    null (= every owned site) when neither is set. An empty
 *                    stored list reads as "all sites" (the permissive default
 *                    a fresh multi-select produces), never as a lockout.
 *   allowSpend     = (account allows) && (key allows)
 * Missing spec / missing field = permissive.
 */
import { HttpError } from '../utils/http-error.js';
import type { EffectiveMcpPermissions, McpPermissionSpec } from './types.js';
/** Treat undefined AND empty lists as "all sites" (null). */
function normalizeSiteList(list: readonly string[] | undefined): string[] | null {
    if (!list || list.length === 0)
        return null;
    return [...list];
}
export function resolveEffectivePermissions(accountSpec: McpPermissionSpec | null | undefined, keySpec: McpPermissionSpec | null | undefined, toolNames: readonly string[]): EffectiveMcpPermissions {
    const tools: Record<string, boolean> = {};
    for (const name of toolNames) {
        tools[name] =
            (accountSpec?.tools?.[name] ?? true) && (keySpec?.tools?.[name] ?? true);
    }
    const accountSites = normalizeSiteList(accountSpec?.allowedSiteIds);
    const keySites = normalizeSiteList(keySpec?.allowedSiteIds);
    let allowedSiteIds: string[] | null;
    if (accountSites !== null && keySites !== null) {
        const keySet = new Set(keySites);
        allowedSiteIds = accountSites.filter((id) => keySet.has(id));
    }
    else {
        allowedSiteIds = accountSites ?? keySites ?? null;
    }
    const allowSpend = (accountSpec?.allowSpend ?? true) && (keySpec?.allowSpend ?? true);
    return { tools, allowedSiteIds, allowSpend };
}
/** True when the tool may be exposed/executed. Unknown names stay permissive. */
export function isToolAllowed(permissions: EffectiveMcpPermissions, toolName: string): boolean {
    return permissions.tools[toolName] ?? true;
}
/**
 * Throw the SAME not-found shape a non-owned site produces, so a blocked
 * site and a stranger's site are indistinguishable to the caller (no
 * existence oracle; mirrors rules/better-auth-integration 404-not-403).
 */
export function assertSiteAllowed(permissions: EffectiveMcpPermissions, siteId: string): void {
    if (permissions.allowedSiteIds === null)
        return;
    if (!permissions.allowedSiteIds.includes(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
}
/** Spending tools (start_audit; chat spends via the same handlers) gate. */
export function assertSpendAllowed(permissions: EffectiveMcpPermissions): void {
    if (!permissions.allowSpend) {
        throw HttpError.forbidden({ code: 'MCP_ERRORS_SPEND_NOT_ALLOWED', messageKey: 'mcp.errors.spendNotAllowed' });
    }
}
