import type { RootState } from '@app/store';
import { initialState } from './slice';
import type { BacklinkPullType } from '../types';

// The lazy-loaded 'backlinks' reducer is injected right before this tab's
// component renders, but RTK only materializes the slice into state on the
// NEXT dispatched action — the very first render still sees `state.backlinks`
// as undefined, so every selector must fall back to the slice's own initial
// state rather than assume the key exists.
const selectSlice = (state: RootState) => state.backlinks ?? initialState;

export const selectBacklinksSiteId = (state: RootState) => selectSlice(state).siteId;
export const selectSummary = (state: RootState) => selectSlice(state).summary;
export const selectList = (state: RootState) => selectSlice(state).list;
export const selectLoading = (state: RootState) => selectSlice(state).loading;
export const selectLoaded = (state: RootState) => selectSlice(state).loaded;
export const selectError = (state: RootState) => selectSlice(state).error;
export const selectCursor = (state: RootState) => selectSlice(state).cursor;
export const selectIsRefreshing = (state: RootState) =>
  selectSlice(state).isRefreshing;
export const selectCooldownUntil = (state: RootState) =>
  selectSlice(state).cooldownUntil;
export const selectRefreshError = (state: RootState) =>
  selectSlice(state).refreshError;
export const selectDeepPull = (type: BacklinkPullType) => (state: RootState) =>
  selectSlice(state).deepPulls[type];
export const selectGap = (state: RootState) => selectSlice(state).gap;
export const selectGapPreview = (state: RootState) => selectSlice(state).gap.preview;
