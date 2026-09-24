/**
 * Account MCP permission settings — read/replace business logic.
 *
 * The stored doc is converted to the shared `McpPermissionSpec` shape so the
 * permission engine (`shared/mcp-permissions`) consumes account defaults and
 * per-key scopes identically. Missing doc = null spec = fully permissive.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { HttpError } from '../../shared/utils/http-error.js';
import type { McpPermissionSpec } from '../../shared/mcp-permissions/index.js';
import { acquireSiteWorkLease, releaseSiteWorkLease, Site, type SiteWorkLease, } from '../sites/index.js';
import { McpPermissionSettings } from './mcp-permissions.model.js';
import type { UpdateMcpPermissionsInput } from './mcp-permissions.schema.js';
/** Wire DTO for GET/PUT — fully materialized, one entry per registry tool. */
export interface McpPermissionSettingsResponse {
    tools: Record<string, boolean>;
    /** Empty array = every owned site (the permissive default). */
    allowedSiteIds: string[];
    allowSpend: boolean;
}
/**
 * Read the account's stored spec, or null when the account never saved one.
 * Consumed by the MCP endpoint and the chat tool executor.
 */
export async function getAccountMcpSpec(accountId: string): Promise<McpPermissionSpec | null> {
    const doc = await McpPermissionSettings.findOne({ accountId }).lean();
    if (!doc)
        return null;
    const spec: McpPermissionSpec = {};
    // `.lean()` serializes the Map as a plain object keyed by tool name. An
    // empty map is the permissive default — omit it so the spec stays minimal.
    const toolEntries = doc.tools
        ? Object.entries(doc.tools as unknown as Record<string, boolean>)
        : [];
    if (toolEntries.length > 0)
        spec.tools = Object.fromEntries(toolEntries);
    if (doc.allowedSiteIds && doc.allowedSiteIds.length > 0) {
        spec.allowedSiteIds = doc.allowedSiteIds;
    }
    if (doc.allowSpend === false)
        spec.allowSpend = false;
    return spec;
}
function toResponse(spec: McpPermissionSpec | null, toolNames: readonly string[]): McpPermissionSettingsResponse {
    const tools: Record<string, boolean> = {};
    for (const name of toolNames)
        tools[name] = spec?.tools?.[name] ?? true;
    return {
        tools,
        allowedSiteIds: spec?.allowedSiteIds ?? [],
        allowSpend: spec?.allowSpend ?? true,
    };
}
export async function getMcpPermissionSettings(accountId: string, toolNames: readonly string[]): Promise<McpPermissionSettingsResponse> {
    return toResponse(await getAccountMcpSpec(accountId), toolNames);
}
/**
 * Shared spec-input validation (account defaults AND per-key scopes): tool
 * names must exist in the MCP registry; every site id must resolve to a site
 * the account owns (a stranger's id and a nonexistent id fail identically —
 * no existence oracle). Throws localized 400s.
 */
export async function assertValidMcpSpecInput(accountId: string, input: Pick<UpdateMcpPermissionsInput, 'tools' | 'allowedSiteIds'>, toolNames: readonly string[]): Promise<void> {
    const known = new Set(toolNames);
    for (const name of Object.keys(input.tools ?? {})) {
        if (!known.has(name)) {
            throw HttpError.badRequest({ code: 'MCP_PERMISSIONS_ERRORS_UNKNOWN_TOOL', messageKey: 'mcp.permissions.errors.unknownTool' });
        }
    }
    const siteIds = input.allowedSiteIds ?? [];
    if (siteIds.length > 0) {
        const owned = await Site.countDocuments({
            _id: { $in: siteIds.map((id) => new Types.ObjectId(id)) },
            accountId,
            deletionStartedAt: null,
        });
        if (owned !== new Set(siteIds).size) {
            throw HttpError.badRequest({ code: 'MCP_PERMISSIONS_ERRORS_INVALID_SITE', messageKey: 'mcp.permissions.errors.invalidSite' });
        }
    }
}
/**
 * Validate a permission spec, then hold every referenced Site lease through
 * the caller's durable write. Sorted acquisition prevents two multi-site
 * settings writes from taking the same leases in opposite orders; a deletion
 * claim that wins before any acquire maps to the same non-owned 400.
 */
export async function withValidMcpSpecSiteLeases<Result>(accountId: string, input: Pick<UpdateMcpPermissionsInput, 'tools' | 'allowedSiteIds'>, toolNames: readonly string[], ownerPrefix: string, work: () => Promise<Result>): Promise<Result> {
    await assertValidMcpSpecInput(accountId, input, toolNames);
    const siteIds = [...new Set(input.allowedSiteIds ?? [])].sort();
    const leases: SiteWorkLease[] = [];
    try {
        for (const siteId of siteIds) {
            const lease = await acquireSiteWorkLease({ accountId, siteId }, `${ownerPrefix}:${randomUUID()}`);
            if (!lease) {
                throw HttpError.badRequest({ code: 'MCP_PERMISSIONS_ERRORS_INVALID_SITE', messageKey: 'mcp.permissions.errors.invalidSite' });
            }
            leases.push(lease);
        }
        return await work();
    }
    finally {
        await Promise.all(leases.map((lease) => releaseSiteWorkLease(lease)));
    }
}
/** Replace the account's settings after validating the spec input. */
export async function updateMcpPermissionSettings(accountId: string, input: UpdateMcpPermissionsInput, toolNames: readonly string[]): Promise<McpPermissionSettingsResponse> {
    const siteIds = input.allowedSiteIds ?? [];
    return withValidMcpSpecSiteLeases(accountId, input, toolNames, 'mcp-permissions', async () => {
        await McpPermissionSettings.findOneAndUpdate({ accountId }, {
            $set: {
                tools: input.tools ?? {},
                allowedSiteIds: siteIds,
                allowSpend: input.allowSpend ?? true,
            },
        }, { upsert: true, new: true });
        return getMcpPermissionSettings(accountId, toolNames);
    });
}
