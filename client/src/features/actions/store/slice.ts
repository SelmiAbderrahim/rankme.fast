import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  ActionHistoryEntry,
  ActionItem,
  ActionSourceStatusEnvelope,
  ActionState,
} from '../types';
import {
  loadActionHistory,
  loadActions,
  loadAuditDecisions,
  submitActionState,
  submitRetestAction,
} from './thunks';
import {
  presentationCacheKey,
  presentationLocaleChanged,
  presentationRequestIdentity,
  type PresentationRequestIdentity,
} from '@shared/i18n/requestIdentity';
import { DEFAULT_LOCALE } from '@shared/i18n/locales';

export type ActionsListStatus =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'ready'
  | 'error';

export interface ActionsPendingMap {
  state: Record<string, boolean | undefined>;
  retest: Record<string, boolean | undefined>;
  history: Record<string, boolean | undefined>;
}

export interface ActionsErrorMap {
  state: Record<string, string | undefined>;
  retest: Record<string, string | undefined>;
  history: Record<string, string | undefined>;
}

export interface ActionsListError {
  message: string;
  code: string | null;
  messageKey: string | null;
  overCap: boolean;
  unauthorized: boolean;
  notFound: boolean;
}

/**
 * Resolved audit decisions (`ruleId` → dismissed/completed) for one site.
 * Kept apart from `items` because the list rows are whatever page the
 * current surface asked for; the counters need every resolved rule.
 */
export interface AuditDecisionsState {
  siteId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  byRuleId: Record<string, ActionState>;
}

export interface ActionsState {
  presentationLocale: PresentationRequestIdentity['presentationLocale'];
  presentationGeneration: number;
  listCacheKey: string;
  siteId: string | null;
  items: ActionItem[];
  sourceStatus: ActionSourceStatusEnvelope;
  nextCursor: string | null;
  listStatus: ActionsListStatus;
  listError: ActionsListError;
  latestRequestSeq: number;
  lastAppliedSeq: number;
  history: Record<string, ActionHistoryEntry[] | undefined>;
  pending: ActionsPendingMap;
  errors: ActionsErrorMap;
  conflictIds: Record<string, boolean | undefined>;
  lastRetestRunId: string | null;
  auditDecisions: AuditDecisionsState;
}

export const initialState: ActionsState = {
  presentationLocale: DEFAULT_LOCALE,
  presentationGeneration: 0,
  listCacheKey: presentationCacheKey('actions:unselected', {
    presentationLocale: DEFAULT_LOCALE,
  }),
  siteId: null,
  items: [],
  sourceStatus: {},
  nextCursor: null,
  listStatus: 'idle',
  listError: {
    message: '',
    code: null,
    messageKey: null,
    overCap: false,
    unauthorized: false,
    notFound: false,
  },
  latestRequestSeq: 0,
  lastAppliedSeq: 0,
  history: {},
  pending: { state: {}, retest: {}, history: {} },
  errors: { state: {}, retest: {}, history: {} },
  conflictIds: {},
  lastRetestRunId: null,
  auditDecisions: { siteId: null, status: 'idle', byRuleId: {} },
};

const identityFor = (
  arg: Partial<PresentationRequestIdentity>,
): PresentationRequestIdentity =>
  arg.presentationLocale !== undefined && arg.presentationGeneration !== undefined
    ? {
        presentationLocale: arg.presentationLocale,
        presentationGeneration: arg.presentationGeneration,
      }
    : presentationRequestIdentity();

const matchesIdentity = (
  state: ActionsState,
  arg: Partial<PresentationRequestIdentity>,
): boolean =>
  arg.presentationGeneration === undefined ||
  (arg.presentationLocale === state.presentationLocale &&
    arg.presentationGeneration === state.presentationGeneration);

const historyKey = (
  actionId: string,
  identity: Pick<PresentationRequestIdentity, 'presentationLocale'>,
): string => presentationCacheKey(`action-history:${actionId}`, identity);

const rekeyForSite = (state: ActionsState, siteId: string): ActionsState => {
  if (state.siteId === siteId) return state;
  // Audit decisions carry their own site key; a list read for the same site
  // must not wipe a decisions read that is already in flight or done.
  return { ...initialState, siteId, auditDecisions: state.auditDecisions };
};

const slice = createSlice({
  name: 'actions',
  initialState,
  reducers: {
    resetActions: () => initialState,
    clearActionErrors: (state, action: PayloadAction<string>) => {
      delete state.errors.state[action.payload];
      delete state.errors.retest[action.payload];
      delete state.conflictIds[action.payload];
    },
    /** Apply the server's authoritative row for a mutated action. */
    applyMutatedAction: (
      state,
      action: PayloadAction<{
        actionId: string;
        state: ActionState;
        version: number;
      }>,
    ) => {
      const item = state.items.find((i) => i.id === action.payload.actionId);
      if (item) {
        item.state = action.payload.state;
        item.version = action.payload.version;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadActions.pending, (state, action) => {
        const identity = identityFor(action.meta.arg);
        Object.assign(state, rekeyForSite(state, action.meta.arg.siteId));
        state.presentationLocale = identity.presentationLocale;
        state.presentationGeneration = identity.presentationGeneration;
        state.listCacheKey = presentationCacheKey(
          `actions:${action.meta.arg.siteId}:${action.meta.arg.cursor ?? 'first'}`,
          identity,
        );
        state.listStatus =
          state.items.length > 0 ? 'refreshing' : 'loading';
        state.listError = { ...initialState.listError };
        state.latestRequestSeq = action.meta.arg.requestSeq;
      })
      .addCase(loadActions.fulfilled, (state, action) => {
        if (!matchesIdentity(state, action.meta.arg)) return;
        // Stale-fulfillment guard: only apply the latest request result.
        if (action.payload.requestSeq < state.latestRequestSeq) return;
        if (action.payload.siteId !== state.siteId) return;
        state.listStatus = 'ready';
        state.items = [...action.payload.response.items];
        state.sourceStatus = { ...action.payload.response.sourceStatus };
        state.nextCursor = action.payload.response.nextCursor;
        state.lastAppliedSeq = action.payload.requestSeq;
      })
      .addCase(loadActions.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (!matchesIdentity(state, action.meta.arg)) return;
        if (action.meta.arg.requestSeq < state.latestRequestSeq) return;
        state.listStatus = 'error';
        state.listError = {
          message: action.payload?.error ?? '',
          code: action.payload?.code ?? null,
          messageKey: action.payload?.messageKey ?? null,
          overCap: Boolean(action.payload?.overCap),
          unauthorized: Boolean(action.payload?.unauthorized),
          notFound: Boolean(action.payload?.notFound),
        };
      })
      .addCase(loadAuditDecisions.pending, (state, action) => {
        const { siteId } = action.meta.arg;
        state.auditDecisions = {
          siteId,
          status: 'loading',
          byRuleId: state.auditDecisions.siteId === siteId ? state.auditDecisions.byRuleId : {},
        };
      })
      .addCase(loadAuditDecisions.fulfilled, (state, action) => {
        if (action.payload.siteId !== state.auditDecisions.siteId) return;
        const byRuleId: Record<string, ActionState> = {};
        for (const item of action.payload.items) {
          if (item.sourceType === 'audit_finding') byRuleId[item.sourceId] = item.state;
        }
        state.auditDecisions.status = 'ready';
        state.auditDecisions.byRuleId = byRuleId;
      })
      .addCase(loadAuditDecisions.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (action.meta.arg.siteId !== state.auditDecisions.siteId) return;
        state.auditDecisions.status = 'error';
      })
      .addCase(loadActionHistory.pending, (state, action) => {
        const key = historyKey(action.meta.arg.actionId, identityFor(action.meta.arg));
        state.pending.history[key] = true;
        delete state.errors.history[key];
      })
      .addCase(loadActionHistory.fulfilled, (state, action) => {
        if (!matchesIdentity(state, action.meta.arg)) return;
        const key = historyKey(action.payload.actionId, identityFor(action.meta.arg));
        state.pending.history[key] = false;
        state.history[key] = [
          ...action.payload.response.entries,
        ];
      })
      .addCase(loadActionHistory.rejected, (state, action) => {
        if (action.meta.aborted) return;
        if (!matchesIdentity(state, action.meta.arg)) return;
        const key = historyKey(action.meta.arg.actionId, identityFor(action.meta.arg));
        state.pending.history[key] = false;
        state.errors.history[key] =
          action.payload?.error ?? '';
      })
      .addCase(submitActionState.pending, (state, action) => {
        state.pending.state[action.meta.arg.actionId] = true;
        delete state.errors.state[action.meta.arg.actionId];
        delete state.conflictIds[action.meta.arg.actionId];
      })
      .addCase(submitActionState.fulfilled, (state, action) => {
        state.pending.state[action.payload.actionId] = false;
        const item = state.items.find(
          (i) => i.id === action.payload.actionId,
        );
        if (item) {
          item.state = action.payload.state;
          item.version = action.payload.version;
          item.latestNote = action.meta.arg.note || null;
        }
        // A resolved card stays where it is until the next load: removing it
        // while its dialog closes would drop keyboard focus.
        // Drop cached history so it refetches with the new event.
        delete state.history[action.payload.actionId];
        for (const key of Object.keys(state.history)) {
          if (key.startsWith(`action-history:${action.payload.actionId}::`)) {
            delete state.history[key];
          }
        }
      })
      .addCase(submitActionState.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.pending.state[action.meta.arg.actionId] = false;
        state.errors.state[action.meta.arg.actionId] =
          action.payload?.error ?? '';
        if (action.payload?.conflict) {
          state.conflictIds[action.meta.arg.actionId] = true;
        }
      })
      .addCase(submitRetestAction.pending, (state, action) => {
        state.pending.retest[action.meta.arg.actionId] = true;
        delete state.errors.retest[action.meta.arg.actionId];
      })
      .addCase(submitRetestAction.fulfilled, (state, action) => {
        state.pending.retest[action.payload.actionId] = false;
        state.lastRetestRunId = action.payload.run.runId;
      })
      .addCase(submitRetestAction.rejected, (state, action) => {
        if (action.meta.aborted) return;
        state.pending.retest[action.meta.arg.actionId] = false;
        state.errors.retest[action.meta.arg.actionId] =
          action.payload?.error ?? '';
      })
      .addCase(presentationLocaleChanged, (state, action) => {
        state.presentationLocale = action.payload.locale;
        state.presentationGeneration = action.payload.generation;
        state.listCacheKey = presentationCacheKey(
          `actions:${state.siteId ?? 'unselected'}:first`,
          { presentationLocale: action.payload.locale },
        );
        state.items = [];
        state.sourceStatus = {};
        state.nextCursor = null;
        state.listStatus = 'idle';
        state.listError = { ...initialState.listError };
        state.history = {};
        state.pending.history = {};
        state.errors = { state: {}, retest: {}, history: {} };
        state.conflictIds = {};
      });
  },
});

export const actionsReducer = slice.reducer;
export const { resetActions, clearActionErrors, applyMutatedAction } =
  slice.actions;
