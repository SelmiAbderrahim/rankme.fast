import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorMessage, apiErrorStatus } from '@shared/api/errorMessage';
import {
  createReviewSource,
  deleteReviewSource,
  fetchReviewInventory,
  fetchReviewRun,
  fetchReviewRuns,
  fetchReviewSources,
  fetchReviewStats,
  fetchReviewThemes,
  previewReviewSync,
  submitReviewSync,
} from '../api';
import type {
  ReviewInventoryFilters,
  ReviewInventoryResponse,
  ReviewRun,
  ReviewRunListResponse,
  ReviewSource,
  ReviewSourceListResponse,
  ReviewSourceName,
  ReviewSpendPreview,
  ReviewStats,
  ReviewSyncSubmitResult,
  ReviewThemesResponse,
  ReviewThunkError,
} from '../types';

/**
 * 503 is the kill switch (or a worker the API cannot reach). Everything else
 * is generic — the server already returns the localized sentence, so the
 * fallback key only covers transport failures.
 */
export const reviewThunkError = (error: unknown, fallbackKey: string): ReviewThunkError => ({
  error: apiErrorMessage(error, fallbackKey),
  kind: apiErrorStatus(error) === 503 ? 'locked' : 'unknown',
});

export const loadReviewSources = createAsyncThunk<
  ReviewSourceListResponse,
  string,
  { rejectValue: string }
>('local-seo-reviews/sources', async (profileId, { rejectWithValue, signal }) => {
  try {
    return await fetchReviewSources(profileId, { signal });
  } catch (error) {
    return rejectWithValue(apiErrorMessage(error, 'reviewIntelligence:errors.sourcesFailed'));
  }
});

export const addReviewSource = createAsyncThunk<
  ReviewSource,
  { profileId: string; source: ReviewSourceName; target: string },
  { rejectValue: ReviewThunkError }
>('local-seo-reviews/addSource', async (input, { rejectWithValue }) => {
  try {
    return await createReviewSource(input);
  } catch (error) {
    return rejectWithValue(reviewThunkError(error, 'reviewIntelligence:errors.addSourceFailed'));
  }
});

export const removeReviewSource = createAsyncThunk<
  { id: string },
  string,
  { rejectValue: ReviewThunkError }
>('local-seo-reviews/removeSource', async (id, { rejectWithValue }) => {
  try {
    return await deleteReviewSource(id);
  } catch (error) {
    return rejectWithValue(reviewThunkError(error, 'reviewIntelligence:errors.removeSourceFailed'));
  }
});

export const previewSync = createAsyncThunk<
  ReviewSpendPreview,
  { profileId: string; sources: ReviewSourceName[] },
  { rejectValue: ReviewThunkError }
>('local-seo-reviews/preview', async (input, { rejectWithValue }) => {
  try {
    return await previewReviewSync(input);
  } catch (error) {
    return rejectWithValue(reviewThunkError(error, 'reviewIntelligence:errors.previewFailed'));
  }
});

export const submitSync = createAsyncThunk<
  ReviewSyncSubmitResult,
  { profileId: string; sources: ReviewSourceName[]; depth: number },
  { rejectValue: ReviewThunkError }
>('local-seo-reviews/sync', async (input, { rejectWithValue }) => {
  try {
    return await submitReviewSync(input);
  } catch (error) {
    return rejectWithValue(reviewThunkError(error, 'reviewIntelligence:errors.syncFailed'));
  }
});

export const loadReviewRuns = createAsyncThunk<
  ReviewRunListResponse,
  string,
  { rejectValue: string }
>('local-seo-reviews/runs', async (profileId, { rejectWithValue, signal }) => {
  try {
    return await fetchReviewRuns(profileId, { signal });
  } catch (error) {
    return rejectWithValue(apiErrorMessage(error, 'reviewIntelligence:errors.runsFailed'));
  }
});

export const loadReviewRun = createAsyncThunk<ReviewRun, string, { rejectValue: string }>(
  'local-seo-reviews/run',
  async (runId, { rejectWithValue }) => {
    try {
      return await fetchReviewRun(runId);
    } catch (error) {
      return rejectWithValue(apiErrorMessage(error, 'reviewIntelligence:errors.runFailed'));
    }
  },
);

export const loadReviewStats = createAsyncThunk<ReviewStats, string, { rejectValue: string }>(
  'local-seo-reviews/stats',
  async (runId, { rejectWithValue }) => {
    try {
      return await fetchReviewStats(runId);
    } catch (error) {
      return rejectWithValue(apiErrorMessage(error, 'reviewIntelligence:errors.statsFailed'));
    }
  },
);

export const loadReviewThemes = createAsyncThunk<
  ReviewThemesResponse,
  string,
  { rejectValue: string }
>('local-seo-reviews/themes', async (runId, { rejectWithValue }) => {
  try {
    return await fetchReviewThemes(runId);
  } catch (error) {
    return rejectWithValue(apiErrorMessage(error, 'reviewIntelligence:errors.themesFailed'));
  }
});

export const loadReviewInventory = createAsyncThunk<
  ReviewInventoryResponse,
  { profileId: string; filters: ReviewInventoryFilters },
  { rejectValue: string }
>('local-seo-reviews/inventory', async ({ profileId, filters }, { rejectWithValue, signal }) => {
  try {
    return await fetchReviewInventory(profileId, filters, { signal });
  } catch (error) {
    return rejectWithValue(apiErrorMessage(error, 'reviewIntelligence:errors.inventoryFailed'));
  }
});
