import { apiClient } from '@shared/api/client';
import type { AccountDeletionResult, CsrfTokenResponse, DataExport } from './types';

/** GDPR data export — auth only, returns the account JSON blob. */
export const exportMyDataRequest = (): Promise<DataExport> =>
  apiClient<DataExport>('/legal/export', {
    method: 'POST',
    localeMode: 'artifact',
    allowLegacyNullContentLanguage: true,
  });

/**
 * Fetch a CSRF token before a cookie-authenticated mutating call. The GET also
 * sets the matching `x-csrf-token` cookie; the double-submit check compares the
 * two. See `server/src/shared/middleware/csrf.ts`.
 */
export const fetchCsrfToken = (): Promise<CsrfTokenResponse> =>
  apiClient<CsrfTokenResponse>('/security/csrf-token');

/** Schedule account deletion — CSRF-protected soft-delete (202). */
export const deleteAccountRequest = (
  csrfToken: string,
): Promise<AccountDeletionResult> =>
  apiClient<AccountDeletionResult>('/legal/delete-account', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
  });
