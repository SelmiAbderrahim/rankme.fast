import { createSlice, isAnyOf } from '@reduxjs/toolkit';
import type { AppSeoListingState } from '../listing-types';
import {
  confirmAppListingRun,
  loadAppListingHistory,
  loadLatestAppListing,
  previewAppListingRun,
} from './listing-thunks';

export const initialAppSeoListingState: AppSeoListingState = {
  siteId: null,
  profileId: null,
  report: null,
  history: [],
  listingEnabled: true,
  latestStatus: 'idle',
  historyStatus: 'idle',
  mutationStatus: 'idle',
  preview: null,
  error: '',
};

const listingSlice = createSlice({
  name: 'appSeoListing',
  initialState: initialAppSeoListingState,
  reducers: {
    clearAppListingPreview: (state) => {
      state.preview = null;
      state.mutationStatus = 'idle';
      state.error = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadLatestAppListing.pending, (state, action) => {
        state.latestStatus = 'loading';
        state.error = '';
        const changed = state.siteId !== action.meta.arg.siteId
          || state.profileId !== action.meta.arg.profileId;
        if (changed) {
          state.report = null;
          state.history = [];
        }
        state.siteId = action.meta.arg.siteId;
        state.profileId = action.meta.arg.profileId;
      })
      .addCase(loadLatestAppListing.fulfilled, (state, action) => {
        state.report = action.payload.report;
        state.listingEnabled = action.payload.listingEnabled;
        state.latestStatus = 'succeeded';
      })
      .addCase(loadLatestAppListing.rejected, (state, action) => {
        state.latestStatus = 'failed';
        state.error = action.payload ?? '';
      })
      .addCase(loadAppListingHistory.pending, (state, action) => {
        state.historyStatus = 'loading';
        state.error = '';
        const changed = state.siteId !== action.meta.arg.siteId
          || state.profileId !== action.meta.arg.profileId;
        if (changed) {
          state.report = null;
          state.history = [];
        }
        state.siteId = action.meta.arg.siteId;
        state.profileId = action.meta.arg.profileId;
      })
      .addCase(loadAppListingHistory.fulfilled, (state, action) => {
        state.history = action.payload.items;
        state.listingEnabled = action.payload.listingEnabled;
        state.historyStatus = 'succeeded';
      })
      .addCase(loadAppListingHistory.rejected, (state, action) => {
        state.historyStatus = 'failed';
        state.error = action.payload ?? '';
      })
      .addCase(previewAppListingRun.fulfilled, (state, action) => {
        state.preview = action.payload;
        state.mutationStatus = 'succeeded';
      })
      .addCase(confirmAppListingRun.fulfilled, (state, action) => {
        state.preview = action.payload;
        state.mutationStatus = 'succeeded';
      });
    builder.addMatcher(
      isAnyOf(previewAppListingRun.pending, confirmAppListingRun.pending),
      (state) => {
        state.mutationStatus = 'loading';
        state.error = '';
      },
    );
    builder.addMatcher(
      isAnyOf(previewAppListingRun.rejected, confirmAppListingRun.rejected),
      (state, action) => {
        state.mutationStatus = 'failed';
        state.error = action.payload ?? '';
      },
    );
  },
});

export const { clearAppListingPreview } = listingSlice.actions;
export const appSeoListingReducer = listingSlice.reducer;
