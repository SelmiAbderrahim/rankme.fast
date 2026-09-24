import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import {
  BRAND_RADAR_SETTLED_STATUSES,
  initialBrandRadarDetailEntry,
  initialBrandRadarMentionEntry,
  isTerminalBrandRadarStatus,
  type BrandRadarDetailEntry,
  type BrandRadarMentionEntry,
  type BrandRadarRow,
  type BrandRadarScanDetail,
  type BrandRadarScanSummary,
  type BrandRadarState,
  type BrandRadarTrendPoint,
} from '../types';
import { initialBrandRadarState } from './slice';

/**
 * The `brandRadar` reducer is lazily injected right before this panel renders,
 * but RTK only materializes the slice on the NEXT dispatched action — the very
 * first render still sees `state.brandRadar` as undefined. Every selector
 * therefore falls back to the slice's own initial state (memory
 * `lazy-slice-eager-reader-class`).
 */
const selectSlice = (state: RootState): BrandRadarState =>
  state.brandRadar ?? initialBrandRadarState;

export const selectBrandRadarItems = (state: RootState) => selectSlice(state).items;
export const selectBrandRadarNextCursor = (state: RootState) =>
  selectSlice(state).nextCursor;
export const selectBrandRadarListStatus = (state: RootState) =>
  selectSlice(state).listStatus;
export const selectBrandRadarListError = (state: RootState) =>
  selectSlice(state).listError;
export const selectBrandRadarLoadingMore = (state: RootState) =>
  selectSlice(state).loadingMore;
export const selectBrandRadarOptimistic = (state: RootState) =>
  selectSlice(state).optimistic;
export const selectBrandRadarPreview = (state: RootState) => selectSlice(state).preview;
export const selectBrandRadarPreviewStatus = (state: RootState) =>
  selectSlice(state).previewStatus;
export const selectBrandRadarPreviewError = (state: RootState) =>
  selectSlice(state).previewError;
export const selectBrandRadarCreateStatus = (state: RootState) =>
  selectSlice(state).createStatus;
export const selectBrandRadarCreateError = (state: RootState) =>
  selectSlice(state).createError;

/** True once the server's kill switch refused a preview or a scan (503). */
export const selectBrandRadarUnavailable = (state: RootState) =>
  selectSlice(state).previewUnavailable || selectSlice(state).createUnavailable;

export const selectBrandRadarRows = createSelector(
  [selectBrandRadarItems, selectBrandRadarOptimistic],
  (items, optimistic): BrandRadarRow[] => {
    const rows: BrandRadarRow[] = items.map((item) => ({
      id: item.id,
      brandQuery: item.brandQuery,
      language: item.language,
      outputLocale: item.outputLocale,
      countryCode: item.countryCode,
      status: item.status,
      digestState: item.digestState,
      retainedRowCount: item.retainedRowCount,
      refundState: item.refund.state,
      createdAt: item.createdAt,
    }));
    if (!optimistic || rows.some((row) => row.id === optimistic.id)) return rows;
    return [
      {
        id: optimistic.id,
        brandQuery: optimistic.brandQuery,
        language: optimistic.language,
        outputLocale: optimistic.outputLocale,
        countryCode: optimistic.countryCode,
        status: optimistic.status,
        digestState: optimistic.digestState,
        retainedRowCount: null,
        refundState: 'none',
        createdAt: null,
      },
      ...rows,
    ];
  },
);

export const selectBrandRadarDetailEntry = (
  state: RootState,
  scanId: string,
): BrandRadarDetailEntry =>
  selectSlice(state).details[scanId] ?? initialBrandRadarDetailEntry;

export const selectBrandRadarMentionEntry = (
  state: RootState,
  scanId: string,
): BrandRadarMentionEntry =>
  selectSlice(state).mentions[scanId] ?? initialBrandRadarMentionEntry;

const SETTLED: readonly string[] = BRAND_RADAR_SETTLED_STATUSES;

/**
 * Scan-over-scan mention trend for the query behind `scanId`.
 *
 * The ONLY client-side computation in the detail view, and it is a re-sort:
 * settled scans sharing the query hash, oldest first, carrying the counts the
 * server already sent. The delta is the server's `trend.delta` and is attached
 * to the scan being viewed only — a delta is never re-derived here.
 */
export const buildBrandRadarTrendPoints = (
  items: readonly BrandRadarScanSummary[],
  detail: BrandRadarScanDetail | null,
): BrandRadarTrendPoint[] => {
  if (!detail) return [];
  return items
    .filter(
      (item) =>
        item.queryHash === detail.queryHash && SETTLED.includes(item.status),
    )
    .map((item) => ({
      scanId: item.id,
      capturedAt: item.terminalAt ?? item.createdAt,
      mentionCount: item.retainedRowCount,
      delta: item.id === detail.id ? (detail.trend?.delta ?? null) : null,
      isCurrent: item.id === detail.id,
    }))
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
};

/** True while at least one row can still change — the only reason to poll. */
export const selectBrandRadarHasPending = createSelector(
  [selectBrandRadarRows],
  (rows) => rows.some((row) => !isTerminalBrandRadarStatus(row.status)),
);
