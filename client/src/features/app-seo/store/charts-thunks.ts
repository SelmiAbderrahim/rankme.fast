import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorMessage } from '@shared/api/errorMessage';
import {
  createTrackedAppChart,
  fetchAppChartSubscriptions,
  fetchTrackedAppChartHistory,
  recheckTrackedAppChart,
  removeTrackedAppChart,
} from '../charts-api';
import type {
  AppChartHistoryPoint,
  AppChartListResponse,
  AppChartSubscription,
  CreateAppChartSubscriptionInput,
  RecheckAppChartResponse,
} from '../charts-types';

const failure = (error: unknown) => apiErrorMessage(error, 'appSeoCharts:errors.requestFailed');

export const loadTrackedAppCharts = createAsyncThunk<
  AppChartListResponse,
  { siteId: string; profileId: string },
  { rejectValue: string }
>('appSeoCharts/load', async (input, { rejectWithValue }) => {
  try { return await fetchAppChartSubscriptions(input.siteId, input.profileId); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const createAppChart = createAsyncThunk<
  AppChartSubscription,
  { siteId: string; input: CreateAppChartSubscriptionInput },
  { rejectValue: string }
>('appSeoCharts/create', async (args, { rejectWithValue }) => {
  try { return await createTrackedAppChart(args.siteId, args.input); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const deleteAppChart = createAsyncThunk<
  string,
  { siteId: string; subscriptionId: string },
  { rejectValue: string }
>('appSeoCharts/delete', async (args, { rejectWithValue }) => {
  try {
    await removeTrackedAppChart(args.siteId, args.subscriptionId);
    return args.subscriptionId;
  } catch (error) { return rejectWithValue(failure(error)); }
});

export const previewAppChartRecheck = createAsyncThunk<
  RecheckAppChartResponse,
  { siteId: string; subscriptionId: string },
  { rejectValue: string }
>('appSeoCharts/previewRecheck', async (args, { rejectWithValue }) => {
  try { return await recheckTrackedAppChart(args.siteId, args.subscriptionId, false); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const confirmAppChartRecheck = createAsyncThunk<
  RecheckAppChartResponse,
  { siteId: string; subscriptionId: string },
  { rejectValue: string }
>('appSeoCharts/confirmRecheck', async (args, { rejectWithValue }) => {
  try { return await recheckTrackedAppChart(args.siteId, args.subscriptionId, true); }
  catch (error) { return rejectWithValue(failure(error)); }
});

export const loadAppChartHistory = createAsyncThunk<
  AppChartHistoryPoint[],
  { siteId: string; subscriptionId: string },
  { rejectValue: string }
>('appSeoCharts/history', async (args, { rejectWithValue }) => {
  try { return await fetchTrackedAppChartHistory(args.siteId, args.subscriptionId); }
  catch (error) { return rejectWithValue(failure(error)); }
});
