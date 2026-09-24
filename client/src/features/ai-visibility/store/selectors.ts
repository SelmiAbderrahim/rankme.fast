import type { RootState } from '@app/store';
import { initialState } from './slice';

// The lazy-loaded 'aiVisibility' reducer is injected right before this tab's
// component renders, but RTK only materializes the slice into state on the
// NEXT dispatched action — the very first render still sees `state.aiVisibility`
// as undefined, so every selector must fall back to the slice's own initial
// state rather than assume the key exists.
const selectSlice = (state: RootState) => state.aiVisibility ?? initialState;

export const selectAiVisibilitySiteId = (state: RootState) => selectSlice(state).siteId;
export const selectAiVisibilityOverview = (state: RootState) => selectSlice(state).overview;
export const selectAiVisibilitySuggestions = (state: RootState) => selectSlice(state).suggestions;
export const selectAiVisibilityLoading = (state: RootState) => selectSlice(state).loading;
export const selectAiVisibilityLoaded = (state: RootState) => selectSlice(state).loaded;
export const selectAiVisibilitySuggestionsLoading = (state: RootState) =>
  selectSlice(state).suggestionsLoading;
export const selectAiVisibilityError = (state: RootState) => selectSlice(state).error;
export const selectAiVisibilitySuggestionsError = (state: RootState) =>
  selectSlice(state).suggestionsError;
export const selectAiVisibilityRefreshing = (state: RootState) => selectSlice(state).isRefreshing;
export const selectAiVisibilityCooldownUntil = (state: RootState) =>
  selectSlice(state).cooldownUntil;
export const selectAiVisibilityRefreshError = (state: RootState) =>
  selectSlice(state).refreshError;
export const selectAiVisibilityAdding = (state: RootState) => selectSlice(state).adding;
export const selectAiVisibilityAddingAll = (state: RootState) => selectSlice(state).addingAll;
export const selectAiVisibilityRemovingId = (state: RootState) => selectSlice(state).removingId;
export const selectAiVisibilitySuggestionsGeneratedAt = (state: RootState) =>
  selectSlice(state).suggestionsGeneratedAt;
export const selectAiVisibilitySuggestionsOutputLocale = (state: RootState) =>
  selectSlice(state).suggestionsOutputLocale;
export const selectAiVisibilitySuggestionsGenerating = (state: RootState) =>
  selectSlice(state).suggestionsGenerating;
export const selectAiVisibilitySuggestionsCooldownUntil = (state: RootState) =>
  selectSlice(state).suggestionsCooldownUntil;
export const selectAiVisibilityTrend = (state: RootState) => selectSlice(state).trend;
export const selectAiVisibilityTrendLoading = (state: RootState) =>
  selectSlice(state).trendLoading;
export const selectAiVisibilityTrendError = (state: RootState) => selectSlice(state).trendError;
