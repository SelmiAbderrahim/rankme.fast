import { createSlice } from '@reduxjs/toolkit';
import type { TrafficSnapshotsState } from '../types';
import { fetchList, fetchOne, previewSnapshot, requestSnapshot } from './thunks';

export const initialTrafficSnapshotsState: TrafficSnapshotsState = {
  siteId: null,
  list: null,
  detail: null,
  preview: null,
  lastRequest: null,
  listStatus: 'idle',
  detailStatus: 'idle',
  previewStatus: 'idle',
  requestStatus: 'idle',
  listError: '',
  detailError: '',
  previewError: '',
  requestError: '',
  previewErrorKind: null,
  requestErrorKind: null,
};

const siteKey = (siteId?: string): string | null => siteId ?? null;

const rekeyForSite = (
  state: TrafficSnapshotsState,
  siteId?: string,
): TrafficSnapshotsState => {
  const nextSiteId = siteKey(siteId);
  return state.siteId === nextSiteId
    ? state
    : { ...initialTrafficSnapshotsState, siteId: nextSiteId };
};

const slice = createSlice({
  name: 'traffic-snapshots',
  initialState: initialTrafficSnapshotsState,
  reducers: {
    clearPreview: (state) => {
      state.preview = null;
      state.previewStatus = 'idle';
      state.previewError = '';
      state.previewErrorKind = null;
    },
    clearTrafficDetail: (state) => {
      state.detail = null;
      state.detailStatus = 'idle';
      state.detailError = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchList.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.listStatus = 'loading';
        state.listError = '';
      })
      .addCase(fetchList.fulfilled, (state, action) => {
        if (siteKey(action.meta.arg.siteId) !== state.siteId) return;
        state.listStatus = 'succeeded';
        state.list = action.payload;
      })
      .addCase(fetchList.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (siteKey(action.meta.arg.siteId) !== state.siteId) return;
        state.listStatus = 'failed';
        state.listError = action.payload ?? '';
      })
      .addCase(fetchOne.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.detailStatus = 'loading';
        state.detailError = '';
      })
      .addCase(fetchOne.fulfilled, (state, action) => {
        if (siteKey(action.meta.arg.siteId) !== state.siteId) return;
        state.detailStatus = 'succeeded';
        state.detail = action.payload;
      })
      .addCase(fetchOne.rejected, (state, action) => {
        if (siteKey(action.meta.arg.siteId) !== state.siteId) return;
        state.detailStatus = 'failed';
        state.detailError = action.payload ?? '';
      })
      .addCase(previewSnapshot.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.previewStatus = 'loading';
        state.preview = null;
        state.previewError = '';
        state.previewErrorKind = null;
      })
      .addCase(previewSnapshot.fulfilled, (state, action) => {
        if (siteKey(action.meta.arg.siteId) !== state.siteId) return;
        state.previewStatus = 'succeeded';
        state.preview = action.payload;
      })
      .addCase(previewSnapshot.rejected, (state, action) => {
        if (siteKey(action.meta.arg.siteId) !== state.siteId) return;
        state.previewStatus = 'failed';
        state.previewError = action.payload?.error ?? '';
        state.previewErrorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(requestSnapshot.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.requestStatus = 'loading';
        state.requestError = '';
        state.requestErrorKind = null;
      })
      .addCase(requestSnapshot.fulfilled, (state, action) => {
        if (siteKey(action.meta.arg.siteId) !== state.siteId) return;
        state.requestStatus = 'succeeded';
        state.lastRequest = action.payload;
        // The spend is committed — drop the preview so the confirm button
        // cannot re-submit the same reservation.
        state.preview = null;
        state.previewStatus = 'idle';
      })
      .addCase(requestSnapshot.rejected, (state, action) => {
        if (siteKey(action.meta.arg.siteId) !== state.siteId) return;
        state.requestStatus = 'failed';
        state.requestError = action.payload?.error ?? '';
        state.requestErrorKind = action.payload?.kind ?? 'unknown';
      });
  },
});

export const { clearPreview, clearTrafficDetail } = slice.actions;
export const trafficSnapshotsReducer = slice.reducer;
