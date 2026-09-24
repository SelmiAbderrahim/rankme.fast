import type { RootState } from '@app/store';
import { initialState } from './slice';

// The lazy-loaded 'localSeo' reducer is injected right before this tab's
// component renders, but RTK only materializes the slice into state on the
// NEXT dispatched action — the very first render still sees `state.localSeo`
// as undefined, so every selector must fall back to the slice's own initial
// state rather than assume the key exists.
const selectSlice = (state: RootState) => state.localSeo ?? initialState;

export const selectLocalSeoSiteId = (state: RootState) => selectSlice(state).siteId;
export const selectLocalSeoSnapshot = (state: RootState) => selectSlice(state).snapshot;
export const selectLocalSeoLoading = (state: RootState) => selectSlice(state).loading;
export const selectLocalSeoLoaded = (state: RootState) => selectSlice(state).loaded;
export const selectLocalSeoError = (state: RootState) => selectSlice(state).error;
export const selectLocalSeoIsRefreshing = (state: RootState) =>
  selectSlice(state).isRefreshing;
export const selectLocalSeoCooldownUntil = (state: RootState) =>
  selectSlice(state).cooldownUntil;
export const selectLocalSeoRefreshError = (state: RootState) =>
  selectSlice(state).refreshError;
