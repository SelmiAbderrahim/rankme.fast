import { apiClient } from '@shared/api/client';
import type { PresentationRequestIdentity } from '@shared/i18n/requestIdentity';
import {
  ACTION_CONFIDENCES,
  ACTION_EFFORTS,
  ACTION_SEVERITIES,
  ACTION_SOURCE_TYPES,
  ACTION_STATES,
  type ActionConfidence,
  type ActionEffort,
  type ActionHistoryResponse,
  type ActionSeverity,
  type ActionSourceType,
  type ActionState,
  type ListActionsResponse,
  type MutateActionStateResponse,
  type RetestActionResponse,
} from './types';

export interface ListActionsFilters {
  state?: readonly ActionState[];
  source?: readonly ActionSourceType[];
  severity?: readonly ActionSeverity[];
  confidence?: readonly ActionConfidence[];
  effort?: readonly ActionEffort[];
}

export interface ListActionsPayload {
  siteId: string;
  filters?: ListActionsFilters;
  limit?: number;
  cursor?: string;
}

function appendAll<T extends string>(
  params: URLSearchParams,
  key: string,
  values: readonly T[] | undefined,
  allowed: readonly string[],
): void {
  if (!values) return;
  for (const v of values) {
    if (allowed.includes(v)) {
      params.append(key, v);
    }
  }
}

export function buildListActionsQuery(payload: ListActionsPayload): string {
  const params = new URLSearchParams();
  const filters = payload.filters;
  appendAll(params, 'state', filters?.state, ACTION_STATES as readonly string[]);
  appendAll(
    params,
    'source',
    filters?.source,
    ACTION_SOURCE_TYPES as readonly string[],
  );
  appendAll(
    params,
    'severity',
    filters?.severity,
    ACTION_SEVERITIES as readonly string[],
  );
  appendAll(
    params,
    'confidence',
    filters?.confidence,
    ACTION_CONFIDENCES as readonly string[],
  );
  appendAll(
    params,
    'effort',
    filters?.effort,
    ACTION_EFFORTS as readonly string[],
  );
  if (typeof payload.limit === 'number' && payload.limit > 0) {
    params.set('limit', String(payload.limit));
  }
  if (payload.cursor) {
    params.set('cursor', payload.cursor);
  }
  return params.toString();
}

export function listActions(
  payload: ListActionsPayload,
  init: { signal?: AbortSignal } & Partial<PresentationRequestIdentity> = {},
): Promise<ListActionsResponse> {
  const q = buildListActionsQuery(payload);
  return apiClient<ListActionsResponse>(
    `/sites/${encodeURIComponent(payload.siteId)}/actions${q ? `?${q}` : ''}`,
    {
      method: 'GET',
      ...(init.signal ? { signal: init.signal } : {}),
      ...(init.presentationLocale ? { locale: init.presentationLocale } : {}),
      ...(init.presentationGeneration === undefined
        ? {}
        : { presentationGeneration: init.presentationGeneration }),
    },
  );
}

export function getActionHistory(
  siteId: string,
  actionId: string,
  init: { signal?: AbortSignal } & Partial<PresentationRequestIdentity> = {},
): Promise<ActionHistoryResponse> {
  return apiClient<ActionHistoryResponse>(
    `/sites/${encodeURIComponent(siteId)}/actions/${encodeURIComponent(actionId)}/history`,
    {
      method: 'GET',
      ...(init.signal ? { signal: init.signal } : {}),
      ...(init.presentationLocale ? { locale: init.presentationLocale } : {}),
      ...(init.presentationGeneration === undefined
        ? {}
        : { presentationGeneration: init.presentationGeneration }),
    },
  );
}

export interface MutateActionStatePayload {
  siteId: string;
  actionId: string;
  state: ActionState;
  expectedVersion: number;
  clientKey: string;
  note?: string;
}

export function mutateActionState(
  payload: MutateActionStatePayload,
): Promise<MutateActionStateResponse> {
  const { siteId, actionId, ...body } = payload;
  return apiClient<MutateActionStateResponse>(
    `/sites/${encodeURIComponent(siteId)}/actions/${encodeURIComponent(actionId)}/state`,
    { method: 'POST', body },
  );
}

export interface RetestActionPayload {
  siteId: string;
  actionId: string;
  clientKey?: string;
}

export function retestAction(
  payload: RetestActionPayload,
): Promise<RetestActionResponse> {
  const { siteId, actionId, ...body } = payload;
  return apiClient<RetestActionResponse>(
    `/sites/${encodeURIComponent(siteId)}/actions/${encodeURIComponent(actionId)}/retest`,
    { method: 'POST', body },
  );
}
