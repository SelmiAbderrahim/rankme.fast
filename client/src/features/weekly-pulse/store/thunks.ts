import { createAsyncThunk } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import {
  getGenerativeAppearance as getGenerativeAppearanceApi,
  getWeeklyPulseHistoryDetail as getHistoryDetailApi,
  getWeeklyPulseState as getStateApi,
  listWeeklyPulseHistory as listHistoryApi,
  previewWeeklyPulse as previewApi,
  setWeeklyPulseSubscription as setSubApi,
} from '../api';
import type {
  GscGenerativeAppearanceRead,
  PulseHistoryDetail,
  PulseHistoryPage,
  PulseStateView,
  SetSubscriptionRequest,
  SpendPreview,
} from '../types';

export interface RejectPayload {
  error: string;
  status?: number;
  reconnectRequired?: boolean;
}

function normalizeError(err: unknown): RejectPayload {
  if (err instanceof ApiError) {
    return {
      error: err.message || 'weeklyPulse.errors.unexpected',
      status: err.status,
      reconnectRequired: err.status === 404 && /reconnect/i.test(err.message),
    };
  }
  return { error: (err as Error)?.message ?? 'weeklyPulse.errors.unexpected' };
}

export const fetchWeeklyPulseState = createAsyncThunk<
  PulseStateView,
  { siteId: string },
  { rejectValue: RejectPayload }
>('weeklyPulse/fetchState', async (arg, { rejectWithValue, signal }) => {
  try {
    return await getStateApi(arg.siteId, { signal });
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});

export const previewWeeklyPulseSpend = createAsyncThunk<
  SpendPreview,
  { siteId: string },
  { rejectValue: RejectPayload }
>('weeklyPulse/preview', async (arg, { rejectWithValue, signal }) => {
  try {
    return await previewApi(arg.siteId, { signal });
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});

export const setSubscription = createAsyncThunk<
  PulseStateView,
  { siteId: string } & SetSubscriptionRequest,
  { rejectValue: RejectPayload }
>('weeklyPulse/setSubscription', async (arg, { rejectWithValue, signal }) => {
  try {
    const { siteId, ...body } = arg;
    return await setSubApi(siteId, body, { signal });
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});

export const fetchWeeklyPulseHistory = createAsyncThunk<
  { page: PulseHistoryPage; siteId: string; direction: 'initial' | 'next' },
  { siteId: string; cursor?: string | null; limit?: number; direction?: 'initial' | 'next' },
  { rejectValue: RejectPayload }
>('weeklyPulse/fetchHistory', async (arg, { rejectWithValue, signal }) => {
  try {
    const params: { limit?: number; cursor?: string } = {};
    if (arg.limit !== undefined) params.limit = arg.limit;
    if (arg.cursor) params.cursor = arg.cursor;
    const page = await listHistoryApi(arg.siteId, params, { signal });
    return { page, siteId: arg.siteId, direction: arg.direction ?? 'initial' };
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});

export const fetchWeeklyPulseDetail = createAsyncThunk<
  PulseHistoryDetail,
  { siteId: string; pulseId: string },
  { rejectValue: RejectPayload }
>('weeklyPulse/fetchDetail', async (arg, { rejectWithValue, signal }) => {
  try {
    return await getHistoryDetailApi(arg.siteId, arg.pulseId, { signal });
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});

export const fetchGenerativeAppearance = createAsyncThunk<
  GscGenerativeAppearanceRead,
  { siteId: string },
  { rejectValue: RejectPayload }
>('weeklyPulse/fetchGscGenerative', async (arg, { rejectWithValue, signal }) => {
  try {
    const { appearance } = await getGenerativeAppearanceApi(arg.siteId, { signal });
    return appearance;
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});
