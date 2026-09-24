import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  ClusterDecisionState,
  KeywordMetric,
  KeywordResearchState,
  RelatedKeyword,
} from '../types';
import {
  decideCluster,
  exploreLiveTrends,
  fetchIdeas,
  fetchLongTail,
  fetchIntent,
  fetchKeywordPreview,
  loadClusterRun,
  loadClusterRuns,
  loadHistory,
  loadLiveTrendsList,
  loadLiveTrendsRun,
  loadMetrics,
  loadRelated,
  previewLiveTrends,
  runClusters,
  runGap,
  runOverview,
  runTrends,
} from './thunks';

/** Decision sub-state key — one slot per (run, cluster) pair. */
export function decisionKey(runId: string, clusterId: string): string {
  return `${runId}:${clusterId}`;
}

const EMPTY_DECISION: ClusterDecisionState = {
  pending: false,
  result: null,
  error: '',
  conflict: false,
};

/** Merge the known intent map onto a metrics list (race-proof: either the
 * metrics load or the intent load can arrive first). */
function mergeIntent(
  metrics: KeywordMetric[],
  intentByKeyword: KeywordResearchState['intentByKeyword'],
): KeywordMetric[] {
  return metrics.map((m) => {
    const hit = intentByKeyword[m.keyword];
    return hit ? { ...m, intent: hit.intent, confidence: hit.confidence } : m;
  });
}

/** Cache key for the related-keywords lookup — includes locale so that
 * switching location/language forces a refetch. */
export function relatedCacheKey(
  keyword: string,
  locationCode: number,
  languageCode: string,
): string {
  return `${keyword}::${locationCode}::${languageCode}`;
}

export const initialState: KeywordResearchState = {
  metrics: [],
  loading: false,
  loaded: false,
  error: '',
  expandedKeyword: null,
  relatedByKeyword: {},
  relatedLoading: false,
  relatedError: '',
  addToTrackingError: '',
  addingToTrackingKeyword: null,
  intentByKeyword: {},
  intentLoading: false,
  intentError: '',
  ideas: [],
  ideasLoading: false,
  ideasError: '',
  ideasSeed: null,
  longTail: {
    suggestions: [],
    loading: false,
    error: '',
    seed: null,
    cached: null,
    locationCode: null,
    languageCode: null,
  },
  history: [],
  historyLoading: false,
  historyLoaded: false,
  historyError: '',
  historyCursor: null,
  preview: { loading: false, data: null, error: '', forOperation: null },
  gap: { loading: false, data: null, error: '' },
  overview: { loading: false, rows: [], loaded: false, error: '' },
  trends: { loading: false, rows: [], loaded: false, error: '' },
  clusters: {
    running: false,
    run: null,
    runError: '',
    runs: [],
    runsLoading: false,
    runsLoaded: false,
    runsError: '',
    runsCursor: null,
    detailLoading: false,
    detailError: '',
    decisions: {},
  },
  liveTrends: {
    preview: { loading: false, data: null, error: '', errorKind: null },
    run: { loading: false, data: null, error: '', errorKind: null },
    list: { loading: false, data: null, error: '', errorKind: null },
    storedRun: { loading: false, data: null, error: '', errorKind: null },
  },
};

const slice = createSlice({
  name: 'keywordResearch',
  initialState,
  reducers: {
    setExpanded: (state, action: PayloadAction<string | null>) => {
      state.expandedKeyword = action.payload;
    },
    clearMessages: (state) => {
      state.error = '';
      state.relatedError = '';
      state.addToTrackingError = '';
      state.intentError = '';
      state.ideasError = '';
      state.longTail.error = '';
    },
    beginAddToTracking: (state, action: PayloadAction<string>) => {
      state.addingToTrackingKeyword = action.payload;
      state.addToTrackingError = '';
    },
    resolveAddToTracking: (state, action: PayloadAction<{ error?: string }>) => {
      state.addingToTrackingKeyword = null;
      state.addToTrackingError = action.payload.error ?? '';
    },
    /** Cancelling a spend preview discards it without any request. */
    clearPreview: (state) => {
      state.preview = { loading: false, data: null, error: '', forOperation: null };
    },
    /** Cancel a pending live-trends preview without spending a unit. */
    clearLiveTrendsPreview: (state) => {
      state.liveTrends.preview = { loading: false, data: null, error: '', errorKind: null };
    },
    /** Discard the current live-trends run + preview + last stored-run read. */
    resetLiveTrends: (state) => {
      state.liveTrends = {
        preview: { loading: false, data: null, error: '', errorKind: null },
        run: { loading: false, data: null, error: '', errorKind: null },
        list: state.liveTrends.list,
        storedRun: { loading: false, data: null, error: '', errorKind: null },
      };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadMetrics.pending, (state) => {
        state.loading = true;
        state.error = '';
      })
      .addCase(loadMetrics.fulfilled, (state, action) => {
        state.loading = false;
        state.loaded = true;
        // Apply any intent already known (from a prior/racing /intent call).
        state.metrics = mergeIntent(action.payload.keywords, state.intentByKeyword);
      })
      .addCase(loadMetrics.rejected, (state, action) => {
        state.loading = false;
        state.loaded = true;
        /* v8 ignore next -- loadMetrics always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.error = action.payload?.error ?? '';
      })
      .addCase(loadRelated.pending, (state, action) => {
        state.relatedLoading = true;
        state.relatedError = '';
        state.expandedKeyword = action.meta.arg.keyword;
      })
      .addCase(loadRelated.fulfilled, (state, action) => {
        state.relatedLoading = false;
        const key = relatedCacheKey(
          action.payload.keyword,
          action.meta.arg.locationCode,
          action.meta.arg.languageCode,
        );
        state.relatedByKeyword[key] = action.payload.related;
      })
      .addCase(loadRelated.rejected, (state, action) => {
        state.relatedLoading = false;
        /* v8 ignore next -- loadRelated always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.relatedError = action.payload ?? '';
      })
      .addCase(fetchIntent.pending, (state) => {
        state.intentLoading = true;
        state.intentError = '';
      })
      .addCase(fetchIntent.fulfilled, (state, action) => {
        state.intentLoading = false;
        for (const row of action.payload.intents) {
          state.intentByKeyword[row.keyword] = {
            intent: row.intent,
            confidence: row.confidence,
          };
        }
        // Merge onto whatever metrics are currently loaded (may have arrived
        // before OR after this intent response).
        state.metrics = mergeIntent(state.metrics, state.intentByKeyword);
      })
      .addCase(fetchIntent.rejected, (state, action) => {
        state.intentLoading = false;
        /* v8 ignore next -- fetchIntent always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.intentError = action.payload ?? '';
      })
      .addCase(fetchIdeas.pending, (state, action) => {
        state.ideasLoading = true;
        state.ideasError = '';
        state.ideasSeed = action.meta.arg.seed;
      })
      .addCase(fetchIdeas.fulfilled, (state, action) => {
        state.ideasLoading = false;
        state.ideasSeed = action.payload.seed;
        // Append fresh ideas, de-duplicating against entries already present so
        // repeated "Get ideas" clicks accumulate without duplicate rows.
        const seen = new Set(state.ideas.map((r) => r.keyword));
        for (const row of action.payload.ideas) {
          if (seen.has(row.keyword)) continue;
          seen.add(row.keyword);
          state.ideas.push(row as RelatedKeyword);
        }
      })
      .addCase(fetchIdeas.rejected, (state, action) => {
        state.ideasLoading = false;
        /* v8 ignore next -- fetchIdeas always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.ideasError = action.payload?.error ?? '';
      })
      .addCase(fetchLongTail.pending, (state, action) => {
        state.longTail = {
          suggestions: [],
          loading: true,
          error: '',
          seed: action.meta.arg.seed,
          cached: null,
          locationCode: action.meta.arg.locationCode,
          languageCode: action.meta.arg.languageCode,
        };
      })
      .addCase(fetchLongTail.fulfilled, (state, action) => {
        state.longTail = {
          suggestions: action.payload.suggestions,
          loading: false,
          error: '',
          seed: action.payload.seed,
          cached: action.payload.cached,
          locationCode: action.meta.arg.locationCode,
          languageCode: action.meta.arg.languageCode,
        };
      })
      .addCase(fetchLongTail.rejected, (state, action) => {
        state.longTail.loading = false;
        /* v8 ignore next -- fetchLongTail always rejects with a populated payload. */
        state.longTail.error = action.payload?.error ?? '';
      })
      .addCase(loadHistory.pending, (state) => {
        state.historyLoading = true;
        state.historyError = '';
      })
      .addCase(loadHistory.fulfilled, (state, action) => {
        state.historyLoading = false;
        state.historyLoaded = true;
        // Cursor pages append; a cursor-less load replaces (fresh first page).
        state.history = action.meta.arg.cursor
          ? [...state.history, ...action.payload.items]
          : action.payload.items;
        state.historyCursor = action.payload.nextCursor;
      })
      .addCase(loadHistory.rejected, (state, action) => {
        state.historyLoading = false;
        state.historyLoaded = true;
        /* v8 ignore next -- loadHistory always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.historyError = action.payload?.error ?? '';
      })
      // --- Spend preview ---------------------------------------------------
      .addCase(fetchKeywordPreview.pending, (state, action) => {
        state.preview.loading = true;
        state.preview.error = '';
        state.preview.forOperation = action.meta.arg.operation;
      })
      .addCase(fetchKeywordPreview.fulfilled, (state, action) => {
        state.preview.loading = false;
        state.preview.data = action.payload;
      })
      .addCase(fetchKeywordPreview.rejected, (state, action) => {
        state.preview.loading = false;
        state.preview.data = null;
        /* v8 ignore next -- fetchKeywordPreview always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.preview.error = action.payload?.error ?? '';
      })
      // --- gap ------------------------------------------------------------
      .addCase(runGap.pending, (state) => {
        state.gap.loading = true;
        state.gap.error = '';
      })
      .addCase(runGap.fulfilled, (state, action) => {
        state.gap.loading = false;
        state.gap.data = action.payload;
        state.preview = { loading: false, data: null, error: '', forOperation: null };
      })
      .addCase(runGap.rejected, (state, action) => {
        state.gap.loading = false;
        /* v8 ignore next -- runGap always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.gap.error = action.payload?.error ?? '';
      })
      // --- overview -------------------------------------------------------
      .addCase(runOverview.pending, (state) => {
        state.overview.loading = true;
        state.overview.error = '';
      })
      .addCase(runOverview.fulfilled, (state, action) => {
        state.overview.loading = false;
        state.overview.loaded = true;
        state.overview.rows = action.payload.keywords;
        state.preview = { loading: false, data: null, error: '', forOperation: null };
      })
      .addCase(runOverview.rejected, (state, action) => {
        state.overview.loading = false;
        state.overview.loaded = true;
        /* v8 ignore next -- runOverview always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.overview.error = action.payload?.error ?? '';
      })
      // --- trends ---------------------------------------------------------
      .addCase(runTrends.pending, (state) => {
        state.trends.loading = true;
        state.trends.error = '';
      })
      .addCase(runTrends.fulfilled, (state, action) => {
        state.trends.loading = false;
        state.trends.loaded = true;
        state.trends.rows = action.payload.keywords;
        state.preview = { loading: false, data: null, error: '', forOperation: null };
      })
      .addCase(runTrends.rejected, (state, action) => {
        state.trends.loading = false;
        state.trends.loaded = true;
        /* v8 ignore next -- runTrends always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.trends.error = action.payload?.error ?? '';
      })
      // --- clusters run ---------------------------------------------------
      .addCase(runClusters.pending, (state) => {
        state.clusters.running = true;
        state.clusters.runError = '';
      })
      .addCase(runClusters.fulfilled, (state, action) => {
        state.clusters.running = false;
        state.clusters.run = action.payload;
        // A fresh run belongs at the top of the stored-runs list; an
        // identical rerun (same runId) replaces its stored entry.
        const rest = state.clusters.runs.filter(
          (r) => r.runId !== action.payload.runId,
        );
        state.clusters.runs = [action.payload, ...rest];
      })
      .addCase(runClusters.rejected, (state, action) => {
        state.clusters.running = false;
        /* v8 ignore next -- runClusters always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.clusters.runError = action.payload?.error ?? '';
      })
      // --- clusters list --------------------------------------------------
      .addCase(loadClusterRuns.pending, (state) => {
        state.clusters.runsLoading = true;
        state.clusters.runsError = '';
      })
      .addCase(loadClusterRuns.fulfilled, (state, action) => {
        state.clusters.runsLoading = false;
        state.clusters.runsLoaded = true;
        // Cursor pages append; a cursor-less load replaces (fresh first page).
        state.clusters.runs = action.meta.arg.cursor
          ? [...state.clusters.runs, ...action.payload.runs]
          : action.payload.runs;
        state.clusters.runsCursor = action.payload.nextCursor;
      })
      .addCase(loadClusterRuns.rejected, (state, action) => {
        state.clusters.runsLoading = false;
        state.clusters.runsLoaded = true;
        /* v8 ignore next -- loadClusterRuns always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.clusters.runsError = action.payload?.error ?? '';
      })
      // --- cluster run detail (URL `run` param reload survival) -----------
      .addCase(loadClusterRun.pending, (state) => {
        state.clusters.detailLoading = true;
        state.clusters.detailError = '';
      })
      .addCase(loadClusterRun.fulfilled, (state, action) => {
        state.clusters.detailLoading = false;
        state.clusters.run = action.payload;
      })
      .addCase(loadClusterRun.rejected, (state, action) => {
        state.clusters.detailLoading = false;
        /* v8 ignore next -- loadClusterRun always populates payload via rejectWithValue; the null-payload fallback is defence. */
        state.clusters.detailError = action.payload?.error ?? '';
      })
      // --- cluster decisions ---------------------------------------------
      .addCase(decideCluster.pending, (state, action) => {
        const key = decisionKey(action.meta.arg.runId, action.meta.arg.clusterId);
        state.clusters.decisions[key] = {
          ...(state.clusters.decisions[key] ?? EMPTY_DECISION),
          pending: true,
          error: '',
          conflict: false,
        };
      })
      .addCase(decideCluster.fulfilled, (state, action) => {
        const key = decisionKey(action.payload.runId, action.payload.clusterId);
        state.clusters.decisions[key] = {
          pending: false,
          result: action.payload,
          error: '',
          conflict: false,
        };
      })
      .addCase(decideCluster.rejected, (state, action) => {
        /* v8 ignore next -- decideCluster always populates payload via rejectWithValue; the null-payload fallback is defence. */
        if (!action.payload) return;
        const key = decisionKey(action.payload.runId, action.payload.clusterId);
        state.clusters.decisions[key] = {
          ...(state.clusters.decisions[key] ?? EMPTY_DECISION),
          pending: false,
          error: action.payload.error,
          // 409 → someone (or a replay with a different kind) already decided
          // this cluster; the view refetches the run and shows the banner.
          conflict: action.payload.status === 409,
        };
      })
      // --- Live Keyword Trends -----------------------------------------
      .addCase(previewLiveTrends.pending, (state) => {
        state.liveTrends.preview.loading = true;
        state.liveTrends.preview.error = '';
        state.liveTrends.preview.errorKind = null;
      })
      .addCase(previewLiveTrends.fulfilled, (state, action) => {
        state.liveTrends.preview.loading = false;
        state.liveTrends.preview.data = action.payload;
      })
      .addCase(previewLiveTrends.rejected, (state, action) => {
        state.liveTrends.preview.loading = false;
        state.liveTrends.preview.data = null;
        state.liveTrends.preview.error = action.payload?.error ?? '';
        state.liveTrends.preview.errorKind = action.payload?.kind ?? null;
      })
      .addCase(exploreLiveTrends.pending, (state) => {
        state.liveTrends.run.loading = true;
        state.liveTrends.run.error = '';
        state.liveTrends.run.errorKind = null;
      })
      .addCase(exploreLiveTrends.fulfilled, (state, action) => {
        state.liveTrends.run.loading = false;
        state.liveTrends.run.data = action.payload;
        // Consume the preview — the next submission needs a fresh estimate.
        state.liveTrends.preview = { loading: false, data: null, error: '', errorKind: null };
        // Optimistic prepend into the stored-history list (server-authoritative
        // refetch will overwrite on next `loadLiveTrendsList`).
        if (state.liveTrends.list.data) {
          const rest = state.liveTrends.list.data.runs.filter(
            (r) => r.runId !== action.payload.runId,
          );
          state.liveTrends.list.data = {
            runs: [
              {
                runId: action.payload.runId,
                status: action.payload.status,
                retained: action.payload.retained,
                refunded: action.payload.refunded,
                errorCode: action.payload.errorCode,
                inputs: action.payload.inputs,
                siteId: null,
                seriesCount: action.payload.series.length,
                relatedQueryCount: action.payload.relatedQueries.length,
                createdAt: action.payload.createdAt,
                completedAt: action.payload.completedAt,
                source: 'estimate',
                observationMeta: { searchInterestIndexKey:
                  'keywordResearch.trends.coverageNote.searchInterestIndex' },
              },
              ...rest,
            ],
            nextCursor: state.liveTrends.list.data.nextCursor,
          };
        }
      })
      .addCase(exploreLiveTrends.rejected, (state, action) => {
        state.liveTrends.run.loading = false;
        state.liveTrends.run.error = action.payload?.error ?? '';
        state.liveTrends.run.errorKind = action.payload?.kind ?? null;
      })
      .addCase(loadLiveTrendsList.pending, (state) => {
        state.liveTrends.list.loading = true;
        state.liveTrends.list.error = '';
        state.liveTrends.list.errorKind = null;
      })
      .addCase(loadLiveTrendsList.fulfilled, (state, action) => {
        state.liveTrends.list.loading = false;
        // Cursor pages append; a cursor-less load replaces the first page.
        if (action.meta.arg.cursor && state.liveTrends.list.data) {
          const seen = new Set(state.liveTrends.list.data.runs.map((r) => r.runId));
          const merged = [...state.liveTrends.list.data.runs];
          for (const row of action.payload.runs) {
            if (seen.has(row.runId)) continue;
            seen.add(row.runId);
            merged.push(row);
          }
          state.liveTrends.list.data = { runs: merged, nextCursor: action.payload.nextCursor };
        } else {
          state.liveTrends.list.data = action.payload;
        }
      })
      .addCase(loadLiveTrendsList.rejected, (state, action) => {
        state.liveTrends.list.loading = false;
        state.liveTrends.list.error = action.payload?.error ?? '';
        state.liveTrends.list.errorKind = action.payload?.kind ?? null;
      })
      .addCase(loadLiveTrendsRun.pending, (state) => {
        state.liveTrends.storedRun.loading = true;
        state.liveTrends.storedRun.error = '';
        state.liveTrends.storedRun.errorKind = null;
      })
      .addCase(loadLiveTrendsRun.fulfilled, (state, action) => {
        state.liveTrends.storedRun.loading = false;
        state.liveTrends.storedRun.data = action.payload;
      })
      .addCase(loadLiveTrendsRun.rejected, (state, action) => {
        state.liveTrends.storedRun.loading = false;
        state.liveTrends.storedRun.data = null;
        state.liveTrends.storedRun.error = action.payload?.error ?? '';
        state.liveTrends.storedRun.errorKind = action.payload?.kind ?? null;
      });
  },
});

export const {
  setExpanded,
  clearMessages,
  beginAddToTracking,
  resolveAddToTracking,
  clearPreview,
  clearLiveTrendsPreview,
  resetLiveTrends,
} = slice.actions;
export const keywordResearchReducer = slice.reducer;
