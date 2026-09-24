import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { normalizedAppUrl, normalizedClientUrl } from './client-url.js';

describe('normalizedClientUrl', () => {
  const original = env.CLIENT_URL;
  const originalApp = env.APP_URL;
  afterEach(() => {
    (env as { CLIENT_URL: string }).CLIENT_URL = original;
    (env as { APP_URL: string }).APP_URL = originalApp;
  });

  it('strips a single trailing slash', () => {
    (env as { CLIENT_URL: string }).CLIENT_URL = 'https://example.com/';
    expect(normalizedClientUrl()).toBe('https://example.com');
  });

  it('passes through a URL without a trailing slash', () => {
    (env as { CLIENT_URL: string }).CLIENT_URL = 'https://example.com';
    expect(normalizedClientUrl()).toBe('https://example.com');
  });

  it('normalizes the authenticated app origin independently', () => {
    (env as { APP_URL: string }).APP_URL = 'https://app.example.com/';
    expect(normalizedAppUrl()).toBe('https://app.example.com');
  });
});
