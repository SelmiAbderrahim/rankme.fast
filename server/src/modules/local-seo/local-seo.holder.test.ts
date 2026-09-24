import { afterEach, describe, expect, it } from 'vitest';
import {
  getLocalSeoCooldown,
  getLocalSeoDb,
  getLocalSeoProvider,
  getLocalSeoRankProvider,
  setLocalSeoCooldown,
  setLocalSeoDb,
  setLocalSeoProvider,
  setLocalSeoRankProvider,
} from './local-seo.holder.js';
import { createFakeLocalListingsProvider, createFakeRankProvider } from '../../shared/providers/index.js';

afterEach(() => {
  setLocalSeoDb(null);
  setLocalSeoProvider(null);
  setLocalSeoRankProvider(null);
  setLocalSeoCooldown(null);
});

describe('local seo holder', () => {
  it('throws when db not configured', () => {
    expect(() => getLocalSeoDb()).toThrow(/not configured/);
  });

  it('returns db once set', () => {
    const db = { probe: 'db' } as unknown as never;
    setLocalSeoDb(db);
    expect(getLocalSeoDb()).toBe(db);
  });

  it('throws when provider not configured', () => {
    expect(() => getLocalSeoProvider()).toThrow(/not configured/);
  });

  it('returns provider once set', () => {
    const p = createFakeLocalListingsProvider();
    setLocalSeoProvider(p);
    expect(getLocalSeoProvider()).toBe(p);
  });

  it('throws when rank provider not configured', () => {
    expect(() => getLocalSeoRankProvider()).toThrow(/not configured/);
  });

  it('returns rank provider once set', () => {
    const p = createFakeRankProvider();
    setLocalSeoRankProvider(p);
    expect(getLocalSeoRankProvider()).toBe(p);
  });

  it('lazily creates a default in-memory cooldown when none configured', () => {
    const cooldown = getLocalSeoCooldown();
    expect(cooldown).toBeDefined();
    // Second call returns the SAME lazily-created instance (memoized).
    expect(getLocalSeoCooldown()).toBe(cooldown);
  });

  it('returns the explicitly configured cooldown', () => {
    const cooldown = { assert: () => {}, touch: () => {} } as unknown as never;
    setLocalSeoCooldown(cooldown);
    expect(getLocalSeoCooldown()).toBe(cooldown);
  });
});
