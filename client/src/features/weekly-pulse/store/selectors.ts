import type { RootState } from '@app/store';
import { initialState, type WeeklyPulseState } from './slice';

/** Lazy-inject safe selector — falls back to initialState when the slice is not yet mounted. */
function selectSlice(state: RootState): WeeklyPulseState {
  return (state as { weeklyPulse?: WeeklyPulseState }).weeklyPulse ?? initialState;
}

export const selectPulseState = (state: RootState) => selectSlice(state).state;
export const selectPulseStateLoading = (state: RootState) => selectSlice(state).stateLoading;
export const selectPulseStateError = (state: RootState) => selectSlice(state).stateError;

export const selectPulsePreview = (state: RootState) => selectSlice(state).preview;
export const selectPulsePreviewLoading = (state: RootState) => selectSlice(state).previewLoading;
export const selectPulsePreviewError = (state: RootState) => selectSlice(state).previewError;
export const selectPulsePreviewFetchedAt = (state: RootState) => selectSlice(state).previewFetchedAt;

export const selectPulseSaving = (state: RootState) => selectSlice(state).saving;
export const selectPulseSaveError = (state: RootState) => selectSlice(state).saveError;

export const selectPulseHistory = (state: RootState) => selectSlice(state).history;
export const selectPulseHistoryLoading = (state: RootState) => selectSlice(state).historyLoading;
export const selectPulseHistoryError = (state: RootState) => selectSlice(state).historyError;

export const selectSelectedPulseId = (state: RootState) => selectSlice(state).selectedPulseId;
export const selectPulseDetailFor =
  (pulseId: string | null) =>
  (state: RootState) => (pulseId ? selectSlice(state).detailByPulseId[pulseId] ?? null : null);
export const selectPulseDetailLoading = (state: RootState) => selectSlice(state).detailLoading;
export const selectPulseDetailError = (state: RootState) => selectSlice(state).detailError;

export const selectPulseGscAppearance = (state: RootState) => selectSlice(state).gscAppearance;
export const selectPulseGscLoading = (state: RootState) => selectSlice(state).gscLoading;
export const selectPulseGscError = (state: RootState) => selectSlice(state).gscError;
