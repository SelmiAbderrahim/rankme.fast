import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PAGES_COLUMNS_STORAGE_KEY,
  defaultPagesColumnVisibility,
  isPagesColumnAvailable,
  readPagesColumnOverrides,
  writePagesColumnOverrides,
} from './columns';
import { pagesSourceCapabilities } from './store/selectors';
import type { PagesEnvelope } from './types';

const envelope = (patch: Partial<PagesEnvelope> = {}): PagesEnvelope => ({
  source: 'dataforseo',
  fallbackReason: null,
  status: 'ready',
  comparison: { label: 'since_previous_sync', previousObservedAt: '2026-08-01T00:00:00.000Z' },
  coverage: { measuredPages: 3 },
  ...patch,
} as PagesEnvelope);

const capabilities = (source: PagesEnvelope['source'], measuredPages = 3) =>
  pagesSourceCapabilities({
    ...envelope({ source }),
    coverage: { measuredPages },
  } as PagesEnvelope);

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('Pages column defaults', () => {
  it('derives defaults from the source and coverage, never from the rows on screen', () => {
    const fallback = defaultPagesColumnVisibility(envelope(), capabilities('dataforseo'));
    expect(fallback).toMatchObject({
      source: true, crawl: true, insights: true,
      clicks: false, impressions: false, ctr: false,
      averagePosition: true, bestPosition: true, keywordCount: true,
      searchVolume: true, difficulty: true, estimatedTraffic: true,
      associatedQueryCount: true,
      positionChange: true,
    });
    const observed = defaultPagesColumnVisibility(envelope({ source: 'gsc' }), capabilities('gsc'));
    // A metric the source cannot own never shows by default.
    expect(observed).toMatchObject({ clicks: true, ctr: true, bestPosition: false, estimatedTraffic: false });
  });

  it('hides metrics when nothing is measured and the change column without a previous sync', () => {
    const none = defaultPagesColumnVisibility(
      envelope({ comparison: { label: 'since_previous_sync', previousObservedAt: null } }),
      capabilities('gsc', 0),
    );
    expect(none).toMatchObject({
      source: true, crawl: true, insights: true,
      clicks: false, averagePosition: false, associatedQueryCount: false, positionChange: false,
    });
  });

  it('knows which columns a source can fill', () => {
    expect(isPagesColumnAvailable('clicks', capabilities('gsc'))).toBe(true);
    expect(isPagesColumnAvailable('bestPosition', capabilities('gsc'))).toBe(false);
    expect(isPagesColumnAvailable('bestPosition', capabilities('demo'))).toBe(true);
    // Structural columns are always available.
    expect(isPagesColumnAvailable('source', capabilities('gsc'))).toBe(true);
    expect(isPagesColumnAvailable('positionChange', capabilities('none'))).toBe(true);
  });
});

describe('Pages column storage', () => {
  it('round-trips known boolean overrides and ignores anything else', () => {
    writePagesColumnOverrides({ clicks: false, bestPosition: true });
    expect(readPagesColumnOverrides()).toEqual({ clicks: false, bestPosition: true });
    window.localStorage.setItem(PAGES_COLUMNS_STORAGE_KEY, JSON.stringify({ clicks: 'yes', bogus: true, ctr: false }));
    expect(readPagesColumnOverrides()).toEqual({ ctr: false });
    writePagesColumnOverrides({});
    expect(window.localStorage.getItem(PAGES_COLUMNS_STORAGE_KEY)).toBeNull();
    expect(readPagesColumnOverrides()).toEqual({});
  });

  it.each(['not json', '[true]', 'null', '7'])('treats a corrupt stored value %s as no preference', (raw) => {
    window.localStorage.setItem(PAGES_COLUMNS_STORAGE_KEY, raw);
    expect(readPagesColumnOverrides()).toEqual({});
  });

  it('survives blocked or missing storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writePagesColumnOverrides({ clicks: false })).not.toThrow();

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!;
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get: () => { throw new Error('SecurityError'); },
      });
      expect(readPagesColumnOverrides()).toEqual({});
      expect(() => writePagesColumnOverrides({ clicks: true })).not.toThrow();
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
      expect(readPagesColumnOverrides()).toEqual({});
    } finally {
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });
});
