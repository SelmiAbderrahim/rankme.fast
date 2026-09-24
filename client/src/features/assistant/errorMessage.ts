import {
  apiErrorMessage,
  apiErrorRetryAfterMs,
  apiErrorStatus,
} from '@shared/api/errorMessage';
import type { AssistantClientError, AssistantErrorKind } from './types';

export function assistantErrorKind(error: unknown): AssistantErrorKind {
  const status = apiErrorStatus(error);
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  return 'generic';
}

const FALLBACK_KEYS: Record<AssistantErrorKind, string> = {
  forbidden: 'assistant:errors.forbidden',
  rate_limited: 'assistant:errors.rateLimited',
  unavailable: 'assistant:errors.unavailable',
  stream: 'assistant:errors.streamFailed',
  generic: 'assistant:errors.generic',
};

export function assistantErrorMessage(error: unknown): AssistantClientError {
  const kind = assistantErrorKind(error);
  return {
    kind,
    message: apiErrorMessage(error, FALLBACK_KEYS[kind]),
    status: apiErrorStatus(error),
    retryAfterMs: apiErrorRetryAfterMs(error),
    code: null,
  };
}

export function assistantStreamError(
  message: string | null,
  code: string | null = null,
): AssistantClientError {
  const fallback = apiErrorMessage(null, FALLBACK_KEYS.stream);
  return {
    kind: 'stream',
    message: message && message.length > 0 ? message : fallback,
    status: null,
    retryAfterMs: null,
    code,
  };
}
