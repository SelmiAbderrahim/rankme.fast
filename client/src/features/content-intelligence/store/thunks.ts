import { createAsyncThunk } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import {
  cancelAnalysis as cancelAnalysisApi,
  getAnalysis as getAnalysisApi,
  listAnalyses as listAnalysesApi,
  preflightAnalysis as preflightAnalysisApi,
  regenerateAnalysis as regenerateAnalysisApi,
  startAnalysis as startAnalysisApi,
  cancelInventory as cancelInventoryApi,
  getInventoryRun as getInventoryRunApi,
  listInventoryRuns as listInventoryRunsApi,
  startInventory as startInventoryApi,
  addCompetitor as addCompetitorApi,
  archiveCompetitor as archiveCompetitorApi,
  cancelCompetitorRun as cancelCompetitorRunApi,
  getCompetitorRun as getCompetitorRunApi,
  listCompetitorRuns as listCompetitorRunsApi,
  listCompetitors as listCompetitorsApi,
  restoreCompetitor as restoreCompetitorApi,
  startCompetitorRun as startCompetitorRunApi,
  suggestCompetitors as suggestCompetitorsApi,
  listMonitors as listMonitorsApi,
  createMonitor as createMonitorApi,
  getMonitorFeed as getMonitorFeedApi,
  pauseMonitor as pauseMonitorApi,
  resumeMonitor as resumeMonitorApi,
  deleteMonitor as deleteMonitorApi,
  getMonitorNotifications as getMonitorNotificationsApi,
  patchMonitorNotifications as patchMonitorNotificationsApi,
  type AddCompetitorPayload,
  type CreateMonitorPayload,
  type PreflightPayload,
  type StartAnalysisPayload,
  type StartCompetitorRunPayload,
  type StartInventoryPayload,
} from '../api';
import { errorMessage } from '../errorMessage';
import type {
  AnalysesPage,
  CancelResponse,
  ContentAnalysis,
  PreflightResponse,
  StartAnalysisResponse,
  CancelInventoryResponse,
  InventoryRunDetail,
  InventoryRunsPage,
  StartInventoryResponse,
  AddCompetitorResponse,
  CancelCompetitorRunResponse,
  CompetitorContentRunDetail,
  CompetitorContentRunsPage,
  CompetitorProfile,
  CompetitorProfileStatus,
  CompetitorSuggestion,
  MutateCompetitorResponse,
  StartCompetitorRunResponse,
  ContentMonitorStatus,
  CreatedMonitorResponse,
  DeleteMonitorResponse,
  ListMonitorsResponse,
  MonitorFeedResponse,
  MutateMonitorResponse,
} from '../types';

export interface RejectPayload {
  error: string;
  status?: number;
}

function normalizeError(err: unknown): RejectPayload {
  if (err instanceof ApiError) {
    return {
      error: errorMessage(err),
      status: err.status,
    };
  }
  return { error: errorMessage(err) };
}

export const loadAnalyses = createAsyncThunk<
  { page: AnalysesPage; append: boolean; siteId: string },
  { siteId: string; cursor?: string; limit?: number; append?: boolean },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadAnalyses',
  async (arg, { rejectWithValue, signal }) => {
    try {
      const { append: _append, ...rest } = arg;
      const page = await listAnalysesApi(rest, { signal });
      return { page, append: Boolean(arg.append), siteId: arg.siteId };
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const loadAnalysis = createAsyncThunk<
  ContentAnalysis,
  { siteId: string; analysisId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadAnalysis',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await getAnalysisApi(arg.analysisId, arg.siteId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const runPreflight = createAsyncThunk<
  PreflightResponse,
  PreflightPayload,
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/runPreflight',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await preflightAnalysisApi(arg, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const submitAnalysis = createAsyncThunk<
  StartAnalysisResponse,
  StartAnalysisPayload,
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/submitAnalysis',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await startAnalysisApi(arg, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const cancelAnalysisThunk = createAsyncThunk<
  CancelResponse,
  { analysisId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/cancelAnalysis',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await cancelAnalysisApi(arg.analysisId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const regenerateAnalysisThunk = createAsyncThunk<
  StartAnalysisResponse,
  { analysisId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/regenerateAnalysis',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await regenerateAnalysisApi(arg.analysisId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

// ---------------------------------------------------------------------------
// Content Inventory thunks.
// ---------------------------------------------------------------------------

export const loadInventoryRuns = createAsyncThunk<
  { page: InventoryRunsPage; append: boolean; siteId: string },
  { siteId: string; cursor?: string; limit?: number; append?: boolean },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadInventoryRuns',
  async (arg, { rejectWithValue, signal }) => {
    try {
      const { append: _append, ...rest } = arg;
      const page = await listInventoryRunsApi(rest, { signal });
      return { page, append: Boolean(arg.append), siteId: arg.siteId };
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const loadInventoryRun = createAsyncThunk<
  InventoryRunDetail,
  { siteId: string; runId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadInventoryRun',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await getInventoryRunApi(arg.siteId, arg.runId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const startInventoryThunk = createAsyncThunk<
  StartInventoryResponse,
  StartInventoryPayload,
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/startInventory',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await startInventoryApi(arg, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const cancelInventoryThunk = createAsyncThunk<
  CancelInventoryResponse,
  { siteId: string; runId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/cancelInventory',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await cancelInventoryApi(arg.siteId, arg.runId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

// ---------------------------------------------------------------------------
// Competitor content intelligence (Agency) thunks.
// ---------------------------------------------------------------------------

export const loadCompetitorProfiles = createAsyncThunk<
  { profiles: CompetitorProfile[]; siteId: string },
  { siteId: string; status?: CompetitorProfileStatus | 'all' },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadCompetitorProfiles',
  async (arg, { rejectWithValue, signal }) => {
    try {
      const res = await listCompetitorsApi(arg.siteId, arg.status ?? 'all', { signal });
      return { profiles: res.competitors, siteId: arg.siteId };
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const loadCompetitorSuggestions = createAsyncThunk<
  { suggestions: CompetitorSuggestion[]; siteId: string },
  { siteId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadCompetitorSuggestions',
  async (arg, { rejectWithValue, signal }) => {
    try {
      const res = await suggestCompetitorsApi(arg.siteId, { signal });
      return { suggestions: res.suggestions, siteId: arg.siteId };
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const addCompetitorThunk = createAsyncThunk<
  AddCompetitorResponse,
  AddCompetitorPayload,
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/addCompetitor',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await addCompetitorApi(arg, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const archiveCompetitorThunk = createAsyncThunk<
  MutateCompetitorResponse,
  { siteId: string; competitorId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/archiveCompetitor',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await archiveCompetitorApi(arg.siteId, arg.competitorId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const restoreCompetitorThunk = createAsyncThunk<
  MutateCompetitorResponse,
  { siteId: string; competitorId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/restoreCompetitor',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await restoreCompetitorApi(arg.siteId, arg.competitorId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const startCompetitorRunThunk = createAsyncThunk<
  StartCompetitorRunResponse,
  StartCompetitorRunPayload,
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/startCompetitorRun',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await startCompetitorRunApi(arg, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const loadCompetitorRuns = createAsyncThunk<
  { page: CompetitorContentRunsPage; append: boolean; siteId: string },
  { siteId: string; cursor?: string; limit?: number; append?: boolean },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadCompetitorRuns',
  async (arg, { rejectWithValue, signal }) => {
    try {
      const { append: _append, ...rest } = arg;
      const page = await listCompetitorRunsApi(rest, { signal });
      return { page, append: Boolean(arg.append), siteId: arg.siteId };
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const loadCompetitorRun = createAsyncThunk<
  CompetitorContentRunDetail,
  { siteId: string; runId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadCompetitorRun',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await getCompetitorRunApi(arg.siteId, arg.runId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const cancelCompetitorRunThunk = createAsyncThunk<
  CancelCompetitorRunResponse,
  { siteId: string; runId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/cancelCompetitorRun',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await cancelCompetitorRunApi(arg.siteId, arg.runId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

// ---------------------------------------------------------------------------
// Public-page change monitoring (Agency) thunks.
// ---------------------------------------------------------------------------

export const loadMonitors = createAsyncThunk<
  { response: ListMonitorsResponse; siteId: string },
  { siteId: string; status?: ContentMonitorStatus | 'all' },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadMonitors',
  async (arg, { rejectWithValue, signal }) => {
    try {
      const response = await listMonitorsApi(arg.siteId, arg.status ?? 'all', { signal });
      return { response, siteId: arg.siteId };
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const createMonitorThunk = createAsyncThunk<
  CreatedMonitorResponse,
  CreateMonitorPayload,
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/createMonitor',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await createMonitorApi(arg, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const loadMonitorFeed = createAsyncThunk<
  { response: MonitorFeedResponse; monitorId: string; append: boolean },
  { siteId: string; monitorId: string; cursor?: string; limit?: number; append?: boolean },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadMonitorFeed',
  async (arg, { rejectWithValue, signal }) => {
    try {
      const { append: _append, ...rest } = arg;
      const response = await getMonitorFeedApi(rest, { signal });
      return { response, monitorId: arg.monitorId, append: Boolean(arg.append) };
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const pauseMonitorThunk = createAsyncThunk<
  MutateMonitorResponse,
  { siteId: string; monitorId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/pauseMonitor',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await pauseMonitorApi(arg.siteId, arg.monitorId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const resumeMonitorThunk = createAsyncThunk<
  MutateMonitorResponse,
  { siteId: string; monitorId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/resumeMonitor',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await resumeMonitorApi(arg.siteId, arg.monitorId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const deleteMonitorThunk = createAsyncThunk<
  DeleteMonitorResponse,
  { siteId: string; monitorId: string },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/deleteMonitor',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await deleteMonitorApi(arg.siteId, arg.monitorId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const loadMonitorNotificationPref = createAsyncThunk<
  boolean,
  void,
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/loadMonitorNotificationPref',
  async (_arg, { rejectWithValue, signal }) => {
    try {
      const res = await getMonitorNotificationsApi({ signal });
      return res.preferences.emailMonitorChange;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const updateMonitorNotificationPref = createAsyncThunk<
  boolean,
  { value: boolean },
  { rejectValue: RejectPayload }
>(
  'contentIntelligence/updateMonitorNotificationPref',
  async (arg, { rejectWithValue, signal }) => {
    try {
      const res = await patchMonitorNotificationsApi(arg.value, { signal });
      return res.preferences.emailMonitorChange;
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);
