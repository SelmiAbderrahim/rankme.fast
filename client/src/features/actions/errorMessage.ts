import { apiErrorMessage } from '@shared/api/errorMessage';

export function errorMessage(err: unknown): string {
  return apiErrorMessage(err, 'actions:errors.loadFailed');
}

export {
  apiErrorMessage as actionsErrorMessage,
  apiErrorRetryAfterMs,
  apiErrorStatus,
} from '@shared/api/errorMessage';
