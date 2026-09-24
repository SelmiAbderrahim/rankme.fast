import { apiErrorMessage } from '@shared/api/errorMessage';

export function errorMessage(err: unknown): string {
  return apiErrorMessage(err, 'contentIntelligence:errors.loadFailed');
}

export {
  apiErrorMessage as contentIntelligenceErrorMessage,
  apiErrorRetryAfterMs,
  apiErrorStatus,
} from '@shared/api/errorMessage';
