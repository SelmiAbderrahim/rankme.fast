import { apiClient } from '@shared/api/client';

/** Shape returned by `POST /api/legal/delete-account` (grace-period soft-delete). */
export interface AccountDeletionScheduled {
  scheduledAt: string;
  purgeAt: string;
  warningEmailQueued: boolean;
}

/**
 * Schedule a grace-period deletion of the current account. The route is a
 * cookie-authenticated mutation guarded by `requireCsrf`, so the call opts into
 * the double-submit CSRF flow (`csrf: true`).
 */
export const deleteAccount = async (): Promise<AccountDeletionScheduled> =>
  apiClient<AccountDeletionScheduled>('/legal/delete-account', {
    method: 'POST',
    csrf: true,
  });

export interface AccountDeletionStatus {
  scheduledAt: string | null;
  startedAt: string | null;
  cancellable: boolean;
  /** Operator-configured grace length, so copy can state it before scheduling. */
  graceHours?: number;
}

export const getAccountDeletionStatus = async (): Promise<AccountDeletionStatus> =>
  apiClient<AccountDeletionStatus>('/legal/account-deletion');

export const cancelAccountDeletion = async (): Promise<{ cancelledAt: string }> =>
  apiClient<{ cancelledAt: string }>('/legal/cancel-account-deletion', {
    method: 'POST',
    csrf: true,
  });

export interface TwoFactorRecommendationState {
  dismissedAt: string | null;
}

export const fetchTwoFactorRecommendation = async (): Promise<TwoFactorRecommendationState> =>
  apiClient<TwoFactorRecommendationState>('/users/preferences/two-factor-recommendation');

export const dismissTwoFactorRecommendation = async (): Promise<TwoFactorRecommendationState> =>
  apiClient<TwoFactorRecommendationState>('/users/preferences/two-factor-recommendation', {
    method: 'PUT', csrf: true,
  });
