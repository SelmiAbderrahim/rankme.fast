import { createSlice } from '@reduxjs/toolkit';
import type { LocalSeoState } from '../types';
import { loadLocalBusinessSetup, loadLocalSeo, refreshLocalSeo, searchLocalBusiness, selectLocalBusiness, } from './thunks';

export const initialState: LocalSeoState = {
  siteId: null,
  snapshot: null,
  loading: false,
  loaded: false,
  error: '',
  isRefreshing: false,
  cooldownUntil: null,
  refreshError: '',
  setup: null,
  setupLoaded: false,
  setupError: '',
  searching: false,
  searchError: '',
  searched: false,
  selecting: false,
  selectError: '',
};

/**
 * Re-key when the caller's siteId differs from the slice's, so a site-B load
 * never sees leftover site-A state.
 */
const rekeyForSite = (state: LocalSeoState, siteId: string): LocalSeoState => {
  if (state.siteId === siteId) return state;
  return { ...initialState, siteId, loading: true };
};

const slice = createSlice({
  name: 'localSeo',
  initialState,
  reducers: {
    resetLocalSeo: () => initialState,
    clearRefreshCooldown: (state) => {
      state.cooldownUntil = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadLocalSeo.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.loading = true;
        state.error = '';
      })
      .addCase(loadLocalSeo.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        state.snapshot = action.payload;
      })
      .addCase(loadLocalSeo.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        /* v8 ignore next -- rejectWithValue always populates payload */
        state.error = action.payload?.error ?? '';
      })
      .addCase(refreshLocalSeo.pending, (state) => {
        state.isRefreshing = true;
        state.refreshError = '';
      })
      .addCase(refreshLocalSeo.fulfilled, (state, action) => {
        state.isRefreshing = false;
        state.loaded = true;
        const merged = state.snapshot
          ? {
              ...state.snapshot,
              provenance: action.payload.provenance,
              listings: action.payload.listings,
              fetchedAt: action.payload.fetchedAt,
              reviews: {
                averageRating: action.payload.reviews.averageRating,
                reviewCount: action.payload.reviews.reviewCount,
                unansweredQuestionCount: action.payload.qa.unansweredCount,
              },
              reviewsFetchedAt: action.payload.fetchedAt,
            }
          : {
              provenance: action.payload.provenance,
              listings: action.payload.listings,
              fetchedAt: action.payload.fetchedAt,
              reviews: {
                averageRating: action.payload.reviews.averageRating,
                reviewCount: action.payload.reviews.reviewCount,
                unansweredQuestionCount: action.payload.qa.unansweredCount,
              },
              reviewsFetchedAt: action.payload.fetchedAt,
              localPack: [],
            };
        state.snapshot = merged;
      })
      .addCase(loadLocalBusinessSetup.pending, (state, action) => {
        if (state.siteId !== action.meta.arg.siteId)
          Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.setupError = '';
      })
      .addCase(loadLocalBusinessSetup.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        state.setup = action.payload;
        state.setupLoaded = true;
      })
      .addCase(loadLocalBusinessSetup.rejected, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        state.setupLoaded = true;
        state.setupError = action.payload ?? '';
      })
      .addCase(searchLocalBusiness.pending, (state) => {
        state.searching = true;
        state.searchError = '';
        state.selectError = '';
      })
      .addCase(searchLocalBusiness.fulfilled, (state, action) => {
        state.searching = false;
        state.searched = true;
        state.setup = action.payload;
      })
      .addCase(searchLocalBusiness.rejected, (state, action) => {
        state.searching = false;
        state.searchError = action.payload ?? '';
      })
      .addCase(selectLocalBusiness.pending, (state) => {
        state.selecting = true;
        state.selectError = '';
      })
      .addCase(selectLocalBusiness.fulfilled, (state, action) => {
        state.selecting = false;
        state.searched = false;
        state.setup = action.payload;
      })
      .addCase(selectLocalBusiness.rejected, (state, action) => {
        state.selecting = false;
        state.selectError = action.payload ?? '';
      })
      .addCase(refreshLocalSeo.rejected, (state, action) => {
        state.isRefreshing = false;
        /* v8 ignore next 2 -- rejectWithValue always populates payload */
        state.refreshError = action.payload?.error ?? '';
        state.cooldownUntil = action.payload?.cooldownUntil ?? null;
      });
  },
});

export const { resetLocalSeo, clearRefreshCooldown } = slice.actions;
export const localSeoReducer = slice.reducer;
