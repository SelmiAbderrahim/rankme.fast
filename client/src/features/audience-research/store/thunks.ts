import { createAsyncThunk } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import {
  getAudienceResearchRun as getRunApi,
  getAudienceResearchRunResult as getRunResultApi,
  listAudienceResearchRuns as listRunsApi,
  postAudienceResearchSignalDecision as postDecisionApi,
  startAudienceResearchRun as startRunApi,
} from '../api';
import { errorMessage } from '../errorMessage';
import type {
  AudienceResearchInput,
  DecideSignalRequest,
  ListRunsResult,
  RunResultView,
  RunStatusView,
  SignalDecisionResult,
  StartRunResponse,
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

export const startRun = createAsyncThunk<
  StartRunResponse,
  { siteId: string; input: AudienceResearchInput },
  { rejectValue: RejectPayload }
>(
  'audienceResearch/startRun',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await startRunApi(arg.siteId, arg.input, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const fetchRuns = createAsyncThunk<
  { page: ListRunsResult; siteId: string; cursor: string | null; direction: 'initial' | 'next' | 'prev' },
  { siteId: string; cursor?: string | null; direction?: 'initial' | 'next' | 'prev' },
  { rejectValue: RejectPayload }
>(
  'audienceResearch/fetchRuns',
  async (arg, { rejectWithValue, signal }) => {
    try {
      const page = await listRunsApi(
        arg.siteId,
        arg.cursor ? { cursor: arg.cursor } : {},
        { signal },
      );
      return {
        page,
        siteId: arg.siteId,
        cursor: arg.cursor ?? null,
        direction: arg.direction ?? 'initial',
      };
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const fetchRun = createAsyncThunk<
  RunStatusView,
  { siteId: string; runId: string },
  { rejectValue: RejectPayload }
>(
  'audienceResearch/fetchRun',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await getRunApi(arg.siteId, arg.runId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

export const fetchRunResult = createAsyncThunk<
  RunResultView,
  { siteId: string; runId: string },
  { rejectValue: RejectPayload }
>(
  'audienceResearch/fetchRunResult',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await getRunResultApi(arg.siteId, arg.runId, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);

/**
 * Post a terminal accept/dismiss decision. Idempotency key is generated once
 * per pending signal by the caller and reused on every retry so a React
 * double-click / re-click yields the same server-authoritative row.
 *
 * Rejection payload carries `status` so the reducer can distinguish 409
 * (server refreshes the signal and shows the "another decision already
 * applied" banner —) from generic downstream failures.
 */
export const decideSignal = createAsyncThunk<
  SignalDecisionResult,
  DecideSignalRequest,
  { rejectValue: RejectPayload }
>(
  'audienceResearch/decideSignal',
  async (arg, { rejectWithValue, signal }) => {
    try {
      return await postDecisionApi(arg, { signal });
    } catch (err) {
      return rejectWithValue(normalizeError(err));
    }
  },
);
