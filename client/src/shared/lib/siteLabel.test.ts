import { describe, expect, it } from 'vitest';
import { siteLabel } from './siteLabel';

describe('siteLabel', () => {
  it('prefers the trimmed display name', () => {
    expect(siteLabel({ displayName: '  Shop  ', domain: 'shop.test' })).toBe('Shop');
  });

  it.each(['', '   ', null, undefined])('falls back to the domain for %j', (displayName) => {
    expect(siteLabel({ displayName, domain: 'shop.test' })).toBe('shop.test');
  });
});
