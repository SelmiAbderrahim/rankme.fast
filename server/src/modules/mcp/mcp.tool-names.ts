/**
 * Leaf module (no imports): the closed list of MCP/Assistant tool names.
 *
 * It lives apart from the registry so consumers inside an import cycle
 * (mcp-permissions, api-keys, the stored-read tool modules that reach back
 * into mcp-permissions) can read the names at module-evaluation time without
 * depending on the registry's evaluation order. `mcp/index.ts` exports it
 * first for the same reason. The registry's `satisfies Record<McpToolName, …>`
 * keeps this list and the executors in lockstep, and the server test
 * `mcp.client-parity.test.ts` pins the client's mirror list to it.
 */
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
  'get_gsc_search_summary',
  'list_gsc_top_queries',
  'list_gsc_top_pages',
  'get_ga4_summary',
  'list_pages',
  'get_page_detail',
  'get_backlinks_summary',
  'list_backlinks',
  'list_competitors',
  'get_ai_visibility_summary',
  'get_local_seo_summary',
  'get_reviews_summary',
  'list_client_reports',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
