import { createSlice } from '@reduxjs/toolkit';
import type { ReviewIntelligenceState } from '../types';
import {
  addReviewSource,
  loadReviewInventory,
  loadReviewRun,
  loadReviewRuns,
  loadReviewSources,
  loadReviewStats,
  loadReviewThemes,
  previewSync,
  removeReviewSource,
  submitSync,
} from './thunks';

export const initialReviewIntelligenceState: ReviewIntelligenceState = {
  profileId: null,
  sources: [],
  sourcesStatus: 'idle',
  sourcesError: '',
  sourceMutationStatus: 'idle',
  sourceMutationError: '',
  sourceMutationErrorKind: null,
  runs: [],
  runsStatus: 'idle',
  runsError: '',
  run: null,
  runStatus: 'idle',
  runError: '',
  inventory: null,
  inventoryStatus: 'idle',
  inventoryError: '',
  stats: null,
  statsStatus: 'idle',
  statsError: '',
  themes: null,
  themesStatus: 'idle',
  themesError: '',
  preview: null,
  previewStatus: 'idle',
  previewError: '',
  previewErrorKind: null,
  submitStatus: 'idle',
  submitError: '',
  submitErrorKind: null,
  lastSubmit: null,
};

const slice = createSlice({
  name: 'localSeoReviews',
  initialState: initialReviewIntelligenceState,
  reducers: {
    /** Cancel spends nothing — it only drops the estimate the server handed back. */
    clearReviewPreview: (state) => {
      state.preview = null;
      state.previewStatus = 'idle';
      state.previewError = '';
      state.previewErrorKind = null;
    },
    clearReviewSubmit: (state) => {
      state.submitStatus = 'idle';
      state.submitError = '';
      state.submitErrorKind = null;
      state.lastSubmit = null;
    },
    resetReviewIntelligence: () => initialReviewIntelligenceState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadReviewSources.pending, (state) => {
        state.sourcesStatus = 'loading';
        state.sourcesError = '';
      })
      .addCase(loadReviewSources.fulfilled, (state, action) => {
        state.sourcesStatus = 'succeeded';
        state.sources = action.payload.sources;
        state.profileId = action.meta.arg;
      })
      .addCase(loadReviewSources.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.sourcesStatus = 'failed';
        state.sourcesError = action.payload ?? '';
      })
      .addCase(addReviewSource.pending, (state) => {
        state.sourceMutationStatus = 'loading';
        state.sourceMutationError = '';
        state.sourceMutationErrorKind = null;
      })
      .addCase(addReviewSource.fulfilled, (state, action) => {
        state.sourceMutationStatus = 'succeeded';
        // The server upserts by `(profileId, source)` — mirror that here so a
        // re-saved target replaces its row instead of duplicating it.
        state.sources = [
          ...state.sources.filter((row) => row.source !== action.payload.source),
          action.payload,
        ].sort((left, right) => left.source.localeCompare(right.source));
      })
      .addCase(addReviewSource.rejected, (state, action) => {
        state.sourceMutationStatus = 'failed';
        state.sourceMutationError = action.payload?.error ?? '';
        state.sourceMutationErrorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(removeReviewSource.pending, (state) => {
        state.sourceMutationStatus = 'loading';
        state.sourceMutationError = '';
        state.sourceMutationErrorKind = null;
      })
      .addCase(removeReviewSource.fulfilled, (state, action) => {
        state.sourceMutationStatus = 'succeeded';
        state.sources = state.sources.filter((row) => row.id !== action.payload.id);
      })
      .addCase(removeReviewSource.rejected, (state, action) => {
        state.sourceMutationStatus = 'failed';
        state.sourceMutationError = action.payload?.error ?? '';
        state.sourceMutationErrorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(previewSync.pending, (state) => {
        state.previewStatus = 'loading';
        state.preview = null;
        state.previewError = '';
        state.previewErrorKind = null;
      })
      .addCase(previewSync.fulfilled, (state, action) => {
        state.previewStatus = 'succeeded';
        state.preview = action.payload;
      })
      .addCase(previewSync.rejected, (state, action) => {
        state.previewStatus = 'failed';
        state.previewError = action.payload?.error ?? '';
        state.previewErrorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(submitSync.pending, (state) => {
        state.submitStatus = 'loading';
        state.submitError = '';
        state.submitErrorKind = null;
      })
      .addCase(submitSync.fulfilled, (state, action) => {
        state.submitStatus = 'succeeded';
        state.lastSubmit = action.payload;
        state.preview = null;
        state.previewStatus = 'idle';
      })
      .addCase(submitSync.rejected, (state, action) => {
        state.submitStatus = 'failed';
        state.submitError = action.payload?.error ?? '';
        state.submitErrorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(loadReviewRuns.pending, (state) => {
        state.runsStatus = 'loading';
        state.runsError = '';
      })
      .addCase(loadReviewRuns.fulfilled, (state, action) => {
        state.runsStatus = 'succeeded';
        state.runs = action.payload.runs;
      })
      .addCase(loadReviewRuns.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.runsStatus = 'failed';
        state.runsError = action.payload ?? '';
      })
      .addCase(loadReviewRun.pending, (state) => {
        state.runStatus = 'loading';
        state.runError = '';
      })
      .addCase(loadReviewRun.fulfilled, (state, action) => {
        state.runStatus = 'succeeded';
        state.run = action.payload;
      })
      .addCase(loadReviewRun.rejected, (state, action) => {
        state.runStatus = 'failed';
        state.runError = action.payload ?? '';
      })
      .addCase(loadReviewStats.pending, (state) => {
        state.statsStatus = 'loading';
        state.statsError = '';
      })
      .addCase(loadReviewStats.fulfilled, (state, action) => {
        state.statsStatus = 'succeeded';
        state.stats = action.payload;
      })
      .addCase(loadReviewStats.rejected, (state, action) => {
        state.statsStatus = 'failed';
        state.statsError = action.payload ?? '';
      })
      .addCase(loadReviewThemes.pending, (state) => {
        state.themesStatus = 'loading';
        state.themesError = '';
      })
      .addCase(loadReviewThemes.fulfilled, (state, action) => {
        state.themesStatus = 'succeeded';
        state.themes = action.payload;
      })
      .addCase(loadReviewThemes.rejected, (state, action) => {
        state.themesStatus = 'failed';
        state.themesError = action.payload ?? '';
      })
      .addCase(loadReviewInventory.pending, (state) => {
        state.inventoryStatus = 'loading';
        state.inventoryError = '';
      })
      .addCase(loadReviewInventory.fulfilled, (state, action) => {
        state.inventoryStatus = 'succeeded';
        state.inventory = action.payload;
      })
      .addCase(loadReviewInventory.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.inventoryStatus = 'failed';
        state.inventoryError = action.payload ?? '';
      });
  },
});

export const { clearReviewPreview, clearReviewSubmit, resetReviewIntelligence } = slice.actions;
export const localSeoReviewsReducer = slice.reducer;
