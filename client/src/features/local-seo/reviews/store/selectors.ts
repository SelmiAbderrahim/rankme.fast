import type { RootState } from '@app/store';
import { initialReviewIntelligenceState } from './slice';

// The `localSeoReviews` reducer is lazy-injected right before the Reviews tab
// renders, but RTK only materializes the slice on the NEXT dispatched action —
// the first render still sees `state.localSeoReviews` as undefined. Every
// selector therefore falls back to the slice's own initial state.
const selectSlice = (state: RootState) => state.localSeoReviews ?? initialReviewIntelligenceState;

export const selectReviewSources = (state: RootState) => selectSlice(state).sources;
export const selectReviewSourcesStatus = (state: RootState) => selectSlice(state).sourcesStatus;
export const selectReviewSourcesError = (state: RootState) => selectSlice(state).sourcesError;
export const selectReviewSourceMutationStatus = (state: RootState) =>
  selectSlice(state).sourceMutationStatus;
export const selectReviewSourceMutationError = (state: RootState) =>
  selectSlice(state).sourceMutationError;
export const selectReviewSourceMutationErrorKind = (state: RootState) =>
  selectSlice(state).sourceMutationErrorKind;
export const selectReviewRuns = (state: RootState) => selectSlice(state).runs;
export const selectReviewRunsStatus = (state: RootState) => selectSlice(state).runsStatus;
export const selectReviewRunsError = (state: RootState) => selectSlice(state).runsError;
export const selectReviewRun = (state: RootState) => selectSlice(state).run;
export const selectReviewRunStatus = (state: RootState) => selectSlice(state).runStatus;
export const selectReviewRunError = (state: RootState) => selectSlice(state).runError;
export const selectReviewInventory = (state: RootState) => selectSlice(state).inventory;
export const selectReviewInventoryStatus = (state: RootState) => selectSlice(state).inventoryStatus;
export const selectReviewInventoryError = (state: RootState) => selectSlice(state).inventoryError;
export const selectReviewStats = (state: RootState) => selectSlice(state).stats;
export const selectReviewStatsStatus = (state: RootState) => selectSlice(state).statsStatus;
export const selectReviewStatsError = (state: RootState) => selectSlice(state).statsError;
export const selectReviewThemes = (state: RootState) => selectSlice(state).themes;
export const selectReviewThemesStatus = (state: RootState) => selectSlice(state).themesStatus;
export const selectReviewThemesError = (state: RootState) => selectSlice(state).themesError;
export const selectReviewPreview = (state: RootState) => selectSlice(state).preview;
export const selectReviewPreviewStatus = (state: RootState) => selectSlice(state).previewStatus;
export const selectReviewPreviewError = (state: RootState) => selectSlice(state).previewError;
export const selectReviewPreviewErrorKind = (state: RootState) =>
  selectSlice(state).previewErrorKind;
export const selectReviewSubmitStatus = (state: RootState) => selectSlice(state).submitStatus;
export const selectReviewSubmitError = (state: RootState) => selectSlice(state).submitError;
export const selectReviewSubmitErrorKind = (state: RootState) => selectSlice(state).submitErrorKind;
export const selectReviewLastSubmit = (state: RootState) => selectSlice(state).lastSubmit;
