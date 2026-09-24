import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  ContentAnalysis,
  InventoryRun,
  InventoryRunDetail,
  PreflightReason,
  PreflightResponse,
  CompetitorContentRun,
  CompetitorContentRunDetail,
  CompetitorProfile,
  CompetitorSuggestion,
  ContentMonitor,
  MonitorFeedEvent,
} from '../types';
import {
  cancelAnalysisThunk,
  loadAnalyses,
  loadAnalysis,
  regenerateAnalysisThunk,
  runPreflight,
  submitAnalysis,
  cancelInventoryThunk,
  loadInventoryRun,
  loadInventoryRuns,
  startInventoryThunk,
  addCompetitorThunk,
  archiveCompetitorThunk,
  cancelCompetitorRunThunk,
  loadCompetitorProfiles,
  loadCompetitorRun,
  loadCompetitorRuns,
  loadCompetitorSuggestions,
  restoreCompetitorThunk,
  startCompetitorRunThunk,
  loadMonitors,
  createMonitorThunk,
  loadMonitorFeed,
  pauseMonitorThunk,
  resumeMonitorThunk,
  deleteMonitorThunk,
  loadMonitorNotificationPref,
  updateMonitorNotificationPref,
} from './thunks';

export interface ContentIntelligenceState {
  siteId: string | null;
  analyses: ContentAnalysis[];
  nextCursor: string | null;
  listLoading: boolean;
  listLoaded: boolean;
  listError: string;
  detail: Record<string, ContentAnalysis | undefined>;
  detailLoading: Record<string, boolean | undefined>;
  detailError: Record<string, string | undefined>;
  activeAnalysisId: string | null;
  submitting: boolean;
  submitError: string;
  lastStartedId: string | null;
  preflight: PreflightResponse | null;
  preflightLoading: boolean;
  preflightReason: PreflightReason;
  cancelling: Record<string, boolean | undefined>;
  regenerating: Record<string, boolean | undefined>;
  formDraft: {
    ownedUrl: string;
    keyword: string;
    locale: string;
    consent: boolean;
  };
  inventory: InventoryState;
  competitorContent: CompetitorContentState;
  monitoring: MonitoringState;
}

/** Content Inventory sub-view state — a branch of the same slice. */
export interface InventoryState {
  runs: InventoryRun[];
  nextCursor: string | null;
  listLoading: boolean;
  listLoaded: boolean;
  listError: string;
  detail: Record<string, InventoryRunDetail | undefined>;
  detailLoading: Record<string, boolean | undefined>;
  detailError: Record<string, string | undefined>;
  submitting: boolean;
  submitError: string;
  lastStartedRunId: string | null;
  cancelling: Record<string, boolean | undefined>;
}

export const inventoryInitialState: InventoryState = {
  runs: [],
  nextCursor: null,
  listLoading: false,
  listLoaded: false,
  listError: '',
  detail: {},
  detailLoading: {},
  detailError: {},
  submitting: false,
  submitError: '',
  lastStartedRunId: null,
  cancelling: {},
};

/**
 * Competitor content intelligence (Agency) sub-view state — another
 * branch of the same slice (no new reducerPath). Holds the confirmed-competitor
 * portfolio, DataForSEO-backed suggestions, the paged run list, per-run detail,
 * and the mutation / poll flags.
 */
export interface CompetitorContentState {
  profiles: CompetitorProfile[];
  profilesLoading: boolean;
  profilesLoaded: boolean;
  profilesError: string;
  suggestions: CompetitorSuggestion[];
  suggestionsLoading: boolean;
  suggestionsLoaded: boolean;
  suggestionsError: string;
  /** URL currently being confirmed / added (drives per-button loading). */
  addingKey: string | null;
  addError: string;
  /** Per-competitor archive / restore in flight, keyed by competitor id. */
  mutatingId: Record<string, boolean | undefined>;
  mutateError: string;
  runs: CompetitorContentRun[];
  nextCursor: string | null;
  listLoading: boolean;
  listLoaded: boolean;
  listError: string;
  detail: Record<string, CompetitorContentRunDetail | undefined>;
  detailLoading: Record<string, boolean | undefined>;
  detailError: Record<string, string | undefined>;
  submitting: boolean;
  submitError: string;
  lastStartedRunId: string | null;
  cancelling: Record<string, boolean | undefined>;
}

export const competitorContentInitialState: CompetitorContentState = {
  profiles: [],
  profilesLoading: false,
  profilesLoaded: false,
  profilesError: '',
  suggestions: [],
  suggestionsLoading: false,
  suggestionsLoaded: false,
  suggestionsError: '',
  addingKey: null,
  addError: '',
  mutatingId: {},
  mutateError: '',
  runs: [],
  nextCursor: null,
  listLoading: false,
  listLoaded: false,
  listError: '',
  detail: {},
  detailLoading: {},
  detailError: {},
  submitting: false,
  submitError: '',
  lastStartedRunId: null,
  cancelling: {},
};

/**
 * Public-page change monitoring (Agency) sub-view state — another
 * branch of the same slice (no new reducerPath). Holds the monitor list + live
 * allowance (`activeLimit`/`usedSlots`), the per-monitor change feed, the
 * create / pause / resume / delete flags, and the `emailMonitorChange`
 * notification preference mirror.
 */
export interface MonitoringState {
  monitors: ContentMonitor[];
  activeLimit: number;
  usedSlots: number;
  listLoading: boolean;
  listLoaded: boolean;
  listError: string;
  /** Per-monitor detail (from the change-feed GET) keyed by monitorId. */
  detail: Record<string, ContentMonitor | undefined>;
  feed: Record<string, MonitorFeedEvent[] | undefined>;
  feedCursor: Record<string, string | null | undefined>;
  detailLoading: Record<string, boolean | undefined>;
  detailError: Record<string, string | undefined>;
  submitting: boolean;
  submitError: string;
  lastCreatedMonitorId: string | null;
  /** Per-monitor pause / resume / delete in flight, keyed by monitor id. */
  mutatingId: Record<string, boolean | undefined>;
  mutateError: string;
  /** `emailMonitorChange` preference mirror (null until first load). */
  notificationPref: boolean | null;
  notificationLoading: boolean;
  notificationSaving: boolean;
  notificationError: string;
}

export const monitoringInitialState: MonitoringState = {
  monitors: [],
  activeLimit: 0,
  usedSlots: 0,
  listLoading: false,
  listLoaded: false,
  listError: '',
  detail: {},
  feed: {},
  feedCursor: {},
  detailLoading: {},
  detailError: {},
  submitting: false,
  submitError: '',
  lastCreatedMonitorId: null,
  mutatingId: {},
  mutateError: '',
  notificationPref: null,
  notificationLoading: false,
  notificationSaving: false,
  notificationError: '',
};

export const initialState: ContentIntelligenceState = {
  siteId: null,
  analyses: [],
  nextCursor: null,
  listLoading: false,
  listLoaded: false,
  listError: '',
  detail: {},
  detailLoading: {},
  detailError: {},
  activeAnalysisId: null,
  submitting: false,
  submitError: '',
  lastStartedId: null,
  preflight: null,
  preflightLoading: false,
  preflightReason: null,
  cancelling: {},
  regenerating: {},
  formDraft: {
    ownedUrl: '',
    keyword: '',
    locale: '',
    consent: false,
  },
  inventory: inventoryInitialState,
  competitorContent: competitorContentInitialState,
  monitoring: monitoringInitialState,
};

const rekeyForSite = (
  state: ContentIntelligenceState,
  siteId: string,
): ContentIntelligenceState => {
  if (state.siteId === siteId) return state;
  return {
    ...initialState,
    siteId,
    formDraft: { ...initialState.formDraft, locale: state.formDraft.locale },
  };
};

const slice = createSlice({
  name: 'contentIntelligence',
  initialState,
  reducers: {
    resetContentIntelligence: () => initialState,
    setActiveAnalysisId: (state, action: PayloadAction<string | null>) => {
      state.activeAnalysisId = action.payload;
    },
    updateFormDraft: (
      state,
      action: PayloadAction<Partial<ContentIntelligenceState['formDraft']>>,
    ) => {
      state.formDraft = { ...state.formDraft, ...action.payload };
    },
    clearFormDraft: (state) => {
      state.formDraft = { ...initialState.formDraft, locale: state.formDraft.locale };
      state.submitError = '';
    },
    clearSubmitError: (state) => {
      state.submitError = '';
    },
    clearInventorySubmitError: (state) => {
      state.inventory.submitError = '';
    },
    clearCompetitorSubmitError: (state) => {
      state.competitorContent.submitError = '';
    },
    clearCompetitorAddError: (state) => {
      state.competitorContent.addError = '';
    },
    clearMonitorSubmitError: (state) => {
      state.monitoring.submitError = '';
    },
    clearMonitorMutateError: (state) => {
      state.monitoring.mutateError = '';
    },
    upsertAnalysis: (state, action: PayloadAction<ContentAnalysis>) => {
      const idx = state.analyses.findIndex(
        (a) => a.analysisId === action.payload.analysisId,
      );
      if (idx >= 0) state.analyses[idx] = action.payload;
      else state.analyses.unshift(action.payload);
      state.detail[action.payload.analysisId] = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadAnalyses.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.listLoading = true;
        state.listError = '';
      })
      .addCase(loadAnalyses.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        state.listLoading = false;
        state.listLoaded = true;
        state.nextCursor = action.payload.page.nextCursor;
        if (action.payload.append) {
          state.analyses = [
            ...state.analyses,
            ...action.payload.page.items.filter(
              (n) => !state.analyses.some((e) => e.analysisId === n.analysisId),
            ),
          ];
        } else {
          state.analyses = action.payload.page.items;
        }
        for (const item of action.payload.page.items) {
          state.detail[item.analysisId] = item;
        }
      })
      .addCase(loadAnalyses.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.listLoading = false;
        state.listLoaded = true;
        state.listError = action.payload?.error ?? '';
      })
      .addCase(loadAnalysis.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.detailLoading[action.meta.arg.analysisId] = true;
        state.detailError[action.meta.arg.analysisId] = '';
      })
      .addCase(loadAnalysis.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId || action.payload.siteId !== state.siteId) {
          return;
        }
        state.detailLoading[action.payload.analysisId] = false;
        state.detail[action.payload.analysisId] = action.payload;
        const idx = state.analyses.findIndex(
          (a) => a.analysisId === action.payload.analysisId,
        );
        if (idx >= 0) state.analyses[idx] = action.payload;
      })
      .addCase(loadAnalysis.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.siteId !== state.siteId) return;
        state.detailLoading[action.meta.arg.analysisId] = false;
        state.detailError[action.meta.arg.analysisId] =
          action.payload?.error ?? '';
      })
      .addCase(runPreflight.pending, (state) => {
        state.preflightLoading = true;
      })
      .addCase(runPreflight.fulfilled, (state, action) => {
        state.preflightLoading = false;
        state.preflight = action.payload;
        state.preflightReason = action.payload.reason;
      })
      .addCase(runPreflight.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.preflightLoading = false;
        state.preflight = null;
      })
      .addCase(submitAnalysis.pending, (state) => {
        state.submitting = true;
        state.submitError = '';
      })
      .addCase(submitAnalysis.fulfilled, (state, action) => {
        state.submitting = false;
        state.lastStartedId = action.payload.analysisId;
      })
      .addCase(submitAnalysis.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.submitting = false;
        state.submitError = action.payload?.error ?? '';
      })
      .addCase(cancelAnalysisThunk.pending, (state, action) => {
        state.cancelling[action.meta.arg.analysisId] = true;
      })
      .addCase(cancelAnalysisThunk.fulfilled, (state, action) => {
        state.cancelling[action.meta.arg.analysisId] = false;
      })
      .addCase(cancelAnalysisThunk.rejected, (state, action) => {
        state.cancelling[action.meta.arg.analysisId] = false;
      })
      .addCase(regenerateAnalysisThunk.pending, (state, action) => {
        state.regenerating[action.meta.arg.analysisId] = true;
      })
      .addCase(regenerateAnalysisThunk.fulfilled, (state, action) => {
        state.regenerating[action.meta.arg.analysisId] = false;
        state.lastStartedId = action.payload.analysisId;
      })
      .addCase(regenerateAnalysisThunk.rejected, (state, action) => {
        state.regenerating[action.meta.arg.analysisId] = false;
      })
      // -- Content Inventory ------------------------------------
      .addCase(loadInventoryRuns.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        // Reassign a fresh object: after a site-change rekey `state.inventory`
        // is the frozen initial constant, so mutate via a new literal that
        // preserves runs on a same-site reload (poll) and empties them on a
        // site switch.
        state.inventory = {
          ...state.inventory,
          listLoading: true,
          listError: '',
        };
      })
      .addCase(loadInventoryRuns.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        const inv = state.inventory;
        inv.listLoading = false;
        inv.listLoaded = true;
        inv.nextCursor = action.payload.page.nextCursor;
        if (action.payload.append) {
          inv.runs = [
            ...inv.runs,
            ...action.payload.page.items.filter(
              (n) => !inv.runs.some((e) => e.runId === n.runId),
            ),
          ];
        } else {
          inv.runs = action.payload.page.items;
        }
      })
      .addCase(loadInventoryRuns.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const inv = state.inventory;
        inv.listLoading = false;
        inv.listLoaded = true;
        inv.listError = action.payload?.error ?? '';
      })
      .addCase(loadInventoryRun.pending, (state, action) => {
        state.inventory.detailLoading[action.meta.arg.runId] = true;
        state.inventory.detailError[action.meta.arg.runId] = '';
      })
      .addCase(loadInventoryRun.fulfilled, (state, action) => {
        const inv = state.inventory;
        inv.detailLoading[action.payload.runId] = false;
        inv.detail[action.payload.runId] = action.payload;
        const idx = inv.runs.findIndex((r) => r.runId === action.payload.runId);
        if (idx >= 0) inv.runs[idx] = action.payload;
      })
      .addCase(loadInventoryRun.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.inventory.detailLoading[action.meta.arg.runId] = false;
        state.inventory.detailError[action.meta.arg.runId] =
          action.payload?.error ?? '';
      })
      .addCase(startInventoryThunk.pending, (state) => {
        const inv = state.inventory;
        inv.submitting = true;
        inv.submitError = '';
      })
      .addCase(startInventoryThunk.fulfilled, (state, action) => {
        state.inventory.submitting = false;
        state.inventory.lastStartedRunId = action.payload.runId;
      })
      .addCase(startInventoryThunk.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const inv = state.inventory;
        inv.submitting = false;
        inv.submitError = action.payload?.error ?? '';
      })
      .addCase(cancelInventoryThunk.pending, (state, action) => {
        state.inventory.cancelling[action.meta.arg.runId] = true;
      })
      .addCase(cancelInventoryThunk.fulfilled, (state, action) => {
        state.inventory.cancelling[action.meta.arg.runId] = false;
      })
      .addCase(cancelInventoryThunk.rejected, (state, action) => {
        state.inventory.cancelling[action.meta.arg.runId] = false;
      })
      // -- Competitor content intelligence ----------------------
      .addCase(loadCompetitorProfiles.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.competitorContent = {
          ...state.competitorContent,
          profilesLoading: true,
          profilesError: '',
        };
      })
      .addCase(loadCompetitorProfiles.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        const cc = state.competitorContent;
        cc.profilesLoading = false;
        cc.profilesLoaded = true;
        cc.profiles = action.payload.profiles;
      })
      .addCase(loadCompetitorProfiles.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const cc = state.competitorContent;
        cc.profilesLoading = false;
        cc.profilesLoaded = true;
        cc.profilesError = action.payload?.error ?? '';
      })
      .addCase(loadCompetitorSuggestions.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.competitorContent = {
          ...state.competitorContent,
          suggestionsLoading: true,
          suggestionsError: '',
        };
      })
      .addCase(loadCompetitorSuggestions.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        const cc = state.competitorContent;
        cc.suggestionsLoading = false;
        cc.suggestionsLoaded = true;
        cc.suggestions = action.payload.suggestions;
      })
      .addCase(loadCompetitorSuggestions.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const cc = state.competitorContent;
        cc.suggestionsLoading = false;
        cc.suggestionsLoaded = true;
        cc.suggestionsError = action.payload?.error ?? '';
      })
      .addCase(addCompetitorThunk.pending, (state, action) => {
        const cc = state.competitorContent;
        cc.addingKey = action.meta.arg.url;
        cc.addError = '';
      })
      .addCase(addCompetitorThunk.fulfilled, (state) => {
        state.competitorContent.addingKey = null;
      })
      .addCase(addCompetitorThunk.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const cc = state.competitorContent;
        cc.addingKey = null;
        cc.addError = action.payload?.error ?? '';
      })
      .addCase(archiveCompetitorThunk.pending, (state, action) => {
        const cc = state.competitorContent;
        cc.mutatingId[action.meta.arg.competitorId] = true;
        cc.mutateError = '';
      })
      .addCase(archiveCompetitorThunk.fulfilled, (state, action) => {
        applyProfileMutation(state.competitorContent, action.meta.arg.competitorId, action.payload.profile);
      })
      .addCase(archiveCompetitorThunk.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const cc = state.competitorContent;
        cc.mutatingId[action.meta.arg.competitorId] = false;
        cc.mutateError = action.payload?.error ?? '';
      })
      .addCase(restoreCompetitorThunk.pending, (state, action) => {
        const cc = state.competitorContent;
        cc.mutatingId[action.meta.arg.competitorId] = true;
        cc.mutateError = '';
      })
      .addCase(restoreCompetitorThunk.fulfilled, (state, action) => {
        applyProfileMutation(state.competitorContent, action.meta.arg.competitorId, action.payload.profile);
      })
      .addCase(restoreCompetitorThunk.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const cc = state.competitorContent;
        cc.mutatingId[action.meta.arg.competitorId] = false;
        cc.mutateError = action.payload?.error ?? '';
      })
      .addCase(startCompetitorRunThunk.pending, (state) => {
        const cc = state.competitorContent;
        cc.submitting = true;
        cc.submitError = '';
      })
      .addCase(startCompetitorRunThunk.fulfilled, (state, action) => {
        state.competitorContent.submitting = false;
        state.competitorContent.lastStartedRunId = action.payload.runId;
      })
      .addCase(startCompetitorRunThunk.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const cc = state.competitorContent;
        cc.submitting = false;
        cc.submitError = action.payload?.error ?? '';
      })
      .addCase(loadCompetitorRuns.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.competitorContent = {
          ...state.competitorContent,
          listLoading: true,
          listError: '',
        };
      })
      .addCase(loadCompetitorRuns.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        const cc = state.competitorContent;
        cc.listLoading = false;
        cc.listLoaded = true;
        cc.nextCursor = action.payload.page.nextCursor;
        if (action.payload.append) {
          cc.runs = [
            ...cc.runs,
            ...action.payload.page.items.filter(
              (n) => !cc.runs.some((e) => e.runId === n.runId),
            ),
          ];
        } else {
          cc.runs = action.payload.page.items;
        }
      })
      .addCase(loadCompetitorRuns.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const cc = state.competitorContent;
        cc.listLoading = false;
        cc.listLoaded = true;
        cc.listError = action.payload?.error ?? '';
      })
      .addCase(loadCompetitorRun.pending, (state, action) => {
        state.competitorContent.detailLoading[action.meta.arg.runId] = true;
        state.competitorContent.detailError[action.meta.arg.runId] = '';
      })
      .addCase(loadCompetitorRun.fulfilled, (state, action) => {
        const cc = state.competitorContent;
        cc.detailLoading[action.payload.runId] = false;
        cc.detail[action.payload.runId] = action.payload;
        const idx = cc.runs.findIndex((r) => r.runId === action.payload.runId);
        if (idx >= 0) cc.runs[idx] = action.payload;
      })
      .addCase(loadCompetitorRun.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.competitorContent.detailLoading[action.meta.arg.runId] = false;
        state.competitorContent.detailError[action.meta.arg.runId] =
          action.payload?.error ?? '';
      })
      .addCase(cancelCompetitorRunThunk.pending, (state, action) => {
        state.competitorContent.cancelling[action.meta.arg.runId] = true;
      })
      .addCase(cancelCompetitorRunThunk.fulfilled, (state, action) => {
        state.competitorContent.cancelling[action.meta.arg.runId] = false;
      })
      .addCase(cancelCompetitorRunThunk.rejected, (state, action) => {
        state.competitorContent.cancelling[action.meta.arg.runId] = false;
      })
      // -- Public-page change monitoring ------------------------
      .addCase(loadMonitors.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.monitoring = {
          ...state.monitoring,
          listLoading: true,
          listError: '',
        };
      })
      .addCase(loadMonitors.fulfilled, (state, action) => {
        if (action.meta.arg.siteId !== state.siteId) return;
        const mon = state.monitoring;
        mon.listLoading = false;
        mon.listLoaded = true;
        mon.monitors = action.payload.response.monitors;
        mon.activeLimit = action.payload.response.activeLimit;
        mon.usedSlots = action.payload.response.usedSlots;
        for (const m of action.payload.response.monitors) {
          mon.detail[m.monitorId] = m;
        }
      })
      .addCase(loadMonitors.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const mon = state.monitoring;
        mon.listLoading = false;
        mon.listLoaded = true;
        mon.listError = action.payload?.error ?? '';
      })
      .addCase(createMonitorThunk.pending, (state) => {
        const mon = state.monitoring;
        mon.submitting = true;
        mon.submitError = '';
      })
      .addCase(createMonitorThunk.fulfilled, (state, action) => {
        const mon = state.monitoring;
        mon.submitting = false;
        mon.lastCreatedMonitorId = action.payload.monitor.monitorId;
        upsertMonitor(mon, action.payload.monitor);
      })
      .addCase(createMonitorThunk.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const mon = state.monitoring;
        mon.submitting = false;
        mon.submitError = action.payload?.error ?? '';
      })
      .addCase(loadMonitorFeed.pending, (state, action) => {
        state.monitoring.detailLoading[action.meta.arg.monitorId] = true;
        state.monitoring.detailError[action.meta.arg.monitorId] = '';
      })
      .addCase(loadMonitorFeed.fulfilled, (state, action) => {
        const mon = state.monitoring;
        const id = action.payload.monitorId;
        mon.detailLoading[id] = false;
        mon.detail[id] = action.payload.response.monitor;
        upsertMonitor(mon, action.payload.response.monitor);
        if (action.payload.append) {
          const existing = mon.feed[id] ?? [];
          const known = new Set(existing.map((e) => e.eventKey));
          mon.feed[id] = [
            ...existing,
            ...action.payload.response.feed.filter((e) => !known.has(e.eventKey)),
          ];
        } else {
          mon.feed[id] = action.payload.response.feed;
        }
        mon.feedCursor[id] = action.payload.response.nextCursor;
      })
      .addCase(loadMonitorFeed.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.monitoring.detailLoading[action.meta.arg.monitorId] = false;
        state.monitoring.detailError[action.meta.arg.monitorId] =
          action.payload?.error ?? '';
      })
      .addCase(pauseMonitorThunk.pending, (state, action) => {
        const mon = state.monitoring;
        mon.mutatingId[action.meta.arg.monitorId] = true;
        mon.mutateError = '';
      })
      .addCase(pauseMonitorThunk.fulfilled, (state, action) => {
        applyMonitorMutation(state.monitoring, action.meta.arg.monitorId, action.payload.monitor);
      })
      .addCase(pauseMonitorThunk.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const mon = state.monitoring;
        mon.mutatingId[action.meta.arg.monitorId] = false;
        mon.mutateError = action.payload?.error ?? '';
      })
      .addCase(resumeMonitorThunk.pending, (state, action) => {
        const mon = state.monitoring;
        mon.mutatingId[action.meta.arg.monitorId] = true;
        mon.mutateError = '';
      })
      .addCase(resumeMonitorThunk.fulfilled, (state, action) => {
        applyMonitorMutation(state.monitoring, action.meta.arg.monitorId, action.payload.monitor);
      })
      .addCase(resumeMonitorThunk.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const mon = state.monitoring;
        mon.mutatingId[action.meta.arg.monitorId] = false;
        mon.mutateError = action.payload?.error ?? '';
      })
      .addCase(deleteMonitorThunk.pending, (state, action) => {
        const mon = state.monitoring;
        mon.mutatingId[action.meta.arg.monitorId] = true;
        mon.mutateError = '';
      })
      .addCase(deleteMonitorThunk.fulfilled, (state, action) => {
        const mon = state.monitoring;
        const id = action.meta.arg.monitorId;
        mon.mutatingId[id] = false;
        mon.monitors = mon.monitors.filter((m) => m.monitorId !== id);
        mon.usedSlots = Math.max(0, mon.usedSlots - 1);
        delete mon.detail[id];
        delete mon.feed[id];
        delete mon.feedCursor[id];
      })
      .addCase(deleteMonitorThunk.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const mon = state.monitoring;
        mon.mutatingId[action.meta.arg.monitorId] = false;
        mon.mutateError = action.payload?.error ?? '';
      })
      .addCase(loadMonitorNotificationPref.pending, (state) => {
        state.monitoring.notificationLoading = true;
        state.monitoring.notificationError = '';
      })
      .addCase(loadMonitorNotificationPref.fulfilled, (state, action) => {
        state.monitoring.notificationLoading = false;
        state.monitoring.notificationPref = action.payload;
      })
      .addCase(loadMonitorNotificationPref.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.monitoring.notificationLoading = false;
        state.monitoring.notificationError = action.payload?.error ?? '';
      })
      .addCase(updateMonitorNotificationPref.pending, (state) => {
        state.monitoring.notificationSaving = true;
        state.monitoring.notificationError = '';
      })
      .addCase(updateMonitorNotificationPref.fulfilled, (state, action) => {
        state.monitoring.notificationSaving = false;
        state.monitoring.notificationPref = action.payload;
      })
      .addCase(updateMonitorNotificationPref.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.monitoring.notificationSaving = false;
        state.monitoring.notificationError = action.payload?.error ?? '';
      });
  },
});

/** Flip a mutated profile in place and clear its in-flight flag. */
function applyProfileMutation(
  cc: CompetitorContentState,
  competitorId: string,
  profile: CompetitorProfile,
): void {
  cc.mutatingId[competitorId] = false;
  const idx = cc.profiles.findIndex((p) => p.id === competitorId);
  if (idx >= 0) cc.profiles[idx] = profile;
}

/** Insert or replace a monitor in the list + detail cache. */
function upsertMonitor(mon: MonitoringState, monitor: ContentMonitor): void {
  const idx = mon.monitors.findIndex((m) => m.monitorId === monitor.monitorId);
  if (idx >= 0) mon.monitors[idx] = monitor;
  else mon.monitors.unshift(monitor);
  mon.detail[monitor.monitorId] = monitor;
}

/** Flip a mutated monitor in place and clear its in-flight flag. */
function applyMonitorMutation(
  mon: MonitoringState,
  monitorId: string,
  monitor: ContentMonitor,
): void {
  mon.mutatingId[monitorId] = false;
  upsertMonitor(mon, monitor);
}

export const contentIntelligenceReducer = slice.reducer;
export const {
  resetContentIntelligence,
  setActiveAnalysisId,
  updateFormDraft,
  clearFormDraft,
  clearSubmitError,
  clearInventorySubmitError,
  clearCompetitorSubmitError,
  clearCompetitorAddError,
  clearMonitorSubmitError,
  clearMonitorMutateError,
  upsertAnalysis,
} = slice.actions;
