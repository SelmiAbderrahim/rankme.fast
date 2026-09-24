import { createAsyncThunk } from '@reduxjs/toolkit';
import { apiErrorMessage, apiErrorStatus } from '@shared/api/errorMessage';
import {
  createBrandRadarScan,
  fetchBrandRadarMentions,
  fetchBrandRadarScan,
  fetchBrandRadarScans,
  previewBrandRadarScan,
} from '../api';
import type {
  BrandRadarMentionListResponse,
  BrandRadarPreview,
  BrandRadarScanCreated,
  BrandRadarScanDetail,
  BrandRadarScanInput,
  BrandRadarScanListResponse,
  BrandRadarThunkError,
} from '../types';

const refused = (error: unknown, fallbackKey: string): BrandRadarThunkError => ({
  error: apiErrorMessage(error, fallbackKey),
  unavailable: apiErrorStatus(error) === 503,
});

export interface LoadBrandRadarScansArg {
  siteId: string;
  cursor?: string;
}

export const loadBrandRadarScans = createAsyncThunk<
  BrandRadarScanListResponse,
  LoadBrandRadarScansArg,
  { rejectValue: string }
>('brandRadar/loadScans', async (arg, { rejectWithValue, signal }) => {
  try {
    return await fetchBrandRadarScans(arg.siteId, {
      ...(arg.cursor ? { cursor: arg.cursor } : {}),
      signal,
    });
  } catch (error) {
    return rejectWithValue(apiErrorMessage(error, 'brandRadar:errors.listFailed'));
  }
});

export interface LoadBrandRadarScanDetailArg {
  scanId: string;
}

export const loadBrandRadarScanDetail = createAsyncThunk<
  BrandRadarScanDetail,
  LoadBrandRadarScanDetailArg,
  { rejectValue: string }
>('brandRadar/loadDetail', async (arg, { rejectWithValue, signal }) => {
  try {
    return await fetchBrandRadarScan(arg.scanId, { signal });
  } catch (error) {
    return rejectWithValue(
      apiErrorMessage(error, 'brandRadar:errors.detailFailed'),
    );
  }
});

export interface LoadBrandRadarMentionsArg {
  scanId: string;
  cursor?: string;
}

export const loadBrandRadarMentions = createAsyncThunk<
  BrandRadarMentionListResponse,
  LoadBrandRadarMentionsArg,
  { rejectValue: string }
>('brandRadar/loadMentions', async (arg, { rejectWithValue, signal }) => {
  try {
    return await fetchBrandRadarMentions(arg.scanId, {
      ...(arg.cursor ? { cursor: arg.cursor } : {}),
      signal,
    });
  } catch (error) {
    return rejectWithValue(
      apiErrorMessage(error, 'brandRadar:errors.mentionsFailed'),
    );
  }
});

export interface BrandRadarScanArg {
  siteId: string;
  input: BrandRadarScanInput;
}

export const previewBrandRadarScanThunk = createAsyncThunk<
  BrandRadarPreview,
  BrandRadarScanArg,
  { rejectValue: BrandRadarThunkError }
>('brandRadar/preview', async ({ siteId, input }, { rejectWithValue }) => {
  try {
    return await previewBrandRadarScan(siteId, input);
  } catch (error) {
    return rejectWithValue(refused(error, 'brandRadar:errors.previewFailed'));
  }
});

export const createBrandRadarScanThunk = createAsyncThunk<
  BrandRadarScanCreated,
  BrandRadarScanArg,
  { rejectValue: BrandRadarThunkError }
>('brandRadar/create', async ({ siteId, input }, { rejectWithValue }) => {
  try {
    return await createBrandRadarScan(siteId, input);
  } catch (error) {
    return rejectWithValue(refused(error, 'brandRadar:errors.createFailed'));
  }
});
