import { createSlice } from '@reduxjs/toolkit';
import {
  initialBrandRadarDetailEntry,
  initialBrandRadarMentionEntry,
  type BrandRadarDetailEntry,
  type BrandRadarMentionEntry,
  type BrandRadarState,
} from '../types';
import {
  createBrandRadarScanThunk,
  loadBrandRadarMentions,
  loadBrandRadarScanDetail,
  loadBrandRadarScans,
  previewBrandRadarScanThunk,
} from './thunks';

/**
 * Both maps are keyed by scan id so re-opening a scan is instant. The entry is
 * created on first touch and read BACK off the draft so immer keeps tracking
 * the mutations the caller is about to make.
 */
const detailEntry = (
  state: BrandRadarState,
  scanId: string,
): BrandRadarDetailEntry => {
  const existing = state.details[scanId];
  if (existing) return existing;
  state.details[scanId] = { ...initialBrandRadarDetailEntry };
  return state.details[scanId]!;
};

const mentionEntry = (
  state: BrandRadarState,
  scanId: string,
): BrandRadarMentionEntry => {
  const existing = state.mentions[scanId];
  if (existing) return existing;
  state.mentions[scanId] = { ...initialBrandRadarMentionEntry, items: [] };
  return state.mentions[scanId]!;
};

export const initialBrandRadarState: BrandRadarState = {
  items: [],
  nextCursor: null,
  listStatus: 'idle',
  listError: '',
  loadingMore: false,
  optimistic: null,
  preview: null,
  previewStatus: 'idle',
  previewError: '',
  previewUnavailable: false,
  createStatus: 'idle',
  createError: '',
  createUnavailable: false,
  details: {},
  mentions: {},
};

const slice = createSlice({
  name: 'brandRadar',
  initialState: initialBrandRadarState,
  reducers: {
    clearBrandRadarPreview: (state) => {
      state.preview = null;
      state.previewStatus = 'idle';
      state.previewError = '';
      state.previewUnavailable = false;
      state.createStatus = 'idle';
      state.createError = '';
      state.createUnavailable = false;
    },
    resetBrandRadar: () => initialBrandRadarState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadBrandRadarScans.pending, (state, action) => {
        state.listStatus = 'loading';
        state.listError = '';
        state.loadingMore = Boolean(action.meta.arg?.cursor);
      })
      .addCase(loadBrandRadarScans.fulfilled, (state, action) => {
        state.listStatus = 'succeeded';
        state.loadingMore = false;
        state.items = action.meta.arg?.cursor
          ? [...state.items, ...action.payload.items]
          : action.payload.items;
        state.nextCursor = action.payload.nextCursor;
        // The server row is authoritative the moment it exists.
        if (
          state.optimistic &&
          state.items.some((item) => item.id === state.optimistic?.id)
        ) {
          state.optimistic = null;
        }
      })
      .addCase(loadBrandRadarScans.rejected, (state, action) => {
        state.loadingMore = false;
        if (action.meta.aborted) return;
        state.listStatus = 'failed';
        state.listError = action.payload ?? '';
      })
      .addCase(loadBrandRadarScanDetail.pending, (state, action) => {
        const entry = detailEntry(state, action.meta.arg.scanId);
        entry.status = 'loading';
        entry.error = '';
      })
      .addCase(loadBrandRadarScanDetail.fulfilled, (state, action) => {
        const entry = detailEntry(state, action.meta.arg.scanId);
        entry.status = 'succeeded';
        entry.detail = action.payload;
      })
      .addCase(loadBrandRadarScanDetail.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const entry = detailEntry(state, action.meta.arg.scanId);
        entry.status = 'failed';
        entry.error = action.payload ?? '';
      })
      .addCase(loadBrandRadarMentions.pending, (state, action) => {
        const entry = mentionEntry(state, action.meta.arg.scanId);
        entry.status = 'loading';
        entry.error = '';
        entry.loadingMore = Boolean(action.meta.arg.cursor);
      })
      .addCase(loadBrandRadarMentions.fulfilled, (state, action) => {
        const entry = mentionEntry(state, action.meta.arg.scanId);
        entry.status = 'succeeded';
        entry.loadingMore = false;
        // Keyset "load more" appends; a re-read from the head replaces. Ids
        // already held are dropped so a repeated cursor cannot duplicate rows.
        const incoming = action.meta.arg.cursor
          ? action.payload.items.filter(
              (item) => !entry.items.some((held) => held.id === item.id),
            )
          : action.payload.items;
        entry.items = action.meta.arg.cursor
          ? [...entry.items, ...incoming]
          : incoming;
        entry.nextCursor = action.payload.nextCursor;
      })
      .addCase(loadBrandRadarMentions.rejected, (state, action) => {
        const entry = mentionEntry(state, action.meta.arg.scanId);
        entry.loadingMore = false;
        if (action.meta.aborted) return;
        entry.status = 'failed';
        entry.error = action.payload ?? '';
      })
      .addCase(previewBrandRadarScanThunk.pending, (state) => {
        state.previewStatus = 'loading';
        state.preview = null;
        state.previewError = '';
        state.previewUnavailable = false;
      })
      .addCase(previewBrandRadarScanThunk.fulfilled, (state, action) => {
        state.previewStatus = 'succeeded';
        state.preview = action.payload;
      })
      .addCase(previewBrandRadarScanThunk.rejected, (state, action) => {
        state.previewStatus = 'failed';
        state.previewError = action.payload?.error ?? '';
        state.previewUnavailable = action.payload?.unavailable ?? false;
      })
      .addCase(createBrandRadarScanThunk.pending, (state) => {
        state.createStatus = 'loading';
        state.createError = '';
        state.createUnavailable = false;
      })
      .addCase(createBrandRadarScanThunk.fulfilled, (state, action) => {
        state.createStatus = 'succeeded';
        state.preview = null;
        state.previewStatus = 'idle';
        // Optimistic row built from the 202 payload + the query the caller
        // typed. No fabricated timestamp, no fabricated mention count.
        state.optimistic = {
          id: action.payload.scanId,
          brandQuery: action.meta.arg.input.brandQuery,
          language: action.meta.arg.input.language ?? null,
          outputLocale: action.payload.outputLocale,
          countryCode: action.meta.arg.input.countryCode ?? null,
          locationCode: action.meta.arg.input.locationCode ?? null,
          status: action.payload.status,
          digestState: 'pending',
          queryHash: action.payload.queryHash,
          priorScanId: action.payload.priorScanId,
        };
      })
      .addCase(createBrandRadarScanThunk.rejected, (state, action) => {
        state.createStatus = 'failed';
        state.createError = action.payload?.error ?? '';
        state.createUnavailable = action.payload?.unavailable ?? false;
      });
  },
});

export const { clearBrandRadarPreview, resetBrandRadar } = slice.actions;
export const brandRadarReducer = slice.reducer;
