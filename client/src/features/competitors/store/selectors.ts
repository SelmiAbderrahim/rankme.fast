import type { RootState } from '@app/store';
import { initialState } from './slice';

// The lazy-loaded 'competitors' reducer is injected right before this tab's
// component renders, but RTK only materializes the slice into state on the
// NEXT dispatched action — the very first render still sees `state.competitors`
// as undefined, so every selector must fall back to the slice's own initial
// state rather than assume the key exists.
const selectSlice = (state: RootState) => state.competitors ?? initialState;

export const selectCompetitorsSiteId = (state: RootState) => selectSlice(state).siteId;
export const selectCompetitorsList = (state: RootState) => selectSlice(state).list;
export const selectIntersection = (state: RootState) =>
  selectSlice(state).intersection;
export const selectSelectedCompetitor = (state: RootState) =>
  selectSlice(state).selectedCompetitor;
export const selectLoading = (state: RootState) => selectSlice(state).loading;
export const selectLoaded = (state: RootState) => selectSlice(state).loaded;
export const selectIntersectionLoading = (state: RootState) =>
  selectSlice(state).intersectionLoading;
export const selectError = (state: RootState) => selectSlice(state).error;
export const selectIntersectionError = (state: RootState) =>
  selectSlice(state).intersectionError;
export const selectIsRefreshing = (state: RootState) =>
  selectSlice(state).isRefreshing;
export const selectCooldownUntil = (state: RootState) =>
  selectSlice(state).cooldownUntil;
export const selectRefreshError = (state: RootState) =>
  selectSlice(state).refreshError;
export const selectCompetitorIntelligence = (state: RootState) =>
  selectSlice(state).intelligence;
export const selectCompetitorProfiles = (state: RootState) =>
  selectSlice(state).intelligence.profiles;
export const selectCompetitorDiscovery = (state: RootState) =>
  selectSlice(state).intelligence.discovery;
export const selectLandscapeSelection = (state: RootState) =>
  selectSlice(state).intelligence.selectedProfileIds;
export const selectLandscapeRuns = (state: RootState) =>
  selectSlice(state).intelligence.runs;
export const selectLandscapeDetail = (state: RootState) =>
  selectSlice(state).intelligence.detail;
