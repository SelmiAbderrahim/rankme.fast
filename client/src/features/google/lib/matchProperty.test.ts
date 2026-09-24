import { describe, expect, it } from 'vitest';
import { matchPropertyForDomain, propertyCoversDomain } from './matchProperty';
import type { GscProperty } from '../types';

const prop = (siteUrl: string): GscProperty => ({
  siteUrl,
  permissionLevel: 'siteOwner',
});

describe('propertyCoversDomain', () => {
  it('covers via sc-domain exact match', () => {
    expect(propertyCoversDomain('example.com', 'sc-domain:example.com')).toBe(true);
  });

  it('covers via url-prefix hostname equality', () => {
    expect(propertyCoversDomain('example.com', 'https://example.com/')).toBe(true);
  });

  it('rejects a different domain and an unparseable siteUrl', () => {
    expect(propertyCoversDomain('example.com', 'sc-domain:other.example')).toBe(false);
    expect(propertyCoversDomain('example.com', 'https://other.example/')).toBe(false);
    expect(propertyCoversDomain('example.com', 'not a url')).toBe(false);
  });
});

describe('matchPropertyForDomain', () => {
  it('prefers sc-domain over url-prefix when both match', () => {
    const match = matchPropertyForDomain('example.com', [
      prop('https://example.com/'),
      prop('sc-domain:example.com'),
    ]);
    expect(match?.siteUrl).toBe('sc-domain:example.com');
  });

  it('falls back to url-prefix hostname match', () => {
    const match = matchPropertyForDomain('example.com', [
      prop('https://example.com/'),
    ]);
    expect(match?.siteUrl).toBe('https://example.com/');
  });

  it('returns null when no property covers the domain', () => {
    expect(
      matchPropertyForDomain('example.com', [prop('sc-domain:other.example')]),
    ).toBeNull();
  });
});
