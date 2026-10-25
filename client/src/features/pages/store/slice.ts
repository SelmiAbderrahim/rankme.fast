import { createSlice } from '@reduxjs/toolkit';
import { pagesDetailCacheKey, pagesListCacheKey } from '../urlState';
import type {
  PagesCacheEntry,
  PagesDetailResponse,
  PagesListResponse,
  PagesRefreshState,
  PagesState,
} from '../types';
import { loadPagesDetail, loadPagesList, refreshPages, retainPagesSite } from './thunks';

export const initialPagesState: PagesState = {
  lists: {},
  details: {},
  refreshes: {},
};

const cacheEntry = <T>(): PagesCacheEntry<T> => ({
  data: null,
  loading: false,
  loaded: false,
  invalidated: false,
  loadedAt: null,
  error: null,
  requestId: null,
});

const refreshState = (): PagesRefreshState => ({
  loading: false,
  error: null,
  requestId: null,
  lastResult: null,
});

const listEntry = (state: PagesState, key: string): PagesCacheEntry<PagesListResponse> => {
  state.lists[key] ??= cacheEntry<PagesListResponse>();
  return state.lists[key];
};

const detailEntry = (state: PagesState, key: string): PagesCacheEntry<PagesDetailResponse> => {
  state.details[key] ??= cacheEntry<PagesDetailResponse>();
  return state.details[key];
};

const siteRefresh = (state: PagesState, siteId: string): PagesRefreshState => {
  state.refreshes[siteId] ??= refreshState();
  return state.refreshes[siteId];
};

const pagesSlice = createSlice({
  name: 'pages',
  initialState: initialPagesState,
  reducers: {
    resetPagesState: () => initialPagesState,
  },
  extraReducers: (builder) => {
    builder
      // Another site is now on screen: forget every other site's answers.
      .addCase(retainPagesSite, (state, action) => {
        const listPrefix = `${action.payload}?`;
        const detailPrefix = `${action.payload}/`;
        for (const key of Object.keys(state.lists)) {
          if (!key.startsWith(listPrefix)) delete state.lists[key];
        }
        for (const key of Object.keys(state.details)) {
          if (!key.startsWith(detailPrefix)) delete state.details[key];
        }
        for (const siteId of Object.keys(state.refreshes)) {
          if (siteId !== action.payload) delete state.refreshes[siteId];
        }
      })
      .addCase(loadPagesList.pending, (state, action) => {
        const key = pagesListCacheKey(action.meta.arg.siteId, action.meta.arg.query);
        const entry = listEntry(state, key);
        entry.loading = true;
        entry.error = null;
        entry.requestId = action.meta.requestId;
      })
      .addCase(loadPagesList.fulfilled, (state, action) => {
        const entry = listEntry(state, action.payload.key);
        if (entry.requestId !== action.meta.requestId) return;
        entry.data = action.payload.data;
        entry.loading = false;
        entry.loaded = true;
        entry.invalidated = false;
        entry.loadedAt = Date.now();
        entry.error = null;
      })
      .addCase(loadPagesList.rejected, (state, action) => {
        const key = pagesListCacheKey(action.meta.arg.siteId, action.meta.arg.query);
        const entry = listEntry(state, key);
        if (action.meta.aborted || entry.requestId !== action.meta.requestId) return;
        entry.loading = false;
        entry.loaded = true;
        entry.error = action.payload ?? null;
      })
      .addCase(loadPagesDetail.pending, (state, action) => {
        const key = pagesDetailCacheKey(
          action.meta.arg.siteId,
          action.meta.arg.range,
          action.meta.arg.pageId,
        );
        const entry = detailEntry(state, key);
        entry.loading = true;
        entry.error = null;
        entry.requestId = action.meta.requestId;
      })
      .addCase(loadPagesDetail.fulfilled, (state, action) => {
        const entry = detailEntry(state, action.payload.key);
        if (entry.requestId !== action.meta.requestId) return;
        entry.data = action.payload.data;
        entry.loading = false;
        entry.loaded = true;
        entry.invalidated = false;
        entry.loadedAt = Date.now();
        entry.error = null;
      })
      .addCase(loadPagesDetail.rejected, (state, action) => {
        const key = pagesDetailCacheKey(
          action.meta.arg.siteId,
          action.meta.arg.range,
          action.meta.arg.pageId,
        );
        const entry = detailEntry(state, key);
        if (action.meta.aborted || entry.requestId !== action.meta.requestId) return;
        entry.loading = false;
        entry.loaded = true;
        entry.error = action.payload ?? null;
      })
      .addCase(refreshPages.pending, (state, action) => {
        const refresh = siteRefresh(state, action.meta.arg.siteId);
        refresh.loading = true;
        refresh.error = null;
        refresh.requestId = action.meta.requestId;
        // Refresh replaces what is stored for the whole site, so every cached
        // list and inspector for it is out of date, not just the visible one.
        for (const key of Object.keys(state.lists)) {
          if (key.startsWith(`${action.meta.arg.siteId}?`)) state.lists[key]!.invalidated = true;
        }
        for (const key of Object.keys(state.details)) {
          if (key.startsWith(`${action.meta.arg.siteId}/`)) state.details[key]!.invalidated = true;
        }
        listEntry(
          state,
          pagesListCacheKey(action.meta.arg.siteId, action.meta.arg.query),
        ).invalidated = true;
        if (action.meta.arg.pageId !== null) {
          detailEntry(
            state,
            pagesDetailCacheKey(
              action.meta.arg.siteId,
              action.meta.arg.query.range,
              action.meta.arg.pageId,
            ),
          ).invalidated = true;
        }
      })
      .addCase(refreshPages.fulfilled, (state, action) => {
        const refresh = siteRefresh(state, action.meta.arg.siteId);
        if (refresh.requestId !== action.meta.requestId) return;
        refresh.loading = false;
        refresh.error = null;
        refresh.lastResult = action.payload.refresh;
      })
      .addCase(refreshPages.rejected, (state, action) => {
        const refresh = siteRefresh(state, action.meta.arg.siteId);
        if (action.meta.aborted || refresh.requestId !== action.meta.requestId) return;
        refresh.loading = false;
        refresh.error = action.payload ?? null;

        const retained = listEntry(
          state,
          pagesListCacheKey(action.meta.arg.siteId, action.meta.arg.query),
        );
        if (retained.data !== null && action.payload?.state) {
          retained.data.envelope = action.payload.state.envelope;
        }
      });
  },
});

export const { resetPagesState } = pagesSlice.actions;
export const pagesReducer = pagesSlice.reducer;
