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

/** `GET /api/security/csrf-token` — double-submit token + Set-Cookie. */
export interface CsrfTokenResponse {
  csrfToken: string;
}

/** `POST /api/legal/delete-account` — 202 soft-delete schedule. */
export interface AccountDeletionResult {
  scheduledAt: string;
  purgeAt: string;
  warningEmailQueued: boolean;
}
