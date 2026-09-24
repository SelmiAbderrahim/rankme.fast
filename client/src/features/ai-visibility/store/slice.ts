import { createSlice } from '@reduxjs/toolkit';
import type { AiVisibilityState } from '../types';
import {
  addAllSuggestions,
  addPrompt,
  generateSuggestions,
  loadAiVisibility,
  loadAiVisibilityTrend,
  loadStoredSuggestions,
  removePrompt,
  runAiVisibilityCheck,
} from './thunks';

export const initialState: AiVisibilityState = {
  siteId: null,
  overview: null,
  suggestions: [],
  trend: [],
  loading: false,
  loaded: false,
  suggestionsLoading: false,
  trendLoading: false,
  error: '',
  suggestionsError: '',
  trendError: '',
  isRefreshing: false,
  cooldownUntil: null,
  refreshError: '',
  adding: false,
  addingAll: false,
  removingId: null,
  suggestionsGeneratedAt: null,
  suggestionsOutputLocale: null,
  suggestionsGenerating: false,
  suggestionsCooldownUntil: null,
};

const rekeyForSite = (state: AiVisibilityState, siteId: string): AiVisibilityState => {
  if (state.siteId === siteId) return state;
  return { ...initialState, siteId, loading: true };
};

const slice = createSlice({
  name: 'aiVisibility',
  initialState,
  reducers: {
    resetAiVisibility: () => initialState,
    clearRefreshCooldown: (state) => {
      state.cooldownUntil = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadAiVisibility.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.loading = true;
        state.error = '';
      })
      .addCase(loadAiVisibility.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        state.overview = action.payload;
      })
      .addCase(loadAiVisibility.rejected, (state, action) => {
        if (action.meta.aborted || action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        state.error = action.payload ?? '';
      })
      .addCase(addPrompt.pending, (state) => {
        state.adding = true;
        state.error = '';
      })
      .addCase(addPrompt.fulfilled, (state, action) => {
        state.adding = false;
        if (!state.overview) return;
        if (!state.overview.prompts.some((prompt) => prompt.id === action.payload.id)) {
          state.overview.prompts.unshift(action.payload);
        }
      })
      .addCase(addPrompt.rejected, (state, action) => {
        state.adding = false;
        state.error = action.payload ?? '';
      })
      .addCase(removePrompt.pending, (state, action) => {
        state.removingId = action.meta.arg.promptId;
      })
      .addCase(removePrompt.fulfilled, (state, action) => {
        state.removingId = null;
        if (!state.overview) return;
        state.overview.prompts = state.overview.prompts.filter(
          (prompt) => prompt.id !== action.payload,
        );
      })
      .addCase(removePrompt.rejected, (state, action) => {
        state.removingId = null;
        state.error = action.payload ?? '';
      })
      .addCase(runAiVisibilityCheck.pending, (state) => {
        state.isRefreshing = true;
        state.refreshError = '';
      })
      .addCase(runAiVisibilityCheck.fulfilled, (state, action) => {
        state.isRefreshing = false;
        state.loaded = true;
        state.overview = action.payload;
      })
      .addCase(runAiVisibilityCheck.rejected, (state, action) => {
        state.isRefreshing = false;
        state.refreshError = action.payload?.error ?? '';
        state.cooldownUntil = action.payload?.cooldownUntil ?? null;
      })
      .addCase(loadStoredSuggestions.pending, (state, action) => {
        state.suggestionsLoading = true;
        state.suggestionsError = '';
        state.suggestions = [];
        state.suggestionsGeneratedAt = null;
        state.suggestionsOutputLocale = action.meta.arg.outputLocale;
      })
      .addCase(loadStoredSuggestions.fulfilled, (state, action) => {
        if (state.suggestionsOutputLocale !== action.meta.arg.outputLocale) return;
        state.suggestionsLoading = false;
        state.suggestions = action.payload.suggestions;
        state.suggestionsGeneratedAt = action.payload.generatedAt;
        state.suggestionsOutputLocale = action.payload.outputLocale;
      })
      // Writes ONLY `suggestionsError`. It must not touch the shared
      // `cooldownUntil`, which the mention-check
      // RefreshButton reads — the previous version did, so a failed
      // suggestions read disabled an unrelated button.
      .addCase(loadStoredSuggestions.rejected, (state, action) => {
        if (action.meta.aborted || state.suggestionsOutputLocale !== action.meta.arg.outputLocale) {
          return;
        }
        state.suggestionsLoading = false;
        state.suggestionsError = action.payload ?? '';
      })
      .addCase(generateSuggestions.pending, (state, action) => {
        state.suggestionsGenerating = true;
        state.suggestionsError = '';
        state.suggestionsOutputLocale = action.meta.arg.outputLocale;
      })
      .addCase(generateSuggestions.fulfilled, (state, action) => {
        if (state.suggestionsOutputLocale !== action.meta.arg.outputLocale) return;
        state.suggestionsGenerating = false;
        state.suggestions = action.payload.suggestions;
        state.suggestionsGeneratedAt = action.payload.generatedAt;
        state.suggestionsOutputLocale = action.payload.outputLocale;
      })
      .addCase(generateSuggestions.rejected, (state, action) => {
        if (state.suggestionsOutputLocale !== action.meta.arg.outputLocale) return;
        state.suggestionsGenerating = false;
        state.suggestionsError = action.payload?.error ?? '';
        state.suggestionsCooldownUntil =
          action.payload?.cooldownUntil ?? state.suggestionsCooldownUntil;
      })
      .addCase(addAllSuggestions.pending, (state) => {
        state.addingAll = true;
        state.error = '';
      })
      .addCase(addAllSuggestions.fulfilled, (state, action) => {
        state.addingAll = false;
        if (!state.overview) return;
        for (const prompt of action.payload) {
          if (!state.overview.prompts.some((row) => row.id === prompt.id)) {
            state.overview.prompts.unshift(prompt);
          }
        }
      })
      .addCase(addAllSuggestions.rejected, (state, action) => {
        state.addingAll = false;
        state.error = action.payload ?? '';
      })
      .addCase(loadAiVisibilityTrend.pending, (state) => {
        state.trendLoading = true;
        state.trendError = '';
      })
      .addCase(loadAiVisibilityTrend.fulfilled, (state, action) => {
        state.trendLoading = false;
        state.trend = action.payload;
      })
      .addCase(loadAiVisibilityTrend.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.trendLoading = false;
        state.trendError = action.payload ?? '';
      });
  },
});

export const { resetAiVisibility, clearRefreshCooldown } = slice.actions;
export const aiVisibilityReducer = slice.reducer;
