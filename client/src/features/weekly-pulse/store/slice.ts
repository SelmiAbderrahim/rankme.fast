import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  GscGenerativeAppearanceRead,
  PulseHistoryDetail,
  PulseHistoryPage,
  PulseStateView,
  SpendPreview,
} from '../types';
import {
  fetchGenerativeAppearance,
  fetchWeeklyPulseDetail,
  fetchWeeklyPulseHistory,
  fetchWeeklyPulseState,
  previewWeeklyPulseSpend,
  setSubscription,
  type RejectPayload,
} from './thunks';

export interface WeeklyPulseState {
  siteId: string | null;
  state: PulseStateView | null;
  stateLoading: boolean;
  stateError: RejectPayload | null;

  preview: SpendPreview | null;
  previewLoading: boolean;
  previewError: RejectPayload | null;
  previewFetchedAt: string | null;

  saving: boolean;
  saveError: RejectPayload | null;

  history: PulseHistoryPage | null;
  historyLoading: boolean;
  historyError: RejectPayload | null;

  detailByPulseId: Record<string, PulseHistoryDetail>;
  detailLoading: boolean;
  detailError: RejectPayload | null;

  gscAppearance: GscGenerativeAppearanceRead | null;
  gscLoading: boolean;
  gscError: RejectPayload | null;

  selectedPulseId: string | null;
}

export const initialState: WeeklyPulseState = {
  siteId: null,
  state: null,
  stateLoading: false,
  stateError: null,
  preview: null,
  previewLoading: false,
  previewError: null,
  previewFetchedAt: null,
  saving: false,
  saveError: null,
  history: null,
  historyLoading: false,
  historyError: null,
  detailByPulseId: {},
  detailLoading: false,
  detailError: null,
  gscAppearance: null,
  gscLoading: false,
  gscError: null,
  selectedPulseId: null,
};

const slice = createSlice({
  name: 'weeklyPulse',
  initialState,
  reducers: {
    resetWeeklyPulse: () => initialState,
    setSelectedPulseId(state, action: PayloadAction<string | null>) {
      state.selectedPulseId = action.payload;
    },
    clearSaveError(state) {
      state.saveError = null;
    },
    clearPreview(state) {
      state.preview = null;
      state.previewFetchedAt = null;
      state.previewError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWeeklyPulseState.pending, (state, action) => {
        state.stateLoading = true;
        state.stateError = null;
        state.siteId = action.meta.arg.siteId;
      })
      .addCase(fetchWeeklyPulseState.fulfilled, (state, action) => {
        state.stateLoading = false;
        state.state = action.payload;
      })
      .addCase(fetchWeeklyPulseState.rejected, (state, action) => {
        state.stateLoading = false;
        state.stateError = action.payload ?? { error: action.error.message ?? 'unknown' };
      })

      .addCase(previewWeeklyPulseSpend.pending, (state) => {
        state.previewLoading = true;
        state.previewError = null;
      })
      .addCase(previewWeeklyPulseSpend.fulfilled, (state, action) => {
        state.previewLoading = false;
        state.preview = action.payload;
        state.previewFetchedAt = new Date().toISOString();
      })
      .addCase(previewWeeklyPulseSpend.rejected, (state, action) => {
        state.previewLoading = false;
        state.previewError = action.payload ?? { error: action.error.message ?? 'unknown' };
      })

      .addCase(setSubscription.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(setSubscription.fulfilled, (state, action) => {
        state.saving = false;
        state.state = action.payload;
      })
      .addCase(setSubscription.rejected, (state, action) => {
        state.saving = false;
        state.saveError = action.payload ?? { error: action.error.message ?? 'unknown' };
      })

      .addCase(fetchWeeklyPulseHistory.pending, (state) => {
        state.historyLoading = true;
        state.historyError = null;
      })
      .addCase(fetchWeeklyPulseHistory.fulfilled, (state, action) => {
        state.historyLoading = false;
        if (action.payload.direction === 'next' && state.history) {
          state.history = {
            siteId: action.payload.page.siteId,
            runs: [...state.history.runs, ...action.payload.page.runs],
            nextCursor: action.payload.page.nextCursor,
          };
        } else {
          state.history = action.payload.page;
        }
      })
      .addCase(fetchWeeklyPulseHistory.rejected, (state, action) => {
        state.historyLoading = false;
        state.historyError = action.payload ?? { error: action.error.message ?? 'unknown' };
      })

      .addCase(fetchWeeklyPulseDetail.pending, (state) => {
        state.detailLoading = true;
        state.detailError = null;
      })
      .addCase(fetchWeeklyPulseDetail.fulfilled, (state, action) => {
        state.detailLoading = false;
        state.detailByPulseId[action.payload.runId] = action.payload;
      })
      .addCase(fetchWeeklyPulseDetail.rejected, (state, action) => {
        state.detailLoading = false;
        state.detailError = action.payload ?? { error: action.error.message ?? 'unknown' };
      })

      .addCase(fetchGenerativeAppearance.pending, (state) => {
        state.gscLoading = true;
        state.gscError = null;
      })
      .addCase(fetchGenerativeAppearance.fulfilled, (state, action) => {
        state.gscLoading = false;
        state.gscAppearance = action.payload;
      })
      .addCase(fetchGenerativeAppearance.rejected, (state, action) => {
        state.gscLoading = false;
        state.gscError = action.payload ?? { error: action.error.message ?? 'unknown' };
      });
  },
});

export const weeklyPulseReducer = slice.reducer;
export const {
  resetWeeklyPulse,
  setSelectedPulseId,
  clearSaveError,
  clearPreview,
} = slice.actions;
