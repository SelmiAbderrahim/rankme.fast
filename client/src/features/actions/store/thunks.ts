import { createAsyncThunk } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import {
  getActionHistory as getActionHistoryApi,
  listActions as listActionsApi,
  mutateActionState as mutateActionStateApi,
  retestAction as retestActionApi,
  type ListActionsFilters,
  type MutateActionStatePayload,
  type RetestActionPayload,
} from '../api';
import { errorMessage } from '../errorMessage';
import { apiErrorCode, apiErrorMessageKey } from '@shared/api/errorMessage';
import type {
  ActionHistoryResponse,
  ListActionsResponse,
  MutateActionStateResponse,
  RetestActionResponse,
} from '../types';
import {
  presentationRequestIdentity,
  type PresentationRequestIdentity,
} from '@shared/i18n/requestIdentity';

export interface ActionsRejectPayload {
  error: string;
  status?: number;
  overCap?: boolean;
  conflict?: boolean;
  notFound?: boolean;
  unauthorized?: boolean;
  code?: string;
  messageKey?: string;
}

function normalizeError(err: unknown): ActionsRejectPayload {
  if (err instanceof ApiError) {
    const code = apiErrorCode(err);
    const messageKey = apiErrorMessageKey(err);
    return {
      error: errorMessage(err),
      status: err.status,
      overCap: err.status === 402,
      conflict: err.status === 409,
      notFound: err.status === 404,
      unauthorized: err.status === 401 || err.status === 403,
      ...(code ? { code } : {}),
      ...(messageKey ? { messageKey } : {}),
    };
  }
  return { error: errorMessage(err) };
}

export interface LoadActionsArg extends Partial<PresentationRequestIdentity> {
  siteId: string;
  filters?: ListActionsFilters;
  limit?: number;
  cursor?: string;
  /** Monotonically increasing request id; the reducer drops stale fulfillments. */
  requestSeq: number;
}

const requestIdentityFor = (
  input: Partial<PresentationRequestIdentity>,
): PresentationRequestIdentity =>
  input.presentationLocale !== undefined &&
  input.presentationGeneration !== undefined
    ? {
        presentationLocale: input.presentationLocale,
        presentationGeneration: input.presentationGeneration,
      }
    : presentationRequestIdentity();

export const loadActions = createAsyncThunk<
  { response: ListActionsResponse; siteId: string; requestSeq: number },
  LoadActionsArg,
  { rejectValue: ActionsRejectPayload }
>('actions/loadActions', async (arg, { rejectWithValue, signal }) => {
  const identity = requestIdentityFor(arg);
  try {
    const response = await listActionsApi(
      {
        siteId: arg.siteId,
        ...(arg.filters ? { filters: arg.filters } : {}),
        ...(typeof arg.limit === 'number' ? { limit: arg.limit } : {}),
        ...(arg.cursor ? { cursor: arg.cursor } : {}),
      },
      { signal, ...identity },
    );
    return { response, siteId: arg.siteId, requestSeq: arg.requestSeq };
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});

export const loadActionHistory = createAsyncThunk<
  { response: ActionHistoryResponse; actionId: string },
  { siteId: string; actionId: string } & Partial<PresentationRequestIdentity>,
  { rejectValue: ActionsRejectPayload }
>('actions/loadHistory', async (arg, { rejectWithValue, signal }) => {
  const identity = requestIdentityFor(arg);
  try {
    const response = await getActionHistoryApi(arg.siteId, arg.actionId, {
      signal,
      ...identity,
    });
    return { response, actionId: arg.actionId };
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});

export const submitActionState = createAsyncThunk<
  MutateActionStateResponse,
  MutateActionStatePayload,
  { rejectValue: ActionsRejectPayload }
>('actions/submitState', async (arg, { rejectWithValue }) => {
  try {
    return await mutateActionStateApi(arg);
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});

export const submitRetestAction = createAsyncThunk<
  RetestActionResponse,
  RetestActionPayload,
  { rejectValue: ActionsRejectPayload }
>('actions/submitRetest', async (arg, { rejectWithValue }) => {
  try {
    return await retestActionApi(arg);
  } catch (err) {
    return rejectWithValue(normalizeError(err));
  }
});
