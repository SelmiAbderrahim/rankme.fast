import { describe, expect, it } from 'vitest';
import { normalizeApiBaseUrl } from './base-url';

describe('normalizeApiBaseUrl', () => {
  it('uses and trims the relative default', () => {
    expect(normalizeApiBaseUrl(undefined, undefined, undefined)).toBe('/api');
    expect(normalizeApiBaseUrl('/api///', 'https://site.test', undefined)).toBe('/api');
  });

  it('uses the same-origin API path behind alternate composed and split-app origins', () => {
    expect(
      normalizeApiBaseUrl(
        'https://site.test/api/',
        'https://site.test',
        'http://127.0.0.1:3000',
      ),
    ).toBe('/api');
    expect(
      normalizeApiBaseUrl(
        'https://site.test/api?version=1',
        'https://site.test',
        'http://localhost:3000',
      ),
    ).toBe('/api?version=1');
    expect(
      normalizeApiBaseUrl(
        'https://site.test/api',
        'https://site.test',
        'https://app.site.test',
      ),
    ).toBe('/api');
  });

  it('retains absolute URLs at the configured origin or for a separate API host', () => {
    expect(
      normalizeApiBaseUrl(
        'https://site.test/api',
        'https://site.test',
        'https://site.test',
      ),
    ).toBe('https://site.test/api');
    expect(
      normalizeApiBaseUrl(
        'https://api.site.test/api',
        'https://site.test',
        'http://localhost:3000',
      ),
    ).toBe('https://api.site.test/api');
  });

  it('leaves a malformed configured site or browser origin untouched', () => {
    expect(normalizeApiBaseUrl('https://site.test/api', 'not a url', 'also bad')).toBe(
      'https://site.test/api',
    );
  });
});
