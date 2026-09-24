import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import { apiContextHeaders, resolveAbsoluteApiUrl } from '@shared/api/client';

/**
 * Better Auth browser client. Session state lives in an httpOnly cookie set
 * by the server — no tokens are ever stored client-side. The base URL derives
 * from the same env var as the REST client (rules/site-url-env-pattern.md);
 * Better Auth routes are mounted under `<api>/auth` on the server.
 */
/** Compatibility helper retained for the constructor-level URL unit test. */
export const resolveAuthBaseURL = (apiBase: string, location?: { origin: string }): string =>
  new URL(`${apiBase}/auth`, location ? location.origin : 'http://localhost').toString();

export const addAuthLocaleHeader = <T extends { headers: Headers }>(context: T): T => {
  for (const [name, value] of apiContextHeaders('/auth', { workspace: 'omit' })) {
    if (!context.headers.has(name)) context.headers.set(name, value);
  }
  return context;
};

export const authClient = createAuthClient({
  baseURL: resolveAbsoluteApiUrl('/auth'),
  fetchOptions: { onRequest: addAuthLocaleHeader },
  // Mirrors the server's `user.additionalFields` so `session.user.role` is
  // typed. `input: false` — the server owns role assignment, never the client.
  // `twoFactorClient` exposes `authClient.twoFactor.enable / disable /
  // verifyTotp / verifyBackupCode / getTotpUri / generateBackupCodes` and
  // routes the sign-in `twoFactorRedirect` response to `/two-factor` for the
  // challenge screen.
  plugins: [
    inferAdditionalFields({
      user: {
        role: { type: 'string', input: false },
        mustChangePassword: { type: 'boolean', input: false },
        provisionalAccount: { type: 'boolean', input: false },
      },
    }),
    twoFactorClient({ twoFactorPage: '/two-factor' }),
  ],
});
