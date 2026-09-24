/**
 * Double-submit CSRF helper for API-context mutations.
 *
 * Every cookie-authenticated mutation on the product chain is guarded by
 * `requireCsrf` (server/src/shared/middleware/csrf.ts): the client MUST
 * read `GET /api/security/csrf-token` (which sets the matching cookie on
 * this request context's jar) and echo the token in the `x-csrf-token`
 * header. Specs that drive mutations through `page.request` /
 * `context.request` instead of the rendered UI attach the header through
 * this helper — the browser UI path already does this via `apiClient`.
 *
 * The token endpoint rotates the cookie on every call, so fetch a fresh
 * token immediately before each mutation (never cache one across steps).
 */
import type { APIRequestContext } from '@playwright/test';

export async function csrfHeaders(
  request: APIRequestContext,
): Promise<{ 'x-csrf-token': string }> {
  const response = await request.get('/api/security/csrf-token');
  if (response.status() !== 200) {
    throw new Error(`csrf-token fetch failed with status ${response.status()}`);
  }
  const { csrfToken } = (await response.json()) as { csrfToken: string };
  return { 'x-csrf-token': csrfToken };
}
