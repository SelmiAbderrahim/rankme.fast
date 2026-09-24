import type { RootState } from '@app/store';
import { initialState } from './slice';

// The lazy-loaded 'keywordResearch' reducer is injected right before this tab's
// component renders, but RTK only materializes the slice into state on the
// NEXT dispatched action — the very first render still sees
// `state.keywordResearch` as undefined, so every selector must fall back to the
// slice's own initial state rather than assume the key exists.
const selectSlice = (state: RootState) => state.keywordResearch ?? initialState;

export const selectMetrics = (state: RootState) => selectSlice(state).metrics;
export const selectLoading = (state: RootState) => selectSlice(state).loading;
export const selectLoaded = (state: RootState) => selectSlice(state).loaded;
export const selectError = (state: RootState) => selectSlice(state).error;
export const selectExpanded = (state: RootState) =>
  selectSlice(state).expandedKeyword;
export const selectRelatedByKeyword = (state: RootState) =>
  selectSlice(state).relatedByKeyword;
export const selectRelatedLoading = (state: RootState) =>
  selectSlice(state).relatedLoading;
export const selectRelatedError = (state: RootState) =>
  selectSlice(state).relatedError;
export const selectAddToTrackingError = (state: RootState) =>
  selectSlice(state).addToTrackingError;
export const selectAddingToTrackingKeyword = (state: RootState) =>
  selectSlice(state).addingToTrackingKeyword;
export const selectIdeas = (state: RootState) => selectSlice(state).ideas;
export const selectIdeasLoading = (state: RootState) =>
  selectSlice(state).ideasLoading;
export const selectIdeasError = (state: RootState) =>
  selectSlice(state).ideasError;
export const selectIdeasSeed = (state: RootState) =>
  selectSlice(state).ideasSeed;
export const selectLongTail = (state: RootState) => selectSlice(state).longTail;
export const selectHistory = (state: RootState) => selectSlice(state).history;
export const selectHistoryLoading = (state: RootState) =>
  selectSlice(state).historyLoading;
export const selectHistoryLoaded = (state: RootState) =>
  selectSlice(state).historyLoaded;
export const selectHistoryError = (state: RootState) =>
  selectSlice(state).historyError;
export const selectHistoryCursor = (state: RootState) =>
  selectSlice(state).historyCursor;

// --- Workspace sub-state -----------------------------------------------

export const selectPreview = (state: RootState) => selectSlice(state).preview;
export const selectGap = (state: RootState) => selectSlice(state).gap;
export const selectOverview = (state: RootState) => selectSlice(state).overview;
export const selectTrends = (state: RootState) => selectSlice(state).trends;
export const selectClusters = (state: RootState) => selectSlice(state).clusters;
export const selectClusterDecision =
  (runId: string, clusterId: string) => (state: RootState) =>
    selectSlice(state).clusters.decisions[`${runId}:${clusterId}`];

// --- Live Keyword Trends selectors --------------------------------------

export const selectLiveTrends = (state: RootState) => selectSlice(state).liveTrends;
export const selectLiveTrendsPreview = (state: RootState) =>
  selectSlice(state).liveTrends.preview;
export const selectLiveTrendsRun = (state: RootState) =>
  selectSlice(state).liveTrends.run;
export const selectLiveTrendsList = (state: RootState) =>
  selectSlice(state).liveTrends.list;
export const selectLiveTrendsStoredRun = (state: RootState) =>
  selectSlice(state).liveTrends.storedRun;
