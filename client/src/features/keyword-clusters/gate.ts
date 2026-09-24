import { ApiError } from '@shared/api/client';
import type { KeywordClusterUiState } from './types';

export function keywordClusterGate(error: unknown): KeywordClusterUiState {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.status === 404) return 'notFound';
  // The only 409 this surface can raise is "fewer than two ready keywords",
  // refused before any reservation.
  if (error.status === 409) return 'notEnoughKeywords';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 503) return 'disabled';
  return 'failed';
}
