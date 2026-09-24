import { describe, expect, it } from 'vitest';
import { computeVendorCacheKey, stableStringify } from './cache-key.js';

describe('stableStringify', () => {
  it('is key-order invariant on objects', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('sorts nested object keys recursively', () => {
    const a = stableStringify({ outer: { x: 1, y: { b: 2, a: 1 } } });
    const b = stableStringify({ outer: { y: { a: 1, b: 2 }, x: 1 } });
    expect(a).toBe(b);
  });

  it('preserves array order — arrays are NOT sorted', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify(['a', 'b'])).toBe('["a","b"]');
  });

  it('serializes primitives like JSON.stringify', () => {
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(true)).toBe('true');
  });

  it('drops undefined-valued keys so optional params do not change the key', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe('computeVendorCacheKey', () => {
  const base = {
    capability: 'backlink',
    operation: 'summary',
    params: { domain: 'example.com' },
  } as const;

  it('produces a 64-char sha256 hex key', () => {
    expect(computeVendorCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across param key order', () => {
    const a = computeVendorCacheKey({
      capability: 'competitor',
      operation: 'list',
      params: { domain: 'example.com', locationCode: 2840, languageCode: 'en' },
    });
    const b = computeVendorCacheKey({
      capability: 'competitor',
      operation: 'list',
      params: { languageCode: 'en', locationCode: 2840, domain: 'example.com' },
    });
    expect(a).toBe(b);
  });

  it('changes when the capability changes', () => {
    const other = computeVendorCacheKey({ ...base, capability: 'competitor' });
    expect(other).not.toBe(computeVendorCacheKey(base));
  });

  it('changes when the operation changes', () => {
    const other = computeVendorCacheKey({ ...base, operation: 'list-first-page' });
    expect(other).not.toBe(computeVendorCacheKey(base));
  });

  it('changes when any param changes', () => {
    const other = computeVendorCacheKey({ ...base, params: { domain: 'other.com' } });
    expect(other).not.toBe(computeVendorCacheKey(base));
  });

  it('changes when an accountId is folded into params (private capabilities)', () => {
    const anonymous = computeVendorCacheKey({
      capability: 'gsc',
      operation: 'inspect-url',
      params: { inspectionUrl: 'https://example.com/' },
    });
    const scoped = computeVendorCacheKey({
      capability: 'gsc',
      operation: 'inspect-url',
      params: { inspectionUrl: 'https://example.com/', accountId: 'acc-1' },
    });
    expect(scoped).not.toBe(anonymous);
  });
});
