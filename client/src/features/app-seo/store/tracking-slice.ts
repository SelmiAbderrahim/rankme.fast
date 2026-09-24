import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import type { AppSeoTrackingState } from '../tracking-types';
import {
  confirmTrackedAppKeywordRecheck,
  deleteTrackedAppKeyword,
  loadTrackedAppKeywordHistory,
  loadTrackedAppKeywords,
  mintTrackedAppKeyword,
  previewTrackedAppKeywordMint,
  previewTrackedAppKeywordRecheck,
} from './tracking-thunks';

export const initialAppSeoTrackingState: AppSeoTrackingState = {
  siteId: null,
  profileId: null,
  items: [],
  trackingEnabled: true,
  listStatus: 'idle',
  mutationStatus: 'idle',
  error: '',
  mintPreview: null,
  recheckPreview: null,
  selectedKeywordId: null,
  history: [],
  historyStatus: 'idle',
};

const trackingSlice = createSlice({
  name: 'appSeoTracking',
  initialState: initialAppSeoTrackingState,
  reducers: {
    clearAppSeoTrackingPreview: (state) => {
      state.mintPreview = null;
      state.recheckPreview = null;
      state.mutationStatus = 'idle';
      state.error = '';
    },
    selectTrackedAppKeyword: (state, action: PayloadAction<string | null>) => {
      state.selectedKeywordId = action.payload;
      state.history = [];
      state.historyStatus = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadTrackedAppKeywords.pending, (state, action) => {
        state.listStatus = 'loading';
        state.error = '';
        if (state.siteId !== action.meta.arg.siteId || state.profileId !== action.meta.arg.profileId) {
          state.items = [];
          state.siteId = action.meta.arg.siteId;
          state.profileId = action.meta.arg.profileId;
        }
      })
      .addCase(loadTrackedAppKeywords.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.trackingEnabled = action.payload.trackingEnabled;
        state.listStatus = 'succeeded';
      })
      .addCase(loadTrackedAppKeywords.rejected, (state, action) => {
        state.listStatus = 'failed';
        state.error = action.payload ?? '';
      })
      .addCase(previewTrackedAppKeywordMint.fulfilled, (state, action) => {
        state.mintPreview = action.payload; state.mutationStatus = 'succeeded';
      })
      .addCase(mintTrackedAppKeyword.fulfilled, (state, action) => {
        state.items.unshift(action.payload);
        state.mintPreview = null; state.mutationStatus = 'succeeded';
      })
      .addCase(deleteTrackedAppKeyword.fulfilled, (state, action) => {
        state.items = state.items.filter((item) => item.id !== action.payload);
        state.mutationStatus = 'succeeded';
      })
      .addCase(previewTrackedAppKeywordRecheck.fulfilled, (state, action) => {
        state.recheckPreview = action.payload; state.mutationStatus = 'succeeded';
      })
      .addCase(confirmTrackedAppKeywordRecheck.fulfilled, (state, action) => {
        if (action.payload.queued) {
          const keyword = state.items.find((item) => item.id === action.meta.arg.keywordId);
          if (keyword) keyword.checkStatus = 'queued';
        }
        state.recheckPreview = action.payload; state.mutationStatus = 'succeeded';
      })
      .addCase(loadTrackedAppKeywordHistory.pending, (state) => {
        state.historyStatus = 'loading'; state.error = '';
      })
      .addCase(loadTrackedAppKeywordHistory.fulfilled, (state, action) => {
        state.history = action.payload; state.historyStatus = 'succeeded';
      });
    builder.addCase(loadTrackedAppKeywordHistory.rejected, (state, action) => {
      state.historyStatus = 'failed'; state.error = action.payload ?? '';
    });
    builder.addMatcher(
      isAnyOf(
        previewTrackedAppKeywordMint.pending,
        mintTrackedAppKeyword.pending,
        deleteTrackedAppKeyword.pending,
        previewTrackedAppKeywordRecheck.pending,
        confirmTrackedAppKeywordRecheck.pending,
      ),
      (state) => { state.mutationStatus = 'loading'; state.error = ''; },
    );
    builder.addMatcher(
      isAnyOf(
        previewTrackedAppKeywordMint.rejected,
        mintTrackedAppKeyword.rejected,
        deleteTrackedAppKeyword.rejected,
        previewTrackedAppKeywordRecheck.rejected,
        confirmTrackedAppKeywordRecheck.rejected,
      ),
      (state, action) => {
        state.mutationStatus = 'failed'; state.error = action.payload ?? '';
      },
    );
  },
});

export const { clearAppSeoTrackingPreview, selectTrackedAppKeyword } = trackingSlice.actions;
export const appSeoTrackingReducer = trackingSlice.reducer;
