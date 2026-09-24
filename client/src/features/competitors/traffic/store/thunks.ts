import { createAsyncThunk } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import { apiErrorMessage, apiErrorStatus } from '@shared/api/errorMessage';
import {
  fetchTrafficSnapshot,
  fetchTrafficSnapshots,
  previewTrafficSnapshot,
  requestTrafficSnapshot,
} from '../api';
import type {
  TrafficSnapshotDetail,
  TrafficSnapshotListFilters,
  TrafficSnapshotListResponse,
  TrafficSnapshotPreviewInput,
  TrafficSnapshotReadInput,
  TrafficSnapshotRequestInput,
  TrafficSnapshotRequestResult,
  TrafficSpendPreview,
  TrafficThunkError,
} from '../types';

const requestError = (error: unknown, fallbackKey: string): TrafficThunkError => {
  const status = apiErrorStatus(error);
  return {
    error: apiErrorMessage(error, fallbackKey),
    kind:
      status === 503
        ? 'locked'
        : error instanceof ApiError && error.code === 'timeout'
          ? 'timeout'
          : 'unknown',
  };
};

export const requestSnapshot = createAsyncThunk<
  TrafficSnapshotRequestResult,
  TrafficSnapshotRequestInput,
  { rejectValue: TrafficThunkError }
>('traffic-snapshots/request', async (input, { rejectWithValue }) => {
  try {
    return await requestTrafficSnapshot(input);
  } catch (error) {
    return rejectWithValue(requestError(error, 'competitorsTraffic:errors.requestFailed'));
  }
});

export const previewSnapshot = createAsyncThunk<
  TrafficSpendPreview,
  TrafficSnapshotPreviewInput,
  { rejectValue: TrafficThunkError }
>('traffic-snapshots/preview', async ({ domains }, { rejectWithValue }) => {
  try {
    return await previewTrafficSnapshot(domains);
  } catch (error) {
    return rejectWithValue(requestError(error, 'competitorsTraffic:errors.previewFailed'));
  }
});

export const fetchList = createAsyncThunk<
  TrafficSnapshotListResponse,
  TrafficSnapshotListFilters,
  { rejectValue: string }
>('traffic-snapshots/list', async (filters, { rejectWithValue, signal }) => {
  try {
    return await fetchTrafficSnapshots(filters, { signal });
  } catch (error) {
    return rejectWithValue(apiErrorMessage(error, 'competitorsTraffic:errors.listFailed'));
  }
});

export const fetchOne = createAsyncThunk<
  TrafficSnapshotDetail,
  TrafficSnapshotReadInput,
  { rejectValue: string }
>(
  'traffic-snapshots/detail',
  async ({ id, siteId }, { rejectWithValue }) => {
    try {
      return await fetchTrafficSnapshot(id, siteId);
    } catch (error) {
      return rejectWithValue(apiErrorMessage(error, 'competitorsTraffic:errors.detailFailed'));
    }
  },
);
