import { describe, expect, it } from 'vitest';
import type { RootState } from '@app/store';
import type { PulseHistoryDetail } from '../types';
import { initialState, type WeeklyPulseState } from './slice';
import {
  selectPulseDetailError,
  selectPulseDetailFor,
  selectPulseDetailLoading,
  selectPulseGscAppearance,
  selectPulseGscError,
  selectPulseGscLoading,
  selectPulseHistory,
  selectPulseHistoryError,
  selectPulseHistoryLoading,
  selectPulsePreview,
  selectPulsePreviewError,
  selectPulsePreviewFetchedAt,
  selectPulsePreviewLoading,
  selectPulseSaveError,
  selectPulseSaving,
  selectPulseState,
  selectPulseStateError,
  selectPulseStateLoading,
  selectSelectedPulseId,
} from './selectors';

/**
 * The weeklyPulse slice is lazy-injected — every selector must fall back to
 * `initialState` when the slice is not mounted yet (see the lazy-slice
 * eager-reader class of bugs), and read the live values once it is.
 */

const detail: PulseHistoryDetail = {
  siteId: 's1',
  runId: 'run-1',
  isoWeek: '2026-W01',
  status: 'completed',
  projection: {
    header: {
      siteId: 's1',
      siteLabel: 'Example',
      isoWeek: '2026-W01',
      market: null,
      renderedAt: '2026-01-05T09:00:00.000Z',
    },
  } as unknown as PulseHistoryDetail['projection'],
  citationChanges: [],
};

const mounted: WeeklyPulseState = {
  ...initialState,
  siteId: 's1',
  stateLoading: true,
  stateError: { error: 'state-err' },
  previewLoading: true,
  previewError: { error: 'preview-err' },
  previewFetchedAt: '2026-01-05T09:00:00.000Z',
  saving: true,
  saveError: { error: 'save-err' },
  history: { siteId: 's1', runs: [], nextCursor: 'cur' },
  historyLoading: true,
  historyError: { error: 'history-err' },
  detailByPulseId: { 'run-1': detail },
  detailLoading: true,
  detailError: { error: 'detail-err' },
  gscAppearance: {
    status: 'available',
    window: { start: '2025-12-01', end: '2026-01-04', windowDays: 28 },
    rows: [],
    observationMeta: null,
  },
  gscLoading: true,
  gscError: { error: 'gsc-err', reconnectRequired: true },
  selectedPulseId: 'run-1',
};

const withSlice = { weeklyPulse: mounted } as unknown as RootState;
const withoutSlice = {} as unknown as RootState;

describe('weekly-pulse selectors (slice mounted)', () => {
  it('reads every slot from the mounted slice', () => {
    expect(selectPulseState(withSlice)).toBeNull();
    expect(selectPulseStateLoading(withSlice)).toBe(true);
    expect(selectPulseStateError(withSlice)).toEqual({ error: 'state-err' });
    expect(selectPulsePreview(withSlice)).toBeNull();
    expect(selectPulsePreviewLoading(withSlice)).toBe(true);
    expect(selectPulsePreviewError(withSlice)).toEqual({ error: 'preview-err' });
    expect(selectPulsePreviewFetchedAt(withSlice)).toBe('2026-01-05T09:00:00.000Z');
    expect(selectPulseSaving(withSlice)).toBe(true);
    expect(selectPulseSaveError(withSlice)).toEqual({ error: 'save-err' });
    expect(selectPulseHistory(withSlice)).toEqual({
      siteId: 's1',
      runs: [],
      nextCursor: 'cur',
    });
    expect(selectPulseHistoryLoading(withSlice)).toBe(true);
    expect(selectPulseHistoryError(withSlice)).toEqual({ error: 'history-err' });
    expect(selectSelectedPulseId(withSlice)).toBe('run-1');
    expect(selectPulseDetailLoading(withSlice)).toBe(true);
    expect(selectPulseDetailError(withSlice)).toEqual({ error: 'detail-err' });
    expect(selectPulseGscAppearance(withSlice)?.status).toBe('available');
    expect(selectPulseGscLoading(withSlice)).toBe(true);
    expect(selectPulseGscError(withSlice)).toEqual({
      error: 'gsc-err',
      reconnectRequired: true,
    });
  });

  it('selectPulseDetailFor returns the cached detail for a known pulse id', () => {
    expect(selectPulseDetailFor('run-1')(withSlice)).toEqual(detail);
  });

  it('selectPulseDetailFor returns null for an unknown pulse id', () => {
    expect(selectPulseDetailFor('missing')(withSlice)).toBeNull();
  });

  it('selectPulseDetailFor returns null for a null pulse id', () => {
    expect(selectPulseDetailFor(null)(withSlice)).toBeNull();
  });
});

describe('weekly-pulse selectors (slice not mounted)', () => {
  it('falls back to initialState instead of crashing', () => {
    expect(selectPulseState(withoutSlice)).toBeNull();
    expect(selectPulseStateLoading(withoutSlice)).toBe(false);
    expect(selectPulseStateError(withoutSlice)).toBeNull();
    expect(selectPulsePreview(withoutSlice)).toBeNull();
    expect(selectPulsePreviewLoading(withoutSlice)).toBe(false);
    expect(selectPulsePreviewError(withoutSlice)).toBeNull();
    expect(selectPulsePreviewFetchedAt(withoutSlice)).toBeNull();
    expect(selectPulseSaving(withoutSlice)).toBe(false);
    expect(selectPulseSaveError(withoutSlice)).toBeNull();
    expect(selectPulseHistory(withoutSlice)).toBeNull();
    expect(selectPulseHistoryLoading(withoutSlice)).toBe(false);
    expect(selectPulseHistoryError(withoutSlice)).toBeNull();
    expect(selectSelectedPulseId(withoutSlice)).toBeNull();
    expect(selectPulseDetailFor('run-1')(withoutSlice)).toBeNull();
    expect(selectPulseDetailLoading(withoutSlice)).toBe(false);
    expect(selectPulseDetailError(withoutSlice)).toBeNull();
    expect(selectPulseGscAppearance(withoutSlice)).toBeNull();
    expect(selectPulseGscLoading(withoutSlice)).toBe(false);
    expect(selectPulseGscError(withoutSlice)).toBeNull();
  });
});
