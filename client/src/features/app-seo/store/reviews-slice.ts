import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import type { AppSeoReviewsState } from '../reviews-types';
import {
  confirmAppReviewRun,
  loadAppReviewRunDetail,
  loadAppReviewRuns,
  previewAppReviewRun,
} from './reviews-thunks';

export const initialAppSeoReviewsState: AppSeoReviewsState = {
  siteId: null,
  profileId: null,
  store: null,
  items: [],
  selectedRun: null,
  selectedRunId: null,
  reviewsEnabled: true,
  listStatus: 'idle',
  detailStatus: 'idle',
  mutationStatus: 'idle',
  preview: null,
  error: '',
};

const reviewsSlice = createSlice({
  name: 'appSeoReviews',
  initialState: initialAppSeoReviewsState,
  reducers: {
    clearAppReviewPreview: (state) => {
      state.preview = null;
      state.mutationStatus = 'idle';
      state.error = '';
    },
    selectAppReviewRun: (state, action: PayloadAction<string | null>) => {
      state.selectedRunId = action.payload;
      if (state.selectedRun?.id !== action.payload) state.selectedRun = null;
      state.detailStatus = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadAppReviewRuns.pending, (state, action) => {
        state.listStatus = 'loading';
        state.error = '';
        const changed = state.siteId !== action.meta.arg.siteId
          || state.profileId !== action.meta.arg.profileId
          || state.store !== action.meta.arg.store;
        if (changed) {
          state.items = [];
          state.selectedRun = null;
          state.selectedRunId = null;
        }
        state.siteId = action.meta.arg.siteId;
        state.profileId = action.meta.arg.profileId;
        state.store = action.meta.arg.store;
      })
      .addCase(loadAppReviewRuns.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.reviewsEnabled = action.payload.reviewsEnabled;
        state.listStatus = 'succeeded';
      })
      .addCase(loadAppReviewRuns.rejected, (state, action) => {
        state.listStatus = 'failed';
        state.error = action.payload ?? '';
      })
      .addCase(loadAppReviewRunDetail.pending, (state) => {
        state.detailStatus = 'loading';
        state.error = '';
      })
      .addCase(loadAppReviewRunDetail.fulfilled, (state, action) => {
        state.selectedRun = action.payload;
        state.selectedRunId = action.payload.id;
        state.detailStatus = 'succeeded';
        const index = state.items.findIndex((item) => item.id === action.payload.id);
        if (index >= 0) state.items[index] = action.payload;
      })
      .addCase(loadAppReviewRunDetail.rejected, (state, action) => {
        state.detailStatus = 'failed';
        state.error = action.payload ?? '';
      })
      .addCase(previewAppReviewRun.fulfilled, (state, action) => {
        state.preview = action.payload;
        state.mutationStatus = 'succeeded';
      })
      .addCase(confirmAppReviewRun.fulfilled, (state, action) => {
        state.preview = action.payload;
        state.mutationStatus = 'succeeded';
        if (action.payload.run) {
          state.items.unshift(action.payload.run);
          state.selectedRunId = action.payload.run.id;
        }
      });
    builder.addMatcher(
      isAnyOf(previewAppReviewRun.pending, confirmAppReviewRun.pending),
      (state) => { state.mutationStatus = 'loading'; state.error = ''; },
    );
    builder.addMatcher(
      isAnyOf(previewAppReviewRun.rejected, confirmAppReviewRun.rejected),
      (state, action) => {
        state.mutationStatus = 'failed';
        state.error = action.payload ?? '';
      },
    );
  },
});

export const { clearAppReviewPreview, selectAppReviewRun } = reviewsSlice.actions;
export const appSeoReviewsReducer = reviewsSlice.reducer;

