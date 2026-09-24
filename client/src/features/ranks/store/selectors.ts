import type { RootState } from '@app/store';

export const selectKeywords = (state: RootState) => state.ranks.items;
export const selectRanksSiteId = (state: RootState) => state.ranks.siteId;
export const selectRanksLoading = (state: RootState) => state.ranks.loading;
export const selectRanksLoaded = (state: RootState) => state.ranks.loaded;
export const selectRanksError = (state: RootState) => state.ranks.error;
export const selectRanksMessage = (state: RootState) => state.ranks.message;
export const selectNextCursor = (state: RootState) => state.ranks.nextCursor;
export const selectCursorStack = (state: RootState) => state.ranks.cursorStack;
export const selectAddingKeyword = (state: RootState) => state.ranks.adding;
export const selectAddKeywordError = (state: RootState) => state.ranks.addError;
export const selectRemovingId = (state: RootState) => state.ranks.removingId;
export const selectRemoveError = (state: RootState) => state.ranks.removeError;
export const selectCadence = (state: RootState) => state.ranks.cadence;
export const selectUpdatingCadence = (state: RootState) => state.ranks.updatingCadence;
export const selectCadenceError = (state: RootState) => state.ranks.cadenceError;
export const selectCheckingNow = (state: RootState) =>
  state.ranks.checkingNow && state.ranks.checkingKeywordId === null;
export const selectCheckingKeywordId = (state: RootState) => state.ranks.checkingKeywordId;
export const selectCheckCooldownUntil = (state: RootState) => state.ranks.checkCooldownUntil;
export const selectSelectedKeywordId = (state: RootState) => state.ranks.selectedKeywordId;
export const selectHistory = (state: RootState) => state.ranks.history;
export const selectHistoryKeywordId = (state: RootState) => state.ranks.historyKeywordId;
export const selectHistoryLoading = (state: RootState) => state.ranks.historyLoading;
export const selectHistoryError = (state: RootState) => state.ranks.historyError;

// SERP feature tracking
export const selectSerpFeatureRows = (state: RootState) => state.ranks.serpFeatureRows;
export const selectSerpFeaturesLoading = (state: RootState) =>
  state.ranks.serpFeaturesLoading;
export const selectSerpFeaturesLoaded = (state: RootState) =>
  state.ranks.serpFeaturesLoaded;
export const selectSerpFeaturesError = (state: RootState) =>
  state.ranks.serpFeaturesError;
export const selectSerpFeaturesDisabled = (state: RootState) =>
  state.ranks.serpFeaturesDisabled;
export const selectSerpFeatureCaptureEnabled = (state: RootState) =>
  state.ranks.serpFeatureCaptureEnabled;
export const selectSerpFeatureCaptureStatus = (state: RootState) =>
  state.ranks.serpFeatureCaptureStatus;
export const selectSerpFeatureDetail = (state: RootState) =>
  state.ranks.serpFeatureDetail;
export const selectSerpFeatureDetailLoading = (state: RootState) =>
  state.ranks.serpFeatureDetailLoading;
export const selectSerpFeatureDetailError = (state: RootState) =>
  state.ranks.serpFeatureDetailError;
