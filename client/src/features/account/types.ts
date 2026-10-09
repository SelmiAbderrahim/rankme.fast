/** Tabs on the /profile Account hub. Persisted in the `?tab=` query param. */
export const ACCOUNT_TABS = [
  'profile',
  'security',
  'notifications',
  'branding',
  'mcp',
  'api-keys',
  'privacy',
] as const;

export type AccountTab = (typeof ACCOUNT_TABS)[number];

/** Shape returned by `POST /api/legal/export` (a JSON copy of the account). */
export interface DataExport {
  account: Record<string, unknown>;
}
