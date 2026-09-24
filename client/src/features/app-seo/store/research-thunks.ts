import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorMessage } from '@shared/api/errorMessage';
import {
  fetchAppResearchPreview,
  fetchLatestAppResearch,
  submitAppCompetitorResearch,
  submitAppGapResearch,
  submitAppKeywordResearch,
} from '../research-api';
import type {
  AppCompetitorResearchInput,
  AppCompetitorResearchResult,
  AppGapResearchInput,
  AppGapResearchResult,
  AppKeywordResearchInput,
  AppKeywordResearchResult,
  AppResearchResult,
  AppResearchStore,
  AppResearchSurface,
} from '../research-types';

const failure = (error: unknown) => apiErrorMessage(error, 'appSeoResearch:errors.requestFailed');

export const loadLatestAppResearch = createAsyncThunk<
  {
    surface: AppResearchSurface;
    result: AppResearchResult | null;
    researchEnabled: boolean;
  },
  { siteId: string; profileId: string; store: AppResearchStore; surface: AppResearchSurface },
  { rejectValue: string }
>('appSeoResearch/loadLatest', async (args, { rejectWithValue }) => {
  try {
    const response = await fetchLatestAppResearch<AppResearchResult>(
      args.siteId, args.surface, args.profileId, args.store,
    );
    return { surface: args.surface, ...response };
  } catch (error) { return rejectWithValue(failure(error)); }
});

export const previewAppResearchSpend = createAsyncThunk<
  { surface: AppResearchSurface; value: Awaited<ReturnType<typeof fetchAppResearchPreview>>['preview'] },
  { siteId: string; profileId: string; store: AppResearchStore; surface: AppResearchSurface; appIds?: string[] },
  { rejectValue: string }
>('appSeoResearch/preview', async (args, { rejectWithValue }) => {
  try {
    const response = await fetchAppResearchPreview(
      args.siteId, args.surface, args.profileId, args.store, args.appIds,
    );
    return { surface: args.surface, value: response.preview };
  } catch (error) { return rejectWithValue(failure(error)); }
});

export const runAppKeywordResearch = createAsyncThunk<
  AppKeywordResearchResult,
  { siteId: string; input: AppKeywordResearchInput },
  { rejectValue: string }
>('appSeoResearch/runKeywords', async (args, { rejectWithValue }) => {
  try { return await submitAppKeywordResearch(args.siteId, args.input); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const runAppGapResearch = createAsyncThunk<
  AppGapResearchResult,
  { siteId: string; input: AppGapResearchInput },
  { rejectValue: string }
>('appSeoResearch/runGap', async (args, { rejectWithValue }) => {
  try { return await submitAppGapResearch(args.siteId, args.input); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const runAppCompetitorResearch = createAsyncThunk<
  AppCompetitorResearchResult,
  { siteId: string; input: AppCompetitorResearchInput },
  { rejectValue: string }
>('appSeoResearch/runCompetitors', async (args, { rejectWithValue }) => {
  try { return await submitAppCompetitorResearch(args.siteId, args.input); }
  catch (error) { return rejectWithValue(failure(error)); }
});
