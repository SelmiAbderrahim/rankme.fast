import { afterEach, describe, expect, it, vi } from 'vitest';
import { appHref } from './appHref';

describe('appHref', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the configured authenticated-app origin', () => {
    vi.stubEnv('VITE_APP_URL', 'https://app.example.com/');
    expect(appHref('/dashboard?tab=overview')).toBe(
      'https://app.example.com/dashboard?tab=overview',
    );
  });

  it('falls back to a relative path for single-origin deployments', () => {
    vi.stubEnv('VITE_APP_URL', '');
    expect(appHref('dashboard')).toBe('/dashboard');
  });

  it('falls back to a relative path when the configured origin is malformed', () => {
    vi.stubEnv('VITE_APP_URL', ':// malformed');
    expect(appHref('//dashboard')).toBe('/dashboard');
  });
});
