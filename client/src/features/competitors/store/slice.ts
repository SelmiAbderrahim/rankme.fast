import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  Competitor,
  CompetitorIntelligenceState,
  CompetitorsState,
} from '../types';
import {
  acceptCompetitorOpportunity,
  addPortfolioCompetitor,
  cancelCompetitorLandscape,
  confirmCompetitorDiscovery,
  fetchTechStack,
  loadCompetitorDiscovery,
  loadCompetitorLandscapeDetail,
  loadCompetitorLandscapeRuns,
  loadCompetitorPortfolio,
  loadCompetitors,
  loadIntersection,
  mutatePortfolioCompetitor,
  previewCompetitorDiscovery,
  previewCompetitorLandscape,
  refreshCompetitors,
  startCompetitorLandscape,
} from './thunks';

/** Locate a loaded competitor row by domain, or undefined. */
const findRow = (
  state: CompetitorsState,
  domain: string,
): Competitor | undefined =>
  state.list?.competitors.find((c) => c.domain === domain);

export const initialIntelligenceState: CompetitorIntelligenceState = {
  siteId: null,
  profiles: [],
  profilesLoading: false,
  profilesLoaded: false,
  profilesError: '',
  mutationKey: null,
  mutationError: '',
  discovery: null,
  discoveryLoading: false,
  discoveryError: '',
  discoveryPreview: null,
  discoveryPreviewLoading: false,
  discoveryPreviewError: '',
  selectedProfileIds: [],
  landscapePreview: null,
  landscapePreviewLoading: false,
  landscapePreviewError: '',
  starting: false,
  startError: '',
  lastStartedRunId: null,
  lastStartDuplicate: false,
  runs: [],
  runsLoading: false,
  runsLoaded: false,
  runsError: '',
  runsNextCursor: null,
  detail: null,
  detailLoading: false,
  detailError: '',
  cancellingRunId: null,
  acceptingOpportunityId: null,
  actionError: '',
};

export const initialState: CompetitorsState = {
  siteId: null,
  list: null,
  intersection: null,
  selectedCompetitor: null,
  loading: false,
  loaded: false,
  intersectionLoading: false,
  error: '',
  intersectionError: '',
  isRefreshing: false,
  cooldownUntil: null,
  refreshError: '',
  intelligence: initialIntelligenceState,
};

/**
 * Re-key when the caller's siteId differs from the slice's, so a site-B load
 * never sees leftover site-A state and stale site-A responses get dropped.
 */
const rekeyForSite = (
  state: CompetitorsState,
  siteId: string,
): CompetitorsState => {
  if (state.siteId === siteId) return state;
  return {
    ...initialState,
    intelligence: { ...initialIntelligenceState },
    siteId,
    loading: true,
  };
};

const slice = createSlice({
  name: 'competitors',
  initialState,
  reducers: {
    resetCompetitors: () => initialState,
    selectCompetitor: (state, action: PayloadAction<string | null>) => {
      state.selectedCompetitor = action.payload;
    },
    // Ticker hit zero — re-enable the refresh button.
    clearRefreshCooldown: (state) => {
      state.cooldownUntil = null;
    },
    toggleLandscapeProfile: (state, action: PayloadAction<string>) => {
      const selected = state.intelligence.selectedProfileIds;
      const index = selected.indexOf(action.payload);
      if (index >= 0) selected.splice(index, 1);
      else selected.push(action.payload);
      state.intelligence.landscapePreview = null;
      state.intelligence.landscapePreviewError = '';
    },
    clearLandscapePreview: (state) => {
      state.intelligence.landscapePreview = null;
      state.intelligence.landscapePreviewError = '';
    },
    clearIntelligenceActionError: (state) => {
      state.intelligence.actionError = '';
      state.intelligence.mutationError = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadCompetitors.pending, (state, action) => {
        const next = rekeyForSite(state, action.meta.arg.siteId);
        Object.assign(state, next);
        state.loading = true;
        state.error = '';
      })
      .addCase(loadCompetitors.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        state.list = action.payload;
      })
      .addCase(loadCompetitors.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.siteId !== state.siteId) return;
        state.loading = false;
        state.loaded = true;
        /* v8 ignore next -- rejectWithValue always populates payload */
        state.error = action.payload?.error ?? '';
      })
      .addCase(loadIntersection.pending, (state, action) => {
        state.intersectionLoading = true;
        state.intersectionError = '';
        state.selectedCompetitor = action.meta.arg.competitor;
      })
      .addCase(loadIntersection.fulfilled, (state, action) => {
        state.intersectionLoading = false;
        state.intersection = action.payload;
      })
      .addCase(loadIntersection.rejected, (state, action) => {
        state.intersectionLoading = false;
        /* v8 ignore next -- rejectWithValue always populates payload */
        state.intersectionError = action.payload ?? '';
      })
      .addCase(refreshCompetitors.pending, (state) => {
        state.isRefreshing = true;
        state.refreshError = '';
      })
      .addCase(refreshCompetitors.fulfilled, (state, action) => {
        state.isRefreshing = false;
        state.loaded = true;
        state.list = action.payload;
      })
      .addCase(refreshCompetitors.rejected, (state, action) => {
        state.isRefreshing = false;
        /* v8 ignore next 2 -- rejectWithValue always populates payload */
        state.refreshError = action.payload?.error ?? '';
        state.cooldownUntil = action.payload?.cooldownUntil ?? null;
      })
      .addCase(fetchTechStack.pending, (state, action) => {
        const row = findRow(state, action.meta.arg.domain);
        if (row) row.techStack = { loading: true, error: '', entries: [] };
      })
      .addCase(fetchTechStack.fulfilled, (state, action) => {
        const row = findRow(state, action.payload.domain);
        if (row) {
          row.techStack = {
            loading: false,
            error: '',
            entries: action.payload.entries,
          };
        }
      })
      .addCase(fetchTechStack.rejected, (state, action) => {
        /* v8 ignore next -- rejectWithValue always populates payload */
        const domain = action.payload?.domain ?? action.meta.arg.domain;
        const row = findRow(state, domain);
        if (row) {
          row.techStack = {
            loading: false,
            /* v8 ignore next -- rejectWithValue always populates payload */
            error: action.payload?.error ?? '',
            entries: [],
          };
        }
      })
      .addCase(loadCompetitorPortfolio.pending, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) {
          state.intelligence = {
            ...initialIntelligenceState,
            siteId: action.meta.arg.siteId,
            profilesLoading: true,
          };
        } else {
          state.intelligence.profilesLoading = true;
        }
        state.intelligence.profilesError = '';
      })
      .addCase(loadCompetitorPortfolio.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.profilesLoading = false;
        state.intelligence.profilesLoaded = true;
        state.intelligence.profiles = action.payload;
        const active = new Set(
          action.payload.filter((profile) => profile.status === 'active').map((profile) => profile.id),
        );
        state.intelligence.selectedProfileIds = state.intelligence.selectedProfileIds.filter((id) =>
          active.has(id),
        );
      })
      .addCase(loadCompetitorPortfolio.rejected, (state, action) => {
        if (action.meta.aborted || state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.profilesLoading = false;
        state.intelligence.profilesLoaded = true;
        state.intelligence.profilesError = action.payload ?? '';
      })
      .addCase(addPortfolioCompetitor.pending, (state, action) => {
        state.intelligence.mutationKey = action.meta.arg.url;
        state.intelligence.mutationError = '';
      })
      .addCase(addPortfolioCompetitor.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.mutationKey = null;
        const index = state.intelligence.profiles.findIndex(
          (profile) => profile.id === action.payload.profile.id,
        );
        if (index >= 0) state.intelligence.profiles[index] = action.payload.profile;
        else state.intelligence.profiles.push(action.payload.profile);
        if (state.intelligence.discovery) {
          const suggestion = state.intelligence.discovery.suggestions.find(
            (item) => item.registrableDomain === action.payload.profile.registrableDomain,
          );
          if (suggestion) suggestion.alreadyConfirmed = true;
        }
      })
      .addCase(addPortfolioCompetitor.rejected, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.mutationKey = null;
        state.intelligence.mutationError = action.payload ?? '';
      })
      .addCase(mutatePortfolioCompetitor.pending, (state, action) => {
        state.intelligence.mutationKey = action.meta.arg.competitorId;
        state.intelligence.mutationError = '';
      })
      .addCase(mutatePortfolioCompetitor.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.mutationKey = null;
        const index = state.intelligence.profiles.findIndex(
          (profile) => profile.id === action.payload.id,
        );
        if (index >= 0) state.intelligence.profiles[index] = action.payload;
        if (action.payload.status === 'archived') {
          state.intelligence.selectedProfileIds = state.intelligence.selectedProfileIds.filter(
            (id) => id !== action.payload.id,
          );
        }
      })
      .addCase(mutatePortfolioCompetitor.rejected, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.mutationKey = null;
        state.intelligence.mutationError = action.payload ?? '';
      })
      .addCase(loadCompetitorDiscovery.pending, (state) => {
        state.intelligence.discoveryLoading = true;
        state.intelligence.discoveryError = '';
      })
      .addCase(loadCompetitorDiscovery.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.discoveryLoading = false;
        state.intelligence.discovery = action.payload;
      })
      .addCase(loadCompetitorDiscovery.rejected, (state, action) => {
        if (action.meta.aborted || state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.discoveryLoading = false;
        state.intelligence.discoveryError = action.payload ?? '';
      })
      .addCase(previewCompetitorDiscovery.pending, (state) => {
        state.intelligence.discoveryPreviewLoading = true;
        state.intelligence.discoveryPreviewError = '';
      })
      .addCase(previewCompetitorDiscovery.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.discoveryPreviewLoading = false;
        state.intelligence.discoveryPreview = action.payload;
      })
      .addCase(previewCompetitorDiscovery.rejected, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.discoveryPreviewLoading = false;
        state.intelligence.discoveryPreviewError = action.payload ?? '';
      })
      .addCase(confirmCompetitorDiscovery.pending, (state) => {
        state.intelligence.discoveryLoading = true;
        state.intelligence.discoveryError = '';
      })
      .addCase(confirmCompetitorDiscovery.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.discoveryLoading = false;
        state.intelligence.discovery = action.payload.discovery;
        state.intelligence.discoveryPreview = null;
      })
      .addCase(confirmCompetitorDiscovery.rejected, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.discoveryLoading = false;
        state.intelligence.discoveryError = action.payload ?? '';
      })
      .addCase(previewCompetitorLandscape.pending, (state) => {
        state.intelligence.landscapePreviewLoading = true;
        state.intelligence.landscapePreviewError = '';
      })
      .addCase(previewCompetitorLandscape.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.landscapePreviewLoading = false;
        state.intelligence.landscapePreview = action.payload;
      })
      .addCase(previewCompetitorLandscape.rejected, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.landscapePreviewLoading = false;
        state.intelligence.landscapePreviewError = action.payload ?? '';
      })
      .addCase(startCompetitorLandscape.pending, (state) => {
        state.intelligence.starting = true;
        state.intelligence.startError = '';
      })
      .addCase(startCompetitorLandscape.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.starting = false;
        state.intelligence.landscapePreview = null;
        state.intelligence.lastStartedRunId = action.payload.runId;
        state.intelligence.lastStartDuplicate = action.payload.duplicate;
      })
      .addCase(startCompetitorLandscape.rejected, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.starting = false;
        state.intelligence.startError = action.payload ?? '';
      })
      .addCase(loadCompetitorLandscapeRuns.pending, (state) => {
        state.intelligence.runsLoading = true;
        state.intelligence.runsError = '';
      })
      .addCase(loadCompetitorLandscapeRuns.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.runsLoading = false;
        state.intelligence.runsLoaded = true;
        state.intelligence.runs = action.payload.append
          ? [...state.intelligence.runs, ...action.payload.items]
          : action.payload.items;
        state.intelligence.runsNextCursor = action.payload.nextCursor;
      })
      .addCase(loadCompetitorLandscapeRuns.rejected, (state, action) => {
        if (action.meta.aborted || state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.runsLoading = false;
        state.intelligence.runsLoaded = true;
        state.intelligence.runsError = action.payload ?? '';
      })
      .addCase(loadCompetitorLandscapeDetail.pending, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.detailLoading = true;
        state.intelligence.detailError = '';
        // Keep the immutable report visible while URL-backed filters or the
        // progress poll load. Clearing it here would drop keyboard focus on
        // every character typed into the text filter.
      })
      .addCase(loadCompetitorLandscapeDetail.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.detailLoading = false;
        state.intelligence.detail = action.payload;
      })
      .addCase(loadCompetitorLandscapeDetail.rejected, (state, action) => {
        if (action.meta.aborted || state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.detailLoading = false;
        state.intelligence.detailError = action.payload ?? '';
      })
      .addCase(cancelCompetitorLandscape.pending, (state, action) => {
        state.intelligence.cancellingRunId = action.meta.arg.runId;
        state.intelligence.actionError = '';
      })
      .addCase(cancelCompetitorLandscape.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.cancellingRunId = null;
        const run = state.intelligence.runs.find((item) => item.id === action.payload.id);
        if (run) Object.assign(run, action.payload);
        if (state.intelligence.detail?.run.id === action.payload.id) {
          state.intelligence.detail.run = action.payload;
        }
      })
      .addCase(cancelCompetitorLandscape.rejected, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.cancellingRunId = null;
        state.intelligence.actionError = action.payload ?? '';
      })
      .addCase(acceptCompetitorOpportunity.pending, (state, action) => {
        state.intelligence.acceptingOpportunityId = action.meta.arg.opportunityId;
        state.intelligence.actionError = '';
      })
      .addCase(acceptCompetitorOpportunity.fulfilled, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.acceptingOpportunityId = null;
        const opportunity = state.intelligence.detail?.manifest?.opportunities.find(
          (item) => item.id === action.payload.opportunityId,
        );
        if (opportunity) opportunity.acceptedActionId = action.payload.actionId;
      })
      .addCase(acceptCompetitorOpportunity.rejected, (state, action) => {
        if (state.intelligence.siteId !== action.meta.arg.siteId) return;
        state.intelligence.acceptingOpportunityId = null;
        state.intelligence.actionError = action.payload ?? '';
      });
  },
});

export const {
  resetCompetitors,
  selectCompetitor,
  clearRefreshCooldown,
  toggleLandscapeProfile,
  clearLandscapePreview,
  clearIntelligenceActionError,
} = slice.actions;
export const competitorsReducer = slice.reducer;
