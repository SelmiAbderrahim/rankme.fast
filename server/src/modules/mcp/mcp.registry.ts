/**
 * MCP tool registry — the single authority on the
 * shipped tools: name → description, zod input shape, spend flag, executor.
 *
 * `buildMcpServer` iterates this instead of one hand-written `registerTool`
 * block per tool, and the AI Assistant chat executor
 * (`modules/chat/chat.tools.ts`) reuses the SAME entries so both surfaces
 * are filtered by one permission engine. Only `start_audit` spends;
 * `set_action_state` writes but costs nothing.
 *
 * Deliberately SDK-free: entries reference the pure tool fns + schemas, so
 * consumers outside `modules/mcp` (via `index.ts`) never touch the SDK.
 */
import type { z } from 'zod';
import { translate, type SupportedLocale } from '../../shared/i18n/index.js';
import { BEARER_DEFAULT_LOCALE } from '../../shared/middleware/bearer-language.js';
import { getAuditStatusInputSchema, getContentAnalysisInputSchema, getLatestAuditReportInputSchema, getRankHistoryInputSchema, listActionsInputSchema, listContentAnalysesInputSchema, listKeywordsInputSchema, listSitesInputSchema, setActionStateInputSchema, startAuditInputSchema, } from './mcp.schema.js';
import { toolGetAuditStatus, toolGetContentAnalysis, toolGetLatestAuditReport, toolGetRankHistory, toolListActions, toolListContentAnalyses, toolListKeywords, toolListSites, toolSetActionState, toolStartAudit, type McpToolContext, type McpToolResult, } from './mcp.tools.js';
export const MCP_TOOL_NAMES = [
    'list_sites',
    'get_latest_audit_report',
    'list_keywords',
    'get_rank_history',
    'list_content_analyses',
    'get_content_analysis',
    'start_audit',
    'get_audit_status',
    'list_actions',
    'set_action_state',
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
export type McpToolDescriptionKey = 'mcp.tools.listSites.description' | 'mcp.tools.getLatestAuditReport.description' | 'mcp.tools.listKeywords.description' | 'mcp.tools.getRankHistory.description' | 'mcp.tools.listContentAnalyses.description' | 'mcp.tools.getContentAnalysis.description' | 'mcp.tools.startAudit.description' | 'mcp.tools.getAuditStatus.description' | 'mcp.tools.listActions.description' | 'mcp.tools.setActionState.description';
export interface McpToolDefinition {
    /** Stable key for the request-local human description. */
    descriptionKey: McpToolDescriptionKey;
    /** English compatibility value for callers that have not adopted locale-aware resolution. */
    readonly description: string;
    /** Raw zod shape — what `McpServer.registerTool` expects as inputSchema. */
    inputShape: z.ZodRawShape;
    /** True when calling the tool consumes vendor budget (start_audit only). */
    spend: boolean;
    execute: (input: unknown, context: McpToolContext) => Promise<McpToolResult>;
}
function defineTool(descriptionKey: McpToolDescriptionKey, definition: Omit<McpToolDefinition, 'description' | 'descriptionKey'>): McpToolDefinition {
    return {
        descriptionKey,
        get description() {
            return translate(BEARER_DEFAULT_LOCALE, descriptionKey);
        },
        ...definition,
    };
}
export const MCP_TOOL_REGISTRY = {
    list_sites: defineTool('mcp.tools.listSites.description', {
        inputShape: listSitesInputSchema.shape,
        spend: false,
        execute: toolListSites,
    }),
    get_latest_audit_report: defineTool('mcp.tools.getLatestAuditReport.description', {
        inputShape: getLatestAuditReportInputSchema.shape,
        spend: false,
        execute: toolGetLatestAuditReport,
    }),
    list_keywords: defineTool('mcp.tools.listKeywords.description', {
        inputShape: listKeywordsInputSchema.shape,
        spend: false,
        execute: toolListKeywords,
    }),
    get_rank_history: defineTool('mcp.tools.getRankHistory.description', {
        inputShape: getRankHistoryInputSchema.shape,
        spend: false,
        execute: toolGetRankHistory,
    }),
    list_content_analyses: defineTool('mcp.tools.listContentAnalyses.description', {
        inputShape: listContentAnalysesInputSchema.shape,
        spend: false,
        execute: toolListContentAnalyses,
    }),
    get_content_analysis: defineTool('mcp.tools.getContentAnalysis.description', {
        inputShape: getContentAnalysisInputSchema.shape,
        spend: false,
        execute: toolGetContentAnalysis,
    }),
    start_audit: defineTool('mcp.tools.startAudit.description', {
        inputShape: startAuditInputSchema.shape,
        spend: true,
        execute: toolStartAudit,
    }),
    get_audit_status: defineTool('mcp.tools.getAuditStatus.description', {
        inputShape: getAuditStatusInputSchema.shape,
        spend: false,
        execute: toolGetAuditStatus,
    }),
    list_actions: defineTool('mcp.tools.listActions.description', {
        inputShape: listActionsInputSchema.shape,
        spend: false,
        execute: toolListActions,
    }),
    set_action_state: defineTool('mcp.tools.setActionState.description', {
        inputShape: setActionStateInputSchema.shape,
        spend: false,
        execute: toolSetActionState,
    }),
} as const satisfies Record<McpToolName, McpToolDefinition>;
export function resolveMcpToolDefinition(name: McpToolName, locale: SupportedLocale = BEARER_DEFAULT_LOCALE): McpToolDefinition {
    const definition = MCP_TOOL_REGISTRY[name];
    return {
        ...definition,
        description: translate(locale, definition.descriptionKey),
    };
}
