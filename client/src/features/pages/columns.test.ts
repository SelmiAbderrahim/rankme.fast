import { beforeEach, describe, expect, it } from 'vitest';
import { defaultPagesColumnVisibility, isPagesColumnAvailable, readPagesColumnOverrides, writePagesColumnOverrides, PAGES_COLUMNS_STORAGE_KEY } from './columns';
import { pagesSourceCapabilities } from './store/selectors';
import type { PagesEnvelope } from './types';

const envelope = (source: PagesEnvelope['source'], measuredPages: number): PagesEnvelope => ({
  source, status: 'ready', fallbackReason: null, observedAt: null, staleAt: null, range: '28d',
  rangeSemantics: source === 'gsc' ? 'rolling_window' : 'point_in_time',
  comparison: { label: 'since_previous_sync', previousObservedAt: '2026-08-01T00:00:00Z' }, market: null,
  coverage: { reportingLagDays: null, sampled: null, sourceRowsFetched: null, sourceRowsAccepted: 0,
    sourceRowsDropped: 0, dropped: { malformedUrl: 0, offsiteUrl: 0, duplicateUrl: 0, invalidMetric: 0 },
    sourceLimit: null, sourceTruncated: false, auditRowsFetched: 0, auditRowsAccepted: 0,
    auditRowsDropped: 0, auditTruncated: false, inventoryPages: 5, measuredPages, unmeasuredPages: 5 - measuredPages },
});

beforeEach(() => window.localStorage.clear());

describe('Pages columns', () => {
  it('defaults from source capability and full coverage, independent of visible rows', () => {
    const gsc = envelope('gsc', 3);
    const visibility = defaultPagesColumnVisibility(gsc, pagesSourceCapabilities(gsc));
    expect(visibility.clicks).toBe(true);
    expect(visibility.keywordCount).toBe(false);
    expect(visibility.associatedQueryCount).toBe(true);
    expect(isPagesColumnAvailable('estimatedTraffic', pagesSourceCapabilities(gsc))).toBe(false);
    const empty = envelope('gsc', 0);
    expect(defaultPagesColumnVisibility(empty, pagesSourceCapabilities(empty)).clicks).toBe(false);
  });

  it('keeps only known boolean overrides and survives unavailable storage data', () => {
    window.localStorage.setItem(PAGES_COLUMNS_STORAGE_KEY, '{bad');
    expect(readPagesColumnOverrides()).toEqual({});
    window.localStorage.setItem(PAGES_COLUMNS_STORAGE_KEY, JSON.stringify({ clicks: false, crawl: true, unknown: true, source: 'no' }));
    expect(readPagesColumnOverrides()).toEqual({ clicks: false, crawl: true });
    writePagesColumnOverrides({ clicks: false });
    expect(readPagesColumnOverrides()).toEqual({ clicks: false });
    writePagesColumnOverrides({});
    expect(window.localStorage.getItem(PAGES_COLUMNS_STORAGE_KEY)).toBeNull();
  });
});
