import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorMessage } from '@shared/api/errorMessage';
import {
  fetchAppListingHistory,
  fetchLatestAppListing,
  startAppListingRun,
} from '../listing-api';
import type {
  AppListingHistoryResponse,
  AppListingReadResponse,
  AppListingRunInput,
  AppListingRunResponse,
} from '../listing-types';

const failure = (error: unknown) =>
  apiErrorMessage(error, 'appSeoListing:errors.requestFailed');

export const loadLatestAppListing = createAsyncThunk<
  AppListingReadResponse,
  { siteId: string; profileId: string },
  { rejectValue: string }
>('appSeoListing/latest', async (input, { rejectWithValue }) => {
  try {
    return await fetchLatestAppListing(input.siteId, input.profileId);
  } catch (error) {
    return rejectWithValue(failure(error));
  }
});

export const loadAppListingHistory = createAsyncThunk<
  AppListingHistoryResponse,
  { siteId: string; profileId: string; limit?: number },
  { rejectValue: string }
>('appSeoListing/history', async (input, { rejectWithValue }) => {
  try {
    return await fetchAppListingHistory(input.siteId, input.profileId, input.limit);
  } catch (error) {
    return rejectWithValue(failure(error));
  }
});

export const previewAppListingRun = createAsyncThunk<
  AppListingRunResponse,
  { siteId: string; input: Omit<AppListingRunInput, 'confirm'> },
  { rejectValue: string }
>('appSeoListing/preview', async (args, { rejectWithValue }) => {
  try {
    return await startAppListingRun(args.siteId, { ...args.input, confirm: false });
  } catch (error) {
    return rejectWithValue(failure(error));
  }
});

export const confirmAppListingRun = createAsyncThunk<
  AppListingRunResponse,
  { siteId: string; input: Omit<AppListingRunInput, 'confirm'> },
  { rejectValue: string }
>('appSeoListing/confirm', async (args, { rejectWithValue }) => {
  try {
    return await startAppListingRun(args.siteId, { ...args.input, confirm: true });
  } catch (error) {
    return rejectWithValue(failure(error));
  }
});
