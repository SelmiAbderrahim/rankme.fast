import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { SiteMarket } from '@shared/observations/types';
import type {
  RunResultView,
  RunStatusView,
  SignalDecisionResult,
} from '../types';
import {
  decideSignal,
  fetchRun,
  fetchRunResult,
  fetchRuns,
  startRun,
} from './thunks';

export interface AudienceResearchFormState {
  market: SiteMarket;
  competitors: string[];
  topics: string[];
}

export interface AudienceResearchState {
  siteId: string | null;
  runsById: Record<string, RunStatusView>;
  runResultsById: Record<string, RunResultView>;
  listIds: string[];
  listCursor: string | null;
  listCurrentCursor: string | null;
  listCursorStack: (string | null)[];
  listLoading: boolean;
  listLoaded: boolean;
  listError: string;
  selectedRunId: string | null;
  form: AudienceResearchFormState;
  startStatus: {
    loading: boolean;
    error: string;
    lastStartedId: string | null;
    duplicate: boolean;
  };
  runStatus: {
    loading: Record<string, boolean>;
    error: Record<string, string>;
  };
  resultStatus: {
    loading: Record<string, boolean>;
    error: Record<string, string>;
  };
  /**
   * Per-signal decision state. `terminal` holds the
   * server-authoritative row after a successful accept/dismiss (or the
   * refreshed row after a 409 replay). `pending` holds the idempotency key
   * for the currently in-flight request so React double-click / re-click
   * hits the same server-side idempotency row. `error` and `conflict` are
   * per-signal so multiple signals can be decided in parallel without their
   * error states cross-contaminating.
   */
  decisions: {
    terminal: Record<string, SignalDecisionResult>;
    /**
     * Reserved idempotency key per signal. NOT an in-flight marker: the
     * decision dialogs reserve a key the moment they OPEN
     * (`ensureSignalIdempotencyKey`) so re-clicks replay the same
     * server-side row — treating this record as "submitting" rendered the
     * confirm button disabled+loading from open and made the dialog
     * unusable. `inFlight` below is the actual request-in-progress flag.
     */
    pending: Record<string, { idempotencyKey: string }>;
    /** True only while a decideSignal request is actually on the wire. */
    inFlight: Record<string, true>;
    error: Record<string, string>;
    conflict: Record<string, true>;
  };
}

export const DEFAULT_FORM_MARKET: SiteMarket = {
  country: 'US',
  region: null,
  city: null,
  language: 'en',
  device: 'all',
};

export const initialState: AudienceResearchState = {
  siteId: null,
  runsById: {},
  runResultsById: {},
  listIds: [],
  listCursor: null,
  listCurrentCursor: null,
  listCursorStack: [],
  listLoading: false,
  listLoaded: false,
  listError: '',
  selectedRunId: null,
  form: {
    market: DEFAULT_FORM_MARKET,
    competitors: [],
    topics: [],
  },
  startStatus: {
    loading: false,
    error: '',
    lastStartedId: null,
    duplicate: false,
  },
  runStatus: {
    loading: {},
    error: {},
  },
  resultStatus: {
    loading: {},
    error: {},
  },
  decisions: {
    terminal: {},
    pending: {},
    inFlight: {},
    error: {},
    conflict: {},
  },
};

const rekeyForSite = (
  state: AudienceResearchState,
  siteId: string,
): AudienceResearchState => {
  if (state.siteId === siteId) return state;
  return {
    ...initialState,
    siteId,
    form: { ...initialState.form },
  };
};

const slice = createSlice({
  name: 'audienceResearch',
  initialState,
  reducers: {
    resetAudienceResearch: () => initialState,
    setSelectedRunId: (state, action: PayloadAction<string | null>) => {
      state.selectedRunId = action.payload;
    },
    updateFormMarket: (
      state,
      action: PayloadAction<Partial<SiteMarket>>,
    ) => {
      state.form.market = { ...state.form.market, ...action.payload };
    },
    setFormCompetitors: (state, action: PayloadAction<string[]>) => {
      state.form.competitors = action.payload;
    },
    setFormTopics: (state, action: PayloadAction<string[]>) => {
      state.form.topics = action.payload;
    },
    resetForm: (state) => {
      state.form = { ...initialState.form };
    },
    clearStartStatus: (state) => {
      state.startStatus = { ...initialState.startStatus };
    },
    clearSignalDecisionError: (state, action: PayloadAction<string>) => {
      delete state.decisions.error[action.payload];
      delete state.decisions.conflict[action.payload];
    },
    /**
     * Cache the idempotency key for a signal before the user opens the
     * accept/dismiss dialog. `crypto.randomUUID()` is only called by the
     * component the FIRST time; every subsequent submit reuses this key so
     * the server-side idempotency row resolves to the same terminal decision.
     */
    ensureSignalIdempotencyKey: (
      state,
      action: PayloadAction<{ signalId: string; idempotencyKey: string }>,
    ) => {
      const existing = state.decisions.pending[action.payload.signalId];
      if (!existing) {
        state.decisions.pending[action.payload.signalId] = {
          idempotencyKey: action.payload.idempotencyKey,
        };
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(startRun.pending, (state) => {
        state.startStatus.loading = true;
        state.startStatus.error = '';
        state.startStatus.duplicate = false;
      })
      .addCase(startRun.fulfilled, (state, action) => {
        state.startStatus.loading = false;
        state.startStatus.lastStartedId = action.payload.runId;
        state.startStatus.duplicate = action.payload.duplicate;
        state.selectedRunId = action.payload.runId;
      })
      .addCase(startRun.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.startStatus.loading = false;
        state.startStatus.error = action.payload?.error ?? '';
      })
      .addCase(fetchRuns.pending, (state, action) => {
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.listLoading = true;
        state.listError = '';
      })
      .addCase(fetchRuns.fulfilled, (state, action) => {
        if (action.payload.siteId !== state.siteId) return;
        state.listLoading = false;
        state.listLoaded = true;
        state.listCursor = action.payload.page.nextCursor;
        state.listIds = action.payload.page.items.map((r) => r.runId);
        for (const item of action.payload.page.items) {
          state.runsById[item.runId] = item;
        }
        if (action.payload.direction === 'next') {
          state.listCursorStack.push(state.listCurrentCursor);
        } else if (action.payload.direction === 'prev') {
          state.listCursorStack.pop();
        } else {
          state.listCursorStack = [];
        }
        state.listCurrentCursor = action.payload.cursor;
      })
      .addCase(fetchRuns.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.listLoading = false;
        state.listLoaded = true;
        state.listError = action.payload?.error ?? '';
      })
      .addCase(fetchRun.pending, (state, action) => {
        state.runStatus.loading[action.meta.arg.runId] = true;
        state.runStatus.error[action.meta.arg.runId] = '';
      })
      .addCase(fetchRun.fulfilled, (state, action) => {
        state.runStatus.loading[action.payload.runId] = false;
        state.runsById[action.payload.runId] = action.payload;
      })
      .addCase(fetchRun.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.runStatus.loading[action.meta.arg.runId] = false;
        state.runStatus.error[action.meta.arg.runId] = action.payload?.error ?? '';
      })
      .addCase(fetchRunResult.pending, (state, action) => {
        state.resultStatus.loading[action.meta.arg.runId] = true;
        state.resultStatus.error[action.meta.arg.runId] = '';
      })
      .addCase(fetchRunResult.fulfilled, (state, action) => {
        state.resultStatus.loading[action.payload.runId] = false;
        state.runResultsById[action.payload.runId] = action.payload;
        state.runsById[action.payload.runId] = action.payload;
        // Hydrate the durable terminal decisions the server attaches to the
        // result view — the session-local cache alone loses every
        // accepted/dismissed state on reload (decided cards reverted to
        // undecided controls and re-deciding 409'd). Server rows are the
        // authority; overwrite by signalId.
        for (const decision of action.payload.decisions ?? []) {
          state.decisions.terminal[decision.signalId] = decision;
        }
      })
      .addCase(fetchRunResult.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.resultStatus.loading[action.meta.arg.runId] = false;
        state.resultStatus.error[action.meta.arg.runId] = action.payload?.error ?? '';
      })
      .addCase(decideSignal.pending, (state, action) => {
        const signalId = action.meta.arg.signalId;
        delete state.decisions.error[signalId];
        delete state.decisions.conflict[signalId];
        state.decisions.inFlight[signalId] = true;
        if (!state.decisions.pending[signalId]) {
          state.decisions.pending[signalId] = {
            idempotencyKey: action.meta.arg.idempotencyKey,
          };
        }
      })
      .addCase(decideSignal.fulfilled, (state, action) => {
        const signalId = action.payload.signalId;
        state.decisions.terminal[signalId] = action.payload;
        delete state.decisions.inFlight[signalId];
        delete state.decisions.pending[signalId];
        delete state.decisions.error[signalId];
        delete state.decisions.conflict[signalId];
      })
      .addCase(decideSignal.rejected, (state, action) => {
        if (action.meta.aborted) return;
        const signalId = action.meta.arg.signalId;
        delete state.decisions.inFlight[signalId];
        delete state.decisions.pending[signalId];
        state.decisions.error[signalId] = action.payload?.error ?? '';
        if (action.payload?.status === 409) {
          state.decisions.conflict[signalId] = true;
        }
      });
  },
});

export const audienceResearchReducer = slice.reducer;
export const {
  resetAudienceResearch,
  setSelectedRunId,
  updateFormMarket,
  setFormCompetitors,
  setFormTopics,
  resetForm,
  clearStartStatus,
  clearSignalDecisionError,
  ensureSignalIdempotencyKey,
} = slice.actions;
