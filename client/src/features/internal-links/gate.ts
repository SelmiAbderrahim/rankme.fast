import { ApiError } from '@shared/api/client';
import type { InternalLinkUiState } from './types';

export function internalLinkGate(error: unknown): InternalLinkUiState {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.status === 404) return 'notFound';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 503) return 'disabled';
  return 'failed';
}
