import { afterEach, describe, expect, it, vi } from 'vitest';
import { addAuthLocaleHeader, authClient, resolveAuthBaseURL } from './authClient';
import { setPresentationLocale, SUPPORTED_LOCALES } from '@shared/i18n';

afterEach(() => {
  vi.unstubAllEnvs();
  setPresentationLocale('en');
});

describe('resolveAuthBaseURL', () => {
  it('resolves a relative API base against the document origin', () => {
    expect(resolveAuthBaseURL('/api', { origin: 'https://rankme.example' })).toBe(
      'https://rankme.example/api/auth',
    );
  });

  it('keeps an absolute API base verbatim', () => {
    expect(resolveAuthBaseURL('http://api.internal:8080/api', { origin: 'https://x' })).toBe(
      'http://api.internal:8080/api/auth',
    );
  });

  it('falls back to an inert placeholder origin during SSR (no location)', () => {
    expect(resolveAuthBaseURL('/api', undefined)).toBe('http://localhost/api/auth');
  });
});

describe('authClient', () => {
  it('adds every supported locale to session, credential, OAuth, password, and two-factor calls', () => {
    const paths = [
      '/get-session',
      '/sign-in/email',
      '/sign-in/social',
      '/request-password-reset',
      '/two-factor/verify-totp',
    ];
    for (const locale of SUPPORTED_LOCALES) {
      setPresentationLocale(locale);
      for (const url of paths) {
        const context = addAuthLocaleHeader({ url, headers: new Headers() });
        expect(context.headers.get('x-lang')).toBe(locale);
        expect(context.headers.has('x-workspace-id')).toBe(false);
        expect(context.headers.has('Authorization')).toBe(false);
      }
    }
  });

  it('preserves an explicit Better Auth language header', () => {
    setPresentationLocale('ar');
    const headers = new Headers({ 'x-lang': 'de' });
    addAuthLocaleHeader({ headers });
    expect(headers.get('x-lang')).toBe('de');
  });

  it('exposes the Better Auth surface the feature relies on', () => {
    expect(typeof authClient.signIn.email).toBe('function');
    expect(typeof authClient.signIn.social).toBe('function');
    expect(typeof authClient.signUp.email).toBe('function');
    expect(typeof authClient.signOut).toBe('function');
    expect(typeof authClient.requestPasswordReset).toBe('function');
    expect(typeof authClient.resetPassword).toBe('function');
    expect(typeof authClient.sendVerificationEmail).toBe('function');
    expect(typeof authClient.useSession).toBe('function');
  });

  it('initializes with /api when VITE_API_BASE_URL is absent at module load', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE_URL', undefined);
    const fresh = await import('./authClient');
    expect(typeof fresh.authClient.useSession).toBe('function');
  });
});
