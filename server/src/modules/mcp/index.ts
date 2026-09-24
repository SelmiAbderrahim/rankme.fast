/**
 * MCP module public API. The SDK dependency is confined here by
 * an ESLint no-restricted-imports rule — every consumer imports the router
 * and holders, never the SDK directly. See ./README.md for the boundary
 * rationale.
 */
// NOTE: the registry export MUST stay above the controller export — the
// controller participates in an import cycle with `modules/mcp-permissions`
// (controller → mcp-permissions → this index), and evaluating the registry
// first guarantees `MCP_TOOL_NAMES` is initialized when the cycle re-enters.
export { MCP_TOOL_NAMES, MCP_TOOL_REGISTRY, resolveMcpToolDefinition, type McpToolDefinition, type McpToolDescriptionKey, type McpToolName, } from './mcp.registry.js';
export { mcpRouter } from './mcp.routes.js';
export { mcpMethodNotAllowedHandler, mcpPostHandler, MCP_INPUT_SCHEMAS, } from './mcp.controller.js';
export { MCP_PAGE_LIMIT_DEFAULT, MCP_PAGE_LIMIT_MAX, listSitesInputSchema, getLatestAuditReportInputSchema, listKeywordsInputSchema, getRankHistoryInputSchema, listContentAnalysesInputSchema, getContentAnalysisInputSchema, startAuditInputSchema, getAuditStatusInputSchema, listActionsInputSchema, setActionStateInputSchema, } from './mcp.schema.js';
export { toolListSites, toolGetLatestAuditReport, toolListKeywords, toolGetRankHistory, toolListContentAnalyses, toolGetContentAnalysis, toolStartAudit, toolGetAuditStatus, toolListActions, toolSetActionState, resolveContextLocale, type McpToolResult, } from './mcp.tools.js';
export { getMcpDb, getMcpAuditsQueue } from './mcp.holder.js';
