import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorMessage } from '@shared/api/errorMessage';
import {
  fetchAppReviewRun,
  fetchAppReviewRuns,
  startAppReviewRun,
} from '../reviews-api';
import type {
  AppReviewRunDetail,
  AppReviewRunListResponse,
  StartAppReviewRunInput,
  StartAppReviewRunResponse,
} from '../reviews-types';
import type { AppStoreKind } from '../tracking-types';

const failure = (error: unknown) => apiErrorMessage(error, 'appSeoReviews:errors.requestFailed');

export const loadAppReviewRuns = createAsyncThunk<
  AppReviewRunListResponse,
  { siteId: string; profileId: string; store: AppStoreKind },
  { rejectValue: string }
>('appSeoReviews/load', async (input, { rejectWithValue }) => {
  try { return await fetchAppReviewRuns(input.siteId, input.profileId, input.store); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const loadAppReviewRunDetail = createAsyncThunk<
  AppReviewRunDetail,
  { siteId: string; runId: string },
  { rejectValue: string }
>('appSeoReviews/detail', async (input, { rejectWithValue }) => {
  try { return await fetchAppReviewRun(input.siteId, input.runId); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const previewAppReviewRun = createAsyncThunk<
  StartAppReviewRunResponse,
  { siteId: string; input: Omit<StartAppReviewRunInput, 'confirm'> },
  { rejectValue: string }
>('appSeoReviews/preview', async (args, { rejectWithValue }) => {
  try { return await startAppReviewRun(args.siteId, { ...args.input, confirm: false }); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const confirmAppReviewRun = createAsyncThunk<
  StartAppReviewRunResponse,
  { siteId: string; input: Omit<StartAppReviewRunInput, 'confirm'> },
  { rejectValue: string }
>('appSeoReviews/confirm', async (args, { rejectWithValue }) => {
  try { return await startAppReviewRun(args.siteId, { ...args.input, confirm: true }); }
  catch (error) { return rejectWithValue(failure(error)); }
});
