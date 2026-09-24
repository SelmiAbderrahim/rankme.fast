/**
 * Injectable-holder tests for the AI summary provider + db.
 * Mirrors the backlinks/keyword holder tests: null-first, swap-in, swap-back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getSummaryProvider, setSummaryProvider } from './summary.holder.js';
import { getSummaryDb, setSummaryDb } from './summary.db-holder.js';
import { createFakeSummaryProvider } from '../../shared/providers/summary/fakes.js';
import type { Db } from '../../db/client.js';

afterEach(() => {
  setSummaryProvider(null);
  setSummaryDb(null);
});

describe('summary provider holder', () => {
  it('defaults to null (feature disabled)', () => {
    setSummaryProvider(null);
    expect(getSummaryProvider()).toBeNull();
  });

  it('returns whatever provider was set', () => {
    const p = createFakeSummaryProvider();
    setSummaryProvider(p);
    expect(getSummaryProvider()).toBe(p);
    setSummaryProvider(null);
    expect(getSummaryProvider()).toBeNull();
  });
});

describe('summary db holder', () => {
  it('defaults to null', () => {
    setSummaryDb(null);
    expect(getSummaryDb()).toBeNull();
  });

  it('returns whatever db was set', () => {
    const fake = { __marker: true } as unknown as Db;
    setSummaryDb(fake);
    expect(getSummaryDb()).toBe(fake);
    setSummaryDb(null);
    expect(getSummaryDb()).toBeNull();
  });
});
