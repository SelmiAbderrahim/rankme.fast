import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { __resetCsrfTokenCacheForTests } from '@shared/api/client';
import { __resetPresentationLocaleForTests } from '@shared/i18n/presentationLocale';
import { cancelAccountDeletion, deleteAccount, dismissTwoFactorRecommendation, fetchTwoFactorRecommendation } from './api';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const fakeResponse = (json: unknown, status = 200): Response =>
  ({
    ok: status < 400,
    status,
    headers: new Headers({
      'Content-Type': 'application/json',
      'Content-Language': 'en',
    }),
    json: async () => json,
    text: async () => '',
  }) as unknown as Response;

const requestPath = (input: unknown): string => {
  const url = String(input);
  return url.startsWith('http') ? new URL(url).pathname : url;
};

// The CSRF token cache is module-scoped with a TTL, so a token minted by an
// earlier test leaks into the next one — which then issues a single fetch and
// consumes the token mock as its response body.
beforeEach(() => {
  __resetPresentationLocaleForTests('en');
  __resetCsrfTokenCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('auth api', () => {
  it('reads the caller-scoped two-factor preference and sends a guarded dismissal', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(fakeResponse({ dismissedAt: null }))
      .mockResolvedValueOnce(fakeResponse({ csrfToken: 'tok' }))
      .mockResolvedValueOnce(fakeResponse({ dismissedAt: '2026-10-24T00:00:00Z' }));
    expect(await fetchTwoFactorRecommendation()).toEqual({ dismissedAt: null });
    expect(await dismissTwoFactorRecommendation()).toEqual({ dismissedAt: '2026-10-24T00:00:00Z' });
    expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/users/preferences/two-factor-recommendation');
    expect(requestPath(spy.mock.calls[2]![0])).toBe('/api/users/preferences/two-factor-recommendation');
    expect(spy.mock.calls[2]![1]?.method).toBe('PUT');
    expect((spy.mock.calls[2]![1]?.headers as Headers).get('x-csrf-token')).toBe('tok');
    expect((spy.mock.calls[2]![1]?.headers as Headers).has('x-workspace-id')).toBe(false);
  });
  it('deleteAccount posts to the legal endpoint with a CSRF token and returns the schedule', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(fakeResponse({ csrfToken: 'tok' }))
      .mockResolvedValueOnce(
        fakeResponse({ scheduledAt: 's', purgeAt: 'p', warningEmailQueued: true }, 202),
      );

    const result = await deleteAccount();

    expect(result).toEqual({ scheduledAt: 's', purgeAt: 'p', warningEmailQueued: true });
    // First fetch obtains the CSRF token; second is the guarded deletion.
    expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/security/csrf-token');
    expect(requestPath(spy.mock.calls[1]![0])).toBe('/api/legal/delete-account');
    expect(spy.mock.calls[1]![1]?.method).toBe('POST');
    expect((spy.mock.calls[1]![1]?.headers as Headers).get('x-csrf-token')).toBe('tok');
  });

  it('cancelAccountDeletion posts to the cancel endpoint with a CSRF token', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(fakeResponse({ csrfToken: 'tok' }))
      .mockResolvedValueOnce(fakeResponse({ cancelledAt: 'c' }));

    const result = await cancelAccountDeletion();

    expect(result).toEqual({ cancelledAt: 'c' });
    expect(requestPath(spy.mock.calls[0]![0])).toBe('/api/security/csrf-token');
    expect(requestPath(spy.mock.calls[1]![0])).toBe('/api/legal/cancel-account-deletion');
    expect(spy.mock.calls[1]![1]?.method).toBe('POST');
    expect((spy.mock.calls[1]![1]?.headers as Headers).get('x-csrf-token')).toBe('tok');
  });
});
