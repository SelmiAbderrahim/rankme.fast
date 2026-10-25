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
export const selectLocalBusinessSetup = (state: RootState) => selectSlice(state).setup;
export const selectLocalBusinessSetupLoaded = (state: RootState) => selectSlice(state).setupLoaded;
export const selectLocalBusinessSetupError = (state: RootState) => selectSlice(state).setupError;
export const selectLocalBusinessSearching = (state: RootState) => selectSlice(state).searching;
export const selectLocalBusinessSearchError = (state: RootState) => selectSlice(state).searchError;
export const selectLocalBusinessSearched = (state: RootState) => selectSlice(state).searched;
export const selectLocalBusinessSelecting = (state: RootState) => selectSlice(state).selecting;
export const selectLocalBusinessSelectError = (state: RootState) => selectSlice(state).selectError;
