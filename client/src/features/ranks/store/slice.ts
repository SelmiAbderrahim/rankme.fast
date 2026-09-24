import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RanksState } from '../types';
import {
  addKeyword,
  checkNow,
  loadKeywordHistory,
  loadKeywords,
  loadSerpFeatureDetail,
  loadSerpFeatures,
  removeKeyword,
  updateCadence,
} from './thunks';

const initialState: RanksState = {
  siteId: null,
  items: [],
  nextCursor: null,
  currentCursor: null,
  cursorStack: [],
  cadence: 'weekly',
  loading: false,
  loaded: false,
  error: '',
  adding: false,
  addError: '',
  removingId: null,
  removeError: '',
  updatingCadence: false,
  cadenceError: '',
  checkingNow: false,
  checkingKeywordId: null,
  checkCooldownUntil: null,
  message: '',
  selectedKeywordId: null,
  history: [],
  historyKeywordId: null,
  historyLoading: false,
  historyError: '',
  serpFeatureRows: [],
  serpFeaturesSiteId: null,
  serpFeaturesLoading: false,
  serpFeaturesLoaded: false,
  serpFeaturesError: '',
  serpFeaturesDisabled: false,
  serpFeatureCaptureEnabled: true,
  serpFeatureCaptureStatus: 'active',
  serpFeatureDetail: null,
  serpFeatureDetailKeywordId: null,
  serpFeatureDetailLoading: false,
  serpFeatureDetailError: '',
};

const ranksSlice = createSlice({
  name: 'ranks',
  initialState,
  reducers: {
    clearRanksMessages: (state) => {
      state.error = '';
      state.addError = '';
      state.removeError = '';
      state.cadenceError = '';
      state.historyError = '';
      state.serpFeaturesError = '';
      state.serpFeatureDetailError = '';
      state.message = '';
    },
    selectKeyword: (state, action: PayloadAction<string | null>) => {
      state.selectedKeywordId = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadKeywords.pending, (state, action) => {
        state.loading = true;
        state.error = '';
        if (state.siteId !== action.meta.arg.siteId) {
          state.siteId = action.meta.arg.siteId;
          state.items = [];
          state.loaded = false;
          state.selectedKeywordId = null;
          state.history = [];
          state.historyKeywordId = null;
        }
      })
      .addCase(loadKeywords.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        const direction = action.meta.arg.direction ?? 'initial';
        const cursor = action.meta.arg.cursor ?? null;
        if (direction === 'next') {
          state.cursorStack.push(state.currentCursor);
        } else if (direction === 'prev') {
          state.cursorStack.pop();
        } else {
          state.cursorStack = [];
        }
        state.currentCursor = cursor;
        state.items = action.payload.keywords;
        state.nextCursor = action.payload.nextCursor;
        state.cadence = action.payload.cadence;
        state.loading = false;
        state.loaded = true;
        if (
          state.selectedKeywordId &&
          !action.payload.keywords.some((k) => k.id === state.selectedKeywordId)
        ) {
          state.selectedKeywordId = null;
        }
      })
      .addCase(loadKeywords.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        state.error = action.payload ?? '';
      })
      .addCase(addKeyword.pending, (state) => {
        state.adding = true;
        state.addError = '';
        state.message = '';
      })
      .addCase(addKeyword.fulfilled, (state, action) => {
        state.adding = false;
        state.message = action.payload.message;
      })
      .addCase(addKeyword.rejected, (state, action) => {
        state.adding = false;
        state.addError = action.payload ?? '';
      })
      .addCase(removeKeyword.pending, (state, action) => {
        state.removingId = action.meta.arg;
        state.removeError = '';
        state.message = '';
      })
      .addCase(removeKeyword.fulfilled, (state, action) => {
        state.removingId = null;
        state.message = action.payload.message;
      })
      .addCase(removeKeyword.rejected, (state, action) => {
        state.removingId = null;
        state.removeError = action.payload ?? '';
      })
      .addCase(updateCadence.pending, (state, action) => {
        state.updatingCadence = true;
        state.cadenceError = '';
        // Optimistic: reflect the requested cadence immediately.
        state.cadence = action.meta.arg.cadence;
      })
      .addCase(updateCadence.fulfilled, (state, action) => {
        state.updatingCadence = false;
        state.cadence = action.payload.cadence;
        state.message = action.payload.message;
      })
      .addCase(updateCadence.rejected, (state, action) => {
        state.updatingCadence = false;
        // Roll back the optimistic switch.
        state.cadence = action.meta.arg.previous;
        state.cadenceError = action.payload ?? '';
      })
      .addCase(checkNow.pending, (state, action) => {
        state.checkingNow = true;
        state.checkingKeywordId = action.meta.arg.keywordId ?? null;
      })
      .addCase(checkNow.fulfilled, (state, action) => {
        state.checkingNow = false;
        state.checkingKeywordId = null;
        state.message = action.payload.message;
      })
      .addCase(checkNow.rejected, (state, action) => {
        state.checkingNow = false;
        state.checkingKeywordId = null;
        state.checkCooldownUntil = action.payload?.cooldownUntil ?? null;
      })
      .addCase(loadKeywordHistory.pending, (state, action) => {
        state.historyLoading = true;
        state.historyError = '';
        state.historyKeywordId = action.meta.arg.keywordId;
      })
      .addCase(loadKeywordHistory.fulfilled, (state, action) => {
        if (action.meta.arg.keywordId !== state.historyKeywordId) return;
        state.historyLoading = false;
        state.history = action.payload.series;
      })
      .addCase(loadKeywordHistory.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.keywordId !== state.historyKeywordId) return;
        state.historyLoading = false;
        state.historyError = action.payload ?? '';
      })
      .addCase(loadSerpFeatures.pending, (state, action) => {
        state.serpFeaturesLoading = true;
        state.serpFeaturesError = '';
        state.serpFeaturesDisabled = false;
        state.serpFeaturesSiteId = action.meta.arg.siteId;
      })
      .addCase(loadSerpFeatures.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.serpFeaturesSiteId) return;
        state.serpFeaturesLoading = false;
        state.serpFeaturesLoaded = true;
        state.serpFeatureRows = action.payload.rows;
        state.serpFeatureCaptureEnabled = action.payload.captureEnabled;
        state.serpFeatureCaptureStatus = action.payload.captureStatus;
      })
      .addCase(loadSerpFeatures.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.siteId !== state.serpFeaturesSiteId) return;
        state.serpFeaturesLoading = false;
        state.serpFeaturesLoaded = true;
        state.serpFeatureRows = [];
        state.serpFeaturesDisabled = action.payload?.disabled ?? false;
        state.serpFeaturesError = action.payload?.disabled
          ? ''
          : (action.payload?.error ?? '');
      })
      .addCase(loadSerpFeatureDetail.pending, (state, action) => {
        state.serpFeatureDetailLoading = true;
        state.serpFeatureDetailError = '';
        state.serpFeatureDetailKeywordId = action.meta.arg.keywordId;
        state.serpFeatureDetail = null;
      })
      .addCase(loadSerpFeatureDetail.fulfilled, (state, action) => {
        if (action.meta.arg.keywordId !== state.serpFeatureDetailKeywordId) return;
        state.serpFeatureDetailLoading = false;
        state.serpFeatureDetail = action.payload;
        state.serpFeatureCaptureEnabled = action.payload.captureEnabled;
        state.serpFeatureCaptureStatus = action.payload.captureStatus;
      })
      .addCase(loadSerpFeatureDetail.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.keywordId !== state.serpFeatureDetailKeywordId) return;
        state.serpFeatureDetailLoading = false;
        state.serpFeatureDetailError = action.payload?.error ?? '';
      });
  },
});

export const { clearRanksMessages, selectKeyword } = ranksSlice.actions;
export const ranksReducer = ranksSlice.reducer;
