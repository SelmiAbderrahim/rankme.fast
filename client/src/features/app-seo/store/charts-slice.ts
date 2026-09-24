import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import type { AppSeoChartsState } from '../charts-types';
import {
  confirmAppChartRecheck,
  createAppChart,
  deleteAppChart,
  loadAppChartHistory,
  loadTrackedAppCharts,
  previewAppChartRecheck,
} from './charts-thunks';

export const initialAppSeoChartsState: AppSeoChartsState = {
  siteId: null,
  profileId: null,
  items: [],
  catalogs: {
    google_play: { store: 'google_play', charts: [], categories: [] },
    app_store: { store: 'app_store', charts: [], categories: [] },
  },
  limit: 2,
  trackingEnabled: true,
  listStatus: 'idle',
  mutationStatus: 'idle',
  error: '',
  recheckPreview: null,
  selectedSubscriptionId: null,
  history: [],
  historyStatus: 'idle',
};

const chartsSlice = createSlice({
  name: 'appSeoCharts',
  initialState: initialAppSeoChartsState,
  reducers: {
    clearAppSeoChartsPreview: (state) => {
      state.recheckPreview = null;
      state.mutationStatus = 'idle';
      state.error = '';
    },
    selectAppChartSubscription: (state, action: PayloadAction<string | null>) => {
      state.selectedSubscriptionId = action.payload;
      state.history = [];
      state.historyStatus = 'idle';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadTrackedAppCharts.pending, (state, action) => {
        state.listStatus = 'loading';
        state.error = '';
        if (state.siteId !== action.meta.arg.siteId || state.profileId !== action.meta.arg.profileId) {
          state.items = [];
          state.siteId = action.meta.arg.siteId;
          state.profileId = action.meta.arg.profileId;
        }
      })
      .addCase(loadTrackedAppCharts.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.catalogs = action.payload.catalogs;
        state.limit = action.payload.limit;
        state.trackingEnabled = action.payload.trackingEnabled;
        state.listStatus = 'succeeded';
      })
      .addCase(loadTrackedAppCharts.rejected, (state, action) => {
        state.listStatus = 'failed';
        state.error = action.payload ?? '';
      })
      .addCase(createAppChart.fulfilled, (state, action) => {
        state.items.unshift(action.payload);
        state.mutationStatus = 'succeeded';
      })
      .addCase(deleteAppChart.fulfilled, (state, action) => {
        state.items = state.items.filter((item) => item.id !== action.payload);
        state.mutationStatus = 'succeeded';
      })
      .addCase(previewAppChartRecheck.fulfilled, (state, action) => {
        state.recheckPreview = action.payload;
        state.mutationStatus = 'succeeded';
      })
      .addCase(confirmAppChartRecheck.fulfilled, (state, action) => {
        state.recheckPreview = action.payload;
        state.mutationStatus = 'succeeded';
      })
      .addCase(loadAppChartHistory.pending, (state) => {
        state.historyStatus = 'loading';
        state.error = '';
      })
      .addCase(loadAppChartHistory.fulfilled, (state, action) => {
        state.history = action.payload;
        state.historyStatus = 'succeeded';
      })
      .addCase(loadAppChartHistory.rejected, (state, action) => {
        state.historyStatus = 'failed';
        state.error = action.payload ?? '';
      });
    builder.addMatcher(
      isAnyOf(
        createAppChart.pending,
        deleteAppChart.pending,
        previewAppChartRecheck.pending,
        confirmAppChartRecheck.pending,
      ),
      (state) => { state.mutationStatus = 'loading'; state.error = ''; },
    );
    builder.addMatcher(
      isAnyOf(
        createAppChart.rejected,
        deleteAppChart.rejected,
        previewAppChartRecheck.rejected,
        confirmAppChartRecheck.rejected,
      ),
      (state, action) => {
        state.mutationStatus = 'failed';
        state.error = action.payload ?? '';
      },
    );
  },
});

export const { clearAppSeoChartsPreview, selectAppChartSubscription } = chartsSlice.actions;
export const appSeoChartsReducer = chartsSlice.reducer;
