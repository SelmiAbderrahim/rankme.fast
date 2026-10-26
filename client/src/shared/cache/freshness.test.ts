import { describe, expect, it } from 'vitest';
import { CACHE_TTL_MS, isFresh, shouldLoad } from './freshness';

describe('bootstrap freshness', () => {
  it('uses bounded TTLs and rejects missing, expired, and future timestamps', () => {
    expect(CACHE_TTL_MS).toEqual({ sites: 60000, invitations: 60000, workspaces: 300000, pages: 60000, siteHealth: 60000 });
    expect(isFresh(null, 60, 100)).toBe(false);
    expect(isFresh(101, 60, 100)).toBe(false);
    expect(isFresh(40, 60, 100)).toBe(false);
    expect(isFresh(41, 60, 100)).toBe(true);
    expect(isFresh(100, 0, 100)).toBe(false);
  });
  it('force bypasses freshness but never duplicates an active read', () => {
    expect(shouldLoad({ loading: true, loadedAt: null }, { force: true }, 60, 100)).toBe(false);
    expect(shouldLoad({ loading: false, loadedAt: 100 }, { force: true }, 60, 100)).toBe(true);
    expect(shouldLoad({ loading: false, loadedAt: 100 }, undefined, 60, 100)).toBe(false);
    expect(shouldLoad({ loading: false, loadedAt: 90 }, { maxAgeMs: 10 }, 60, 100)).toBe(true);
    expect(shouldLoad({ loading: false, loadedAt: null }, {}, 60, 100)).toBe(true);
  });
});
