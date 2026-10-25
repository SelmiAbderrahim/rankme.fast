/**
 * MCP module public API. The SDK dependency is confined here by
 * an ESLint no-restricted-imports rule — every consumer imports the router
 * and holders, never the SDK directly. See ./README.md for the boundary
 * rationale.
 */
// NOTE: the tool-names leaf export MUST stay first — the controller and the
// stored-read tool modules participate in import cycles with
// `modules/mcp-permissions` (… → mcp-permissions → this index), and the
// import-free leaf guarantees `MCP_TOOL_NAMES` is initialized whenever a cycle
// re-enters, whatever module the process loads first.
export { MCP_TOOL_NAMES, type McpToolName } from './mcp.tool-names.js';
export { MCP_TOOL_REGISTRY, resolveMcpToolDefinition, type McpToolDefinition, type McpToolDescriptionKey, } from './mcp.registry.js';
export { mcpRouter } from './mcp.routes.js';
export { mcpMethodNotAllowedHandler, mcpPostHandler, MCP_INPUT_SCHEMAS, } from './mcp.controller.js';
export { MCP_PAGE_LIMIT_DEFAULT, MCP_PAGE_LIMIT_MAX, listSitesInputSchema, getLatestAuditReportInputSchema, listKeywordsInputSchema, getRankHistoryInputSchema, listContentAnalysesInputSchema, getContentAnalysisInputSchema, startAuditInputSchema, getAuditStatusInputSchema, listActionsInputSchema, setActionStateInputSchema, } from './mcp.schema.js';
export { toolListSites, toolGetLatestAuditReport, toolListKeywords, toolGetRankHistory, toolListContentAnalyses, toolGetContentAnalysis, toolStartAudit, toolGetAuditStatus, toolListActions, toolSetActionState, resolveContextLocale, type McpToolResult, } from './mcp.tools.js';
export * from './mcp.read-schemas.js';
export { STORED_READ_MAX_BYTES, STORED_READ_REASONS, STORED_READ_ROW_LIMIT, boundPayload, clampRows, runAccountStoredRead, runSiteStoredRead, toPlainJson, type StoredReadOutcome, type StoredReadReason, } from './mcp.read-kit.js';
export { getMcpDb, getMcpAuditsQueue } from './mcp.holder.js';
