import { describe, expect, it } from 'vitest';
import {
  authEntryHref,
  authSuccessHref,
  loginHrefForReturnTo,
  requiredPasswordChangeHref,
  safeTeamReturnTo,
  verifyEmailHref,
} from './intent';

describe('safe auth intent', () => {
  it('lands on the dashboard and ignores plan or billing query values', () => {
    expect(authSuccessHref('?plan=pro&interval=year&lng=ar')).toBe('/dashboard');
    expect(authSuccessHref(new URLSearchParams('plan=custom&config=sites%3A5'))).toBe('/dashboard');
  });

  it('builds unprefixed auth routes with an allowlisted locale', () => {
    expect(authEntryHref('/register', 'fr')).toBe('/register?lng=fr');
    expect(authEntryHref('/login', 'en')).toBe('/login');
  });

  it('keeps only an allowlisted locale on verification links', () => {
    expect(verifyEmailHref(
      '?plan=starter&interval=month&lng=de&redirect=https://evil.example&error=token',
    )).toBe('/verify-email?lng=de');
    expect(verifyEmailHref('?plan=pro&interval=javascript:alert(1)&lng=no')).toBe(
      '/verify-email',
    );
  });

  it('preserves only invitation return paths through sign-in and password replacement', () => {
    const accept = '/team/accept/abcdefghijklmnop';
    const reject = '/team/reject/abcdefghijklmnop';
    expect(safeTeamReturnTo(accept)).toBe(accept);
    expect(safeTeamReturnTo(reject)).toBe(reject);
    expect(authSuccessHref(`?returnTo=${encodeURIComponent(accept)}&redirect=https://evil.test`)).toBe(accept);
    expect(loginHrefForReturnTo(accept)).toBe(
      '/login?returnTo=%2Fteam%2Faccept%2Fabcdefghijklmnop',
    );
    expect(requiredPasswordChangeHref(reject)).toBe(
      '/team/change-password?returnTo=%2Fteam%2Freject%2Fabcdefghijklmnop',
    );
    for (const unsafe of ['/dashboard', '//evil.test', 'https://evil.test', '/team/accept/x']) {
      expect(safeTeamReturnTo(unsafe)).toBeNull();
      expect(loginHrefForReturnTo(unsafe)).toBe('/login');
    }
    expect(requiredPasswordChangeHref('/dashboard')).toBe('/team/change-password');
  });
});
