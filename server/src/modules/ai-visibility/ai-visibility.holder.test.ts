import { afterEach, describe, expect, it } from 'vitest';
import {
  getAiVisibilityCooldown,
  getAiVisibilityDb,
  getAiVisibilityProvider,
  getAiVisibilitySummaryProvider,
  setAiVisibilityCooldown,
  setAiVisibilityDb,
  setAiVisibilityProvider,
  setAiVisibilitySummaryProvider,
} from './ai-visibility.holder.js';
import {
  createFakeAiVisibilityProvider,
  createFakeSummaryProvider,
} from '../../shared/providers/index.js';

afterEach(() => {
  setAiVisibilityDb(null);
  setAiVisibilityProvider(null);
  setAiVisibilitySummaryProvider(null);
  setAiVisibilityCooldown(null);
});

describe('ai visibility holder', () => {
  it('throws when db not configured', () => {
    expect(() => getAiVisibilityDb()).toThrow(/not configured/);
  });

  it('returns db once set', () => {
    const db = { probe: 'db' } as unknown as never;
    setAiVisibilityDb(db);
    expect(getAiVisibilityDb()).toBe(db);
  });

  it('throws when provider not configured', () => {
    expect(() => getAiVisibilityProvider()).toThrow(/not configured/);
  });

  it('returns provider once set', () => {
    const p = createFakeAiVisibilityProvider();
    setAiVisibilityProvider(p);
    expect(getAiVisibilityProvider()).toBe(p);
  });

  it('summary provider defaults to null and never throws', () => {
    expect(getAiVisibilitySummaryProvider()).toBeNull();
  });

  it('returns the summary provider once set, and null again after clearing', () => {
    const p = createFakeSummaryProvider();
    setAiVisibilitySummaryProvider(p);
    expect(getAiVisibilitySummaryProvider()).toBe(p);
    setAiVisibilitySummaryProvider(null);
    expect(getAiVisibilitySummaryProvider()).toBeNull();
  });

  it('lazily creates a default in-memory cooldown when none configured', () => {
    const cooldown = getAiVisibilityCooldown();
    expect(cooldown).toBeDefined();
    // Second call returns the SAME lazily-created instance (memoized).
    expect(getAiVisibilityCooldown()).toBe(cooldown);
  });

  it('returns the explicitly configured cooldown', () => {
    const cooldown = { assert: () => {}, touch: () => {}, clear: () => {} } as unknown as never;
    setAiVisibilityCooldown(cooldown);
    expect(getAiVisibilityCooldown()).toBe(cooldown);
  });
});
