export type NotificationChannel =
  | 'emailAuditComplete'
  | 'emailRankDrop'
  // Customer-configured alert rules get their own
  // opt-out so muting them never also mutes the courtesy rank-drop notice.
  | 'emailAlerts'
  | 'emailMarketing';

export type NotificationPreferences = Record<NotificationChannel, boolean>;

export interface NotificationPreferencesResponse {
  preferences: NotificationPreferences;
}

export interface NotificationState {
  preferences: NotificationPreferences | null;
  loading: boolean;
  loaded: boolean;
  loadError: string;
  saving: Partial<Record<NotificationChannel, boolean>>;
  saveError: string;
}

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  'emailAuditComplete',
  'emailRankDrop',
  'emailAlerts',
  'emailMarketing',
];

// ---------------------------------------------------------------------------
// API keys (?tab=api-keys) — workstream C
// ---------------------------------------------------------------------------

/** One row from GET /api/api-keys — never carries the key or its hash. */
export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** null = unrestricted; otherwise restrictions intersect account defaults. */
  scopes: McpPermissionSpec | null;
}

/** POST /api/api-keys response — `key` is shown once and never again. */
export interface CreatedApiKey extends Omit<ApiKeySummary, 'lastUsedAt' | 'revokedAt'> {
  key: string;
}

export interface ApiKeysListResponse {
  apiKeys: ApiKeySummary[];
}

export interface ApiKeyCreateResponse {
  apiKey: CreatedApiKey;
}

export interface ApiKeyRevokeResponse {
  message: string;
}

export interface ApiKeyScopesResponse {
  apiKey: ApiKeySummary;
}

// ---------------------------------------------------------------------------
// MCP account defaults + per-key restrictions (?tab=mcp / ?tab=api-keys)
// ---------------------------------------------------------------------------

/**
 * Mirror of the server registry's `MCP_TOOL_NAMES` (same order). The server
 * test `mcp.client-parity.test.ts` fails the build when the two drift.
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
  'list_keyword_research_history',
  'get_keyword_research_result',
  'get_ai_visibility_summary',
  'get_local_seo_summary',
  'get_reviews_summary',
  'list_client_reports',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/**
 * How the permissions form groups the tools. Every tool appears in exactly one
 * group (test-enforced); group labels live under `mcp.tools.groups.<id>`.
 */
export const MCP_TOOL_GROUPS = [
  { id: 'sites', tools: ['list_sites', 'get_latest_audit_report', 'start_audit', 'get_audit_status'] },
  { id: 'rankings', tools: ['list_keywords', 'get_rank_history'] },
  { id: 'content', tools: ['list_content_analyses', 'get_content_analysis'] },
  { id: 'actions', tools: ['list_actions', 'set_action_state'] },
  {
    id: 'search',
    tools: ['get_gsc_search_summary', 'list_gsc_top_queries', 'list_gsc_top_pages', 'get_ga4_summary'],
  },
  { id: 'pages', tools: ['list_pages', 'get_page_detail'] },
  { id: 'links', tools: ['get_backlinks_summary', 'list_backlinks', 'list_competitors'] },
  { id: 'research', tools: ['list_keyword_research_history', 'get_keyword_research_result'] },
  {
    id: 'visibility',
    tools: ['get_ai_visibility_summary', 'get_local_seo_summary', 'get_reviews_summary'],
  },
  { id: 'reports', tools: ['list_client_reports'] },
] as const satisfies ReadonlyArray<{ id: string; tools: readonly McpToolName[] }>;

/** Missing fields are permissive; key scopes only restrict account defaults. */
export interface McpPermissionSpec {
  tools?: Partial<Record<McpToolName, boolean>>;
  allowedSiteIds?: string[];
  allowSpend?: boolean;
}

/** Fully materialized wire shape returned by GET/PUT /mcp-permissions. */
export interface McpPermissionSettings {
  tools: Record<McpToolName, boolean>;
  allowedSiteIds: string[];
  allowSpend: boolean;
}

export interface McpPermissionsState {
  settings: McpPermissionSettings;
  loading: boolean;
  loaded: boolean;
  loadError: string;
  saving: boolean;
  saveError: string;
  saved: boolean;
}

// ---------------------------------------------------------------------------
// White-label PDF branding (?tab=branding) — workstream B
// ---------------------------------------------------------------------------

export interface Branding {
  companyName: string;
  /** `'#rrggbb'` or `''` (no custom accent). */
  accentColor: string;
  /** Server-normalized PNG data URL; null means no logo. */
  logoDataUrl: string | null;
}

export interface BrandingResponse {
  branding: Branding;
}

export interface BrandingState {
  branding: Branding;
  loading: boolean;
  loaded: boolean;
  loadError: string;
  saving: boolean;
  saveError: string;
  /** True right after a successful save — drives the confirmation line. */
  saved: boolean;
}

export interface ApiKeysState {
  keys: ApiKeySummary[];
  loading: boolean;
  loaded: boolean;
  loadError: string;
  creating: boolean;
  createError: string;
  /** The one-time full key from the last create — cleared on dialog close. */
  createdKey: CreatedApiKey | null;
  revokingId: string | null;
  revokeError: string;
  scopesSavingId: string | null;
  scopesError: string;
  message: string;
}
