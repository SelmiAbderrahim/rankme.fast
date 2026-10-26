/**
 * MCP tool registry — the single authority on the
 * shipped tools: name → description, zod input shape, spend flag, executor.
 *
 * `buildMcpServer` iterates this instead of one hand-written `registerTool`
 * block per tool, and the AI Assistant chat executor
 * (`modules/chat/chat.tools.ts`) reuses the SAME entries so both surfaces
 * are filtered by one permission engine. Only `start_audit` spends;
 * `set_action_state` writes but costs nothing; the stored-data read tools
 * are read-only and never spend.
 *
 * Deliberately SDK-free: entries reference the pure tool fns + schemas, so
 * consumers outside `modules/mcp` (via `index.ts`) never touch the SDK.
 */
import type { z } from 'zod';
import { MCP_TOOL_NAMES, type McpToolName } from './mcp.tool-names.js';
import { translate, type SupportedLocale } from '../../shared/i18n/index.js';
import { BEARER_DEFAULT_LOCALE } from '../../shared/middleware/bearer-language.js';
import { getGscSearchSummaryInputSchema, listGscTopQueriesInputSchema, listGscTopPagesInputSchema, getGa4SummaryInputSchema, listPagesInputSchema, getPageDetailInputSchema, getBacklinksSummaryInputSchema, listBacklinksInputSchema, listCompetitorsInputSchema, listKeywordResearchHistoryInputSchema, getKeywordResearchResultInputSchema, getAiVisibilitySummaryInputSchema, getLocalSeoSummaryInputSchema, getReviewsSummaryInputSchema, listClientReportsInputSchema, } from './mcp.read-schemas.js';
import { toolGetGscSearchSummary, toolListGscTopQueries, toolListGscTopPages, toolGetGa4Summary, } from './mcp.tools.google.js';
import { toolListPages, toolGetPageDetail } from './mcp.tools.pages.js';
import { toolGetBacklinksSummary, toolListBacklinks } from './mcp.tools.backlinks.js';
import { toolListCompetitors } from './mcp.tools.competitors.js';
import { toolListKeywordResearchHistory, toolGetKeywordResearchResult } from './mcp.tools.keyword-research.js';
import { toolGetAiVisibilitySummary } from './mcp.tools.visibility.js';
import { toolGetLocalSeoSummary, toolGetReviewsSummary } from './mcp.tools.local.js';
import { toolListClientReports } from './mcp.tools.client-reports.js';
import { getAuditStatusInputSchema, getContentAnalysisInputSchema, getLatestAuditReportInputSchema, getRankHistoryInputSchema, listActionsInputSchema, listContentAnalysesInputSchema, listKeywordsInputSchema, listSitesInputSchema, setActionStateInputSchema, startAuditInputSchema, } from './mcp.schema.js';
import { toolGetAuditStatus, toolGetContentAnalysis, toolGetLatestAuditReport, toolGetRankHistory, toolListActions, toolListContentAnalyses, toolListKeywords, toolListSites, toolSetActionState, toolStartAudit, type McpToolContext, type McpToolResult, } from './mcp.tools.js';
export { MCP_TOOL_NAMES, type McpToolName };
export type McpToolDescriptionKey = 'mcp.tools.listSites.description' | 'mcp.tools.getLatestAuditReport.description' | 'mcp.tools.listKeywords.description' | 'mcp.tools.getRankHistory.description' | 'mcp.tools.listContentAnalyses.description' | 'mcp.tools.getContentAnalysis.description' | 'mcp.tools.startAudit.description' | 'mcp.tools.getAuditStatus.description' | 'mcp.tools.listActions.description' | 'mcp.tools.setActionState.description'
    | 'mcp.tools.getGscSearchSummary.description'
    | 'mcp.tools.listGscTopQueries.description'
    | 'mcp.tools.listGscTopPages.description'
    | 'mcp.tools.getGa4Summary.description'
    | 'mcp.tools.listPages.description'
    | 'mcp.tools.getPageDetail.description'
    | 'mcp.tools.getBacklinksSummary.description'
    | 'mcp.tools.listBacklinks.description'
    | 'mcp.tools.listCompetitors.description'
    | 'mcp.tools.listKeywordResearchHistory.description' | 'mcp.tools.getKeywordResearchResult.description' | 'mcp.tools.getAiVisibilitySummary.description'
    | 'mcp.tools.getLocalSeoSummary.description'
    | 'mcp.tools.getReviewsSummary.description'
    | 'mcp.tools.listClientReports.description';
export interface McpToolDefinition {
    /** Stable key for the request-local human description. */
    descriptionKey: McpToolDescriptionKey;
    /** English compatibility value for callers that have not adopted locale-aware resolution. */
    readonly description: string;
    /** Strict zod object — the enforcement boundary re-used by `validToolCall`. */
    inputSchema: z.ZodObject<z.ZodRawShape>;
    /** Raw zod shape — what `McpServer.registerTool` expects as inputSchema. */
    inputShape: z.ZodRawShape;
    /** True when calling the tool consumes vendor budget (start_audit only). */
    spend: boolean;
    execute: (input: unknown, context: McpToolContext) => Promise<McpToolResult>;
}
function defineTool(descriptionKey: McpToolDescriptionKey, definition: {
    inputSchema: z.ZodObject<z.ZodRawShape>;
    spend: boolean;
    execute: McpToolDefinition['execute'];
}): McpToolDefinition {
    return {
        descriptionKey,
        get description() {
            return translate(BEARER_DEFAULT_LOCALE, descriptionKey);
        },
        inputShape: definition.inputSchema.shape,
        ...definition,
    };
}
export const MCP_TOOL_REGISTRY = {
    list_sites: defineTool('mcp.tools.listSites.description', {
        inputSchema: listSitesInputSchema,
        spend: false,
        execute: toolListSites,
    }),
    get_latest_audit_report: defineTool('mcp.tools.getLatestAuditReport.description', {
        inputSchema: getLatestAuditReportInputSchema,
        spend: false,
        execute: toolGetLatestAuditReport,
    }),
    list_keywords: defineTool('mcp.tools.listKeywords.description', {
        inputSchema: listKeywordsInputSchema,
        spend: false,
        execute: toolListKeywords,
    }),
    get_rank_history: defineTool('mcp.tools.getRankHistory.description', {
        inputSchema: getRankHistoryInputSchema,
        spend: false,
        execute: toolGetRankHistory,
    }),
    list_content_analyses: defineTool('mcp.tools.listContentAnalyses.description', {
        inputSchema: listContentAnalysesInputSchema,
        spend: false,
        execute: toolListContentAnalyses,
    }),
    get_content_analysis: defineTool('mcp.tools.getContentAnalysis.description', {
        inputSchema: getContentAnalysisInputSchema,
        spend: false,
        execute: toolGetContentAnalysis,
    }),
    start_audit: defineTool('mcp.tools.startAudit.description', {
        inputSchema: startAuditInputSchema,
        spend: true,
        execute: toolStartAudit,
    }),
    get_audit_status: defineTool('mcp.tools.getAuditStatus.description', {
        inputSchema: getAuditStatusInputSchema,
        spend: false,
        execute: toolGetAuditStatus,
    }),
    list_actions: defineTool('mcp.tools.listActions.description', {
        inputSchema: listActionsInputSchema,
        spend: false,
        execute: toolListActions,
    }),
    set_action_state: defineTool('mcp.tools.setActionState.description', {
        inputSchema: setActionStateInputSchema,
        spend: false,
        execute: toolSetActionState,
    }),
    get_gsc_search_summary: defineTool('mcp.tools.getGscSearchSummary.description', {
        inputSchema: getGscSearchSummaryInputSchema,
        spend: false,
        execute: toolGetGscSearchSummary,
    }),
    list_gsc_top_queries: defineTool('mcp.tools.listGscTopQueries.description', {
        inputSchema: listGscTopQueriesInputSchema,
        spend: false,
        execute: toolListGscTopQueries,
    }),
    list_gsc_top_pages: defineTool('mcp.tools.listGscTopPages.description', {
        inputSchema: listGscTopPagesInputSchema,
        spend: false,
        execute: toolListGscTopPages,
    }),
    get_ga4_summary: defineTool('mcp.tools.getGa4Summary.description', {
        inputSchema: getGa4SummaryInputSchema,
        spend: false,
        execute: toolGetGa4Summary,
    }),
    list_pages: defineTool('mcp.tools.listPages.description', {
        inputSchema: listPagesInputSchema,
        spend: false,
        execute: toolListPages,
    }),
    get_page_detail: defineTool('mcp.tools.getPageDetail.description', {
        inputSchema: getPageDetailInputSchema,
        spend: false,
        execute: toolGetPageDetail,
    }),
    get_backlinks_summary: defineTool('mcp.tools.getBacklinksSummary.description', {
        inputSchema: getBacklinksSummaryInputSchema,
        spend: false,
        execute: toolGetBacklinksSummary,
    }),
    list_backlinks: defineTool('mcp.tools.listBacklinks.description', {
        inputSchema: listBacklinksInputSchema,
        spend: false,
        execute: toolListBacklinks,
    }),
    list_competitors: defineTool('mcp.tools.listCompetitors.description', {
        inputSchema: listCompetitorsInputSchema,
        spend: false,
        execute: toolListCompetitors,
    }),
    list_keyword_research_history: defineTool('mcp.tools.listKeywordResearchHistory.description', {
        inputSchema: listKeywordResearchHistoryInputSchema,
        spend: false,
        execute: toolListKeywordResearchHistory,
    }),
    get_keyword_research_result: defineTool('mcp.tools.getKeywordResearchResult.description', {
        inputSchema: getKeywordResearchResultInputSchema,
        spend: false,
        execute: toolGetKeywordResearchResult,
    }),
    get_ai_visibility_summary: defineTool('mcp.tools.getAiVisibilitySummary.description', {
        inputSchema: getAiVisibilitySummaryInputSchema,
        spend: false,
        execute: toolGetAiVisibilitySummary,
    }),
    get_local_seo_summary: defineTool('mcp.tools.getLocalSeoSummary.description', {
        inputSchema: getLocalSeoSummaryInputSchema,
        spend: false,
        execute: toolGetLocalSeoSummary,
    }),
    get_reviews_summary: defineTool('mcp.tools.getReviewsSummary.description', {
        inputSchema: getReviewsSummaryInputSchema,
        spend: false,
        execute: toolGetReviewsSummary,
    }),
    list_client_reports: defineTool('mcp.tools.listClientReports.description', {
        inputSchema: listClientReportsInputSchema,
        spend: false,
        execute: toolListClientReports,
    }),
} as const satisfies Record<McpToolName, McpToolDefinition>;
export function resolveMcpToolDefinition(name: McpToolName, locale: SupportedLocale = BEARER_DEFAULT_LOCALE): McpToolDefinition {
    const definition = MCP_TOOL_REGISTRY[name];
    return {
        ...definition,
        description: translate(locale, definition.descriptionKey),
    };
}
