import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { BACKLINK_PULL_TYPES, type BacklinkPullType, type BacklinksState, type DeepPullState, type LinkGapState } from '../types';
import {
  loadGapRun,
  loadLatestDeepPull,
  loadList,
  loadSummary,
  previewDeepPull,
  previewGap,
  refreshSummary,
  submitDeepPull,
  submitGap,
} from './thunks';

const emptyDeepPull = (): DeepPullState => ({
  preview: null,
  run: null,
  previewLoading: false,
  runLoading: false,
  submitting: false,
  error: '',
  errorKind: null,
});

const emptyDeepPulls = (): BacklinksState['deepPulls'] => ({
  refDomains: emptyDeepPull(),
  anchors: emptyDeepPull(),
  history: emptyDeepPull(),
  bulkRanks: emptyDeepPull(),
});

const emptyGap = (): LinkGapState => ({
  preview: null,
  run: null,
  previewLoading: false,
  runLoading: false,
  submitting: false,
  error: '',
  errorKind: null,
});

export const initialState: BacklinksState = {
  siteId: null,
  summary: null,
  list: null,
  loading: false,
  loaded: false,
  error: '',
  cursor: null,
  isRefreshing: false,
  cooldownUntil: null,
  refreshError: '',
  deepPulls: emptyDeepPulls(),
  gap: emptyGap(),
};

/**
 * Re-key when the caller's siteId differs from the slice's, so a site-B load
 * never sees leftover site-A state and stale site-A responses get dropped.
 */
const rekeyForSite = (state: BacklinksState, siteId: string): BacklinksState => {
  if (state.siteId === siteId) return state;
  return { ...initialState, siteId, loading: true };
};

const slice = createSlice({
  name: 'backlinks',
  initialState,
  reducers: {
    resetBacklinks: () => initialState,
    setCursor: (state, action: PayloadAction<string | null>) => {
      state.cursor = action.payload;
    },
    // Ticker hit zero — re-enable the refresh button.
    clearRefreshCooldown: (state) => {
      state.cooldownUntil = null;
    },
    cancelDeepPullPreview: (state, action: PayloadAction<BacklinkPullType>) => {
      state.deepPulls[action.payload].preview = null;
      state.deepPulls[action.payload].error = '';
      state.deepPulls[action.payload].errorKind = null;
    },
    cancelGapPreview: (state) => {
      state.gap.preview = null;
      state.gap.error = '';
      state.gap.errorKind = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSummary.pending, (state, action) => {
        const next = rekeyForSite(state, action.meta.arg.siteId);
        Object.assign(state, next);
        state.loading = true;
        state.error = '';
      })
      .addCase(loadSummary.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        state.summary = action.payload;
      })
      .addCase(loadSummary.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        state.error = action.payload?.error ?? '';
      })
      .addCase(loadList.pending, (state, action) => {
        const next = rekeyForSite(state, action.meta.arg.siteId);
        Object.assign(state, next);
        state.loading = true;
        state.error = '';
      })
      .addCase(loadList.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        state.list = action.meta.arg.cursor
          ? {
              ...action.payload,
              rows: [...(state.list?.rows ?? []), ...action.payload.rows],
            }
          : action.payload;
        state.cursor = action.payload.nextCursor;
      })
      .addCase(loadList.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        state.error = action.payload?.error ?? '';
      })
      .addCase(refreshSummary.pending, (state) => {
        state.isRefreshing = true;
        state.refreshError = '';
      })
      .addCase(refreshSummary.fulfilled, (state, action) => {
        state.isRefreshing = false;
        state.loaded = true;
        state.summary = action.payload;
      })
      .addCase(refreshSummary.rejected, (state, action) => {
        state.isRefreshing = false;
        state.refreshError = action.payload?.error ?? '';
        state.cooldownUntil = action.payload?.cooldownUntil ?? null;
      })
      .addCase(previewDeepPull.pending, (state, action) => {
        for (const type of BACKLINK_PULL_TYPES) {
          if (type !== action.meta.arg.type) state.deepPulls[type].preview = null;
        }
        const deep = state.deepPulls[action.meta.arg.type];
        deep.previewLoading = true;
        deep.error = '';
        deep.errorKind = null;
      })
      .addCase(previewDeepPull.fulfilled, (state, action) => {
        const deep = state.deepPulls[action.meta.arg.type];
        deep.previewLoading = false;
        deep.preview = action.payload;
      })
      .addCase(previewDeepPull.rejected, (state, action) => {
        const deep = state.deepPulls[action.meta.arg.type];
        deep.previewLoading = false;
        deep.error = action.payload?.error ?? '';
        deep.errorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(submitDeepPull.pending, (state, action) => {
        const deep = state.deepPulls[action.meta.arg.type];
        deep.submitting = true;
        deep.error = '';
        deep.errorKind = null;
      })
      .addCase(submitDeepPull.fulfilled, (state, action) => {
        const deep = state.deepPulls[action.meta.arg.type];
        deep.submitting = false;
        deep.preview = null;
        deep.run = action.payload;
      })
      .addCase(submitDeepPull.rejected, (state, action) => {
        const deep = state.deepPulls[action.meta.arg.type];
        deep.submitting = false;
        deep.error = action.payload?.error ?? '';
        deep.errorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(loadLatestDeepPull.pending, (state, action) => {
        const deep = state.deepPulls[action.meta.arg.type];
        deep.runLoading = true;
        deep.error = '';
        deep.errorKind = null;
      })
      .addCase(loadLatestDeepPull.fulfilled, (state, action) => {
        const deep = state.deepPulls[action.meta.arg.type];
        deep.runLoading = false;
        deep.run = action.payload;
      })
      .addCase(loadLatestDeepPull.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const deep = state.deepPulls[action.meta.arg.type];
        deep.runLoading = false;
        deep.error = action.payload?.error ?? '';
        deep.errorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(previewGap.pending, (state) => {
        state.gap.previewLoading = true;
        state.gap.error = '';
        state.gap.errorKind = null;
      })
      .addCase(previewGap.fulfilled, (state, action) => {
        state.gap.previewLoading = false;
        state.gap.preview = action.payload;
      })
      .addCase(previewGap.rejected, (state, action) => {
        state.gap.previewLoading = false;
        state.gap.error = action.payload?.error ?? '';
        state.gap.errorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(submitGap.pending, (state) => {
        state.gap.submitting = true;
        state.gap.error = '';
        state.gap.errorKind = null;
      })
      .addCase(submitGap.fulfilled, (state, action) => {
        state.gap.submitting = false;
        state.gap.preview = null;
        state.gap.run = action.payload;
      })
      .addCase(submitGap.rejected, (state, action) => {
        state.gap.submitting = false;
        state.gap.error = action.payload?.error ?? '';
        state.gap.errorKind = action.payload?.kind ?? 'unknown';
      })
      .addCase(loadGapRun.pending, (state) => {
        state.gap.runLoading = true;
        state.gap.error = '';
        state.gap.errorKind = null;
      })
      .addCase(loadGapRun.fulfilled, (state, action) => {
        state.gap.runLoading = false;
        state.gap.run = action.payload;
      })
      .addCase(loadGapRun.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.gap.runLoading = false;
        state.gap.error = action.payload?.error ?? '';
        state.gap.errorKind = action.payload?.kind ?? 'unknown';
      });
  },
});

export const {
  resetBacklinks,
  setCursor,
  clearRefreshCooldown,
  cancelDeepPullPreview,
  cancelGapPreview,
} = slice.actions;
export const backlinksReducer = slice.reducer;
