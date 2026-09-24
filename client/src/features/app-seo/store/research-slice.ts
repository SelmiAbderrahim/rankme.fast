import { createSlice, isAnyOf } from '@reduxjs/toolkit';
import type { AppSeoResearchState } from '../research-types';
import {
  loadLatestAppResearch,
  previewAppResearchSpend,
  runAppCompetitorResearch,
  runAppGapResearch,
  runAppKeywordResearch,
} from './research-thunks';

export const initialAppSeoResearchState: AppSeoResearchState = {
  siteId: null,
  profileId: null,
  store: 'google_play',
  results: { keywords: null, gap: null, competitors: null },
  researchEnabled: true,
  loadStatus: 'idle',
  mutationStatus: 'idle',
  preview: null,
  error: '',
};

const slice = createSlice({
  name: 'appSeoResearch',
  initialState: initialAppSeoResearchState,
  reducers: {
    clearAppResearchPreview: (state) => {
      state.preview = null;
      state.mutationStatus = 'idle';
      state.error = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadLatestAppResearch.pending, (state, action) => {
        state.loadStatus = 'loading'; state.error = '';
        state.siteId = action.meta.arg.siteId;
        state.profileId = action.meta.arg.profileId;
        state.store = action.meta.arg.store;
      })
      .addCase(loadLatestAppResearch.fulfilled, (state, action) => {
        const { surface, result } = action.payload;
        if (surface === 'keywords') state.results.keywords = result as typeof state.results.keywords;
        if (surface === 'gap') state.results.gap = result as typeof state.results.gap;
        if (surface === 'competitors') state.results.competitors = result as typeof state.results.competitors;
        state.researchEnabled = action.payload.researchEnabled;
        state.loadStatus = 'succeeded';
      })
      .addCase(loadLatestAppResearch.rejected, (state, action) => {
        state.loadStatus = 'failed'; state.error = action.payload ?? '';
      })
      .addCase(previewAppResearchSpend.fulfilled, (state, action) => {
        state.preview = action.payload; state.mutationStatus = 'succeeded';
      })
      .addCase(runAppKeywordResearch.fulfilled, (state, action) => {
        state.results.keywords = action.payload; state.preview = null; state.mutationStatus = 'succeeded';
      })
      .addCase(runAppGapResearch.fulfilled, (state, action) => {
        state.results.gap = action.payload; state.preview = null; state.mutationStatus = 'succeeded';
      })
      .addCase(runAppCompetitorResearch.fulfilled, (state, action) => {
        state.results.competitors = action.payload; state.preview = null; state.mutationStatus = 'succeeded';
      });
    builder.addMatcher(
      isAnyOf(
        previewAppResearchSpend.pending,
        runAppKeywordResearch.pending,
        runAppGapResearch.pending,
        runAppCompetitorResearch.pending,
      ),
      (state) => { state.mutationStatus = 'loading'; state.error = ''; },
    );
    builder.addMatcher(
      isAnyOf(
        previewAppResearchSpend.rejected,
        runAppKeywordResearch.rejected,
        runAppGapResearch.rejected,
        runAppCompetitorResearch.rejected,
      ),
      (state, action) => {
        state.mutationStatus = 'failed'; state.error = action.payload ?? '';
      },
    );
  },
});

export const { clearAppResearchPreview } = slice.actions;
export const appSeoResearchReducer = slice.reducer;
