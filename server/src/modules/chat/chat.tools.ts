/**
 * Chat tool executor — adapts the MCP tool registry
 * into the `AiChatStreamInput.tools` set.
 *
 * Cookie-session surface → `keySpec = null`: effective permissions are the
 * account defaults alone. Disallowed tools are OMITTED entirely (the model
 * never sees them); site-allow-list and spend gates run INSIDE each tool via
 * the shared `McpToolContext.permissions`, and every result passes the
 * registry's denylist scan (`runTool` → `assertNoForbidden`) before it can
 * reach the stream or storage. `start_audit` delegates to the canonical
 * `startAuditForSite`.
 */
import type { SupportedLocale } from '../../shared/i18n/locales.js';
import { isToolAllowed, resolveEffectivePermissions, type EffectiveMcpPermissions, } from '../../shared/mcp-permissions/index.js';
import type { AiChatTool, AiJsonSchema } from '../../shared/providers/index.js';
import { MCP_TOOL_NAMES, resolveMcpToolDefinition, type McpToolName, } from '../mcp/index.js';
import { getAccountMcpSpec } from '../mcp-permissions/index.js';
import { ACTION_SOURCE_TYPES, ACTION_STATES, MAX_LIST_LIMIT, } from '../actions/index.js';
const OBJECT_ID_PATTERN = '^[0-9a-f]{24}$';
const objectIdProperty = { type: 'string', pattern: OBJECT_ID_PATTERN } as const;
const limitProperty = { type: 'integer', minimum: 1, maximum: 100 } as const;
function toolObject(properties: Readonly<Record<string, unknown>>, required: readonly string[]): AiJsonSchema {
    return { type: 'object', properties, required, additionalProperties: false };
}
/**
 * Hand-mirrored JSON Schemas for the model. The zod schemas in
 * `mcp.schema.ts` remain the enforcement boundary (every execute re-parses);
 * these only guide generation. `chat.tools.test.ts` pins property-name
 * parity against the zod shapes so the two can never drift silently.
 */
export const CHAT_TOOL_JSON_SCHEMAS: Readonly<Record<McpToolName, AiJsonSchema>> = {
    list_sites: toolObject({}, []),
    get_latest_audit_report: toolObject({ siteId: objectIdProperty }, ['siteId']),
    list_keywords: toolObject({ siteId: objectIdProperty, limit: limitProperty }, ['siteId']),
    get_rank_history: toolObject({
        siteId: objectIdProperty,
        from: { type: 'string' },
        to: { type: 'string' },
    }, ['siteId']),
    list_content_analyses: toolObject({
        siteId: objectIdProperty,
        limit: limitProperty,
        cursor: { type: 'string', minLength: 1, maxLength: 1024 },
    }, ['siteId']),
    get_content_analysis: toolObject({ analysisId: objectIdProperty }, ['analysisId']),
    start_audit: toolObject({
        siteId: objectIdProperty,
        pageCap: { type: 'integer', minimum: 1, maximum: 10000 },
    }, ['siteId']),
    get_audit_status: toolObject({ runId: objectIdProperty }, ['runId']),
    list_actions: toolObject({
        siteId: objectIdProperty,
        state: { type: 'array', items: { enum: [...ACTION_STATES] } },
        source: { type: 'array', items: { enum: [...ACTION_SOURCE_TYPES] } },
        severity: { type: 'array', items: { enum: ['critical', 'warning', 'info'] } },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_LIMIT },
        cursor: { type: 'string', pattern: '^\\d{1,9}$' },
    }, ['siteId']),
    set_action_state: toolObject({
        siteId: objectIdProperty,
        actionId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        state: { enum: [...ACTION_STATES] },
        expectedVersion: { type: 'integer', minimum: 0 },
        note: { type: 'string', maxLength: 2000 },
        clientKey: { type: 'string', minLength: 1, maxLength: 200 },
    }, ['siteId', 'actionId', 'state', 'expectedVersion']),
};
export interface ChatToolSet {
    tools: Record<string, AiChatTool>;
    permissions: EffectiveMcpPermissions;
}
export async function buildChatTools(accountId: string, locale: SupportedLocale, teamAllowedSiteIds: readonly string[] | null = null): Promise<ChatToolSet> {
    const accountSpec = await getAccountMcpSpec(accountId);
    const permissions = resolveEffectivePermissions(accountSpec, null, MCP_TOOL_NAMES);
    if (teamAllowedSiteIds !== null) {
        const teamSites = new Set(teamAllowedSiteIds);
        permissions.allowedSiteIds = permissions.allowedSiteIds === null
            ? [...teamAllowedSiteIds]
            : permissions.allowedSiteIds.filter((siteId) => teamSites.has(siteId));
    }
    const context = { accountId, locale, permissions };
    const tools: Record<string, AiChatTool> = {};
    for (const name of MCP_TOOL_NAMES) {
        if (!isToolAllowed(permissions, name))
            continue;
        const definition = resolveMcpToolDefinition(name, locale);
        tools[name] = {
            description: definition.description,
            jsonSchema: CHAT_TOOL_JSON_SCHEMAS[name],
            execute: async (args) => {
                // `runTool` inside every registry executor already converts thrown
                // permission/ownership errors into localized tool-error results and
                // denylist-scans the structured payload.
                const boundArgs = typeof args === 'object' && args !== null && !Array.isArray(args)
                    ? { ...(args as Record<string, unknown>), locale }
                    : { locale, invalidChatToolInput: args };
                const result = await definition.execute(boundArgs, context);
                return {
                    ok: result.isError !== true,
                    structuredContent: result.structuredContent,
                };
            },
        };
    }
    return { tools, permissions };
}
