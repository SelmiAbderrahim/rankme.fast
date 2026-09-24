import { ApiError } from '@shared/api/client';
import { apiErrorMessage } from '@shared/api/errorMessage';
import type { PagesErrorKind, PagesListResponse, PagesRequestError } from './types';

interface ErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  state?: unknown;
}

const kindFor = (error: ApiError): PagesErrorKind => {
  if (error.code === 'network' || error.code === 'timeout' || error.code === 'parse') {
    return error.code;
  }
  if (error.status === 400) return 'invalid_request';
  if (error.status === 404) return 'not_found';
  if (error.status === 429) return 'rate_limited';
  if (error.status === 503) return 'unavailable';
  return 'http';
};

const recordOrNull = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export function toPagesRequestError(error: unknown): PagesRequestError {
  if (!(error instanceof ApiError)) {
    return {
      kind: 'unknown',
      status: null,
      code: null,
      message: apiErrorMessage(error, 'errors:internal'),
      details: null,
      retryAfterMs: null,
      state: null,
    };
  }

  const body = recordOrNull(error.data) as ErrorBody | null;
  const details = recordOrNull(body?.error?.details);
  const retryAfterMs = details?.retryAfterMs;
  return {
    kind: kindFor(error),
    status: error.status,
    code: typeof body?.error?.code === 'string' ? body.error.code : null,
    message: apiErrorMessage(error, 'errors:internal'),
    details,
    retryAfterMs:
      typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? retryAfterMs
        : null,
    state: recordOrNull(body?.state) as PagesListResponse | null,
  };
}

export class PagesClientError extends Error {
  readonly payload: PagesRequestError;

  constructor(payload: PagesRequestError) {
    super(payload.message);
    this.name = 'PagesClientError';
    this.payload = payload;
  }
}

export const pagesRequestError = (error: unknown): PagesRequestError =>
  error instanceof PagesClientError ? error.payload : toPagesRequestError(error);
