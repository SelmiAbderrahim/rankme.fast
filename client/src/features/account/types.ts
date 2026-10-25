/** Personal account tabs at /settings/profile. */
export const ACCOUNT_TABS = [
  'profile',
  'mcp',
  'api-keys',
  'privacy',
] as const;

export type AccountTab = (typeof ACCOUNT_TABS)[number];

export const LEGACY_ACCOUNT_TAB_REDIRECTS: Readonly<Record<string, string>> = {
  security: '/settings/security',
  notifications: '/settings/notifications',
  branding: '/settings/workspace',
};

/** Shape returned by `POST /api/legal/export` (a JSON copy of the account). */
export interface DataExport {
  account: Record<string, unknown>;
}
