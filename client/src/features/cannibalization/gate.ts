/**
 * Map an API failure onto the honest state the surface renders. Every branch
 * carries the server's localized message — the client never invents copy for a
 * refusal it did not author.
 */
import { ApiError } from '@shared/api/client';
import type { CannibalizationGate, CannibalizationGateKind } from './types';

const STATUS_KIND: Record<number, CannibalizationGateKind> = {
  404: 'notFound',
  409: 'awaitingSync',
  429: 'rateLimited',
  503: 'disabled',
};

function serverMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '';
  const data = error.data as { error?: { message?: unknown } } | undefined;
  const message = data?.error?.message;
  return typeof message === 'string' ? message : '';
}

export function toCannibalizationGate(
  error: unknown,
  fallbackMessage: string,
): CannibalizationGate {
  const kind =
    error instanceof ApiError ? (STATUS_KIND[error.status] ?? 'failed') : 'failed';
  return { kind, message: serverMessage(error) || fallbackMessage };
}
