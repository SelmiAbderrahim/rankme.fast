/**
 * Map an API failure onto the honest state the surface renders. Every branch
 * carries the SERVER's localized message — the client never invents copy for a
 * refusal it did not author.
 */
import { ApiError } from '@shared/api/client';
import type { GeogridGate, GeogridGateKind } from './types';

const STATUS_KIND: Record<number, GeogridGateKind> = {
  400: 'invalid',
  404: 'notFound',
  429: 'rateLimited',
  503: 'killSwitch',
};

export function geogridServerMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '';
  const data = error.data as { error?: { message?: unknown } } | undefined;
  const message = data?.error?.message;
  return typeof message === 'string' ? message : '';
}

export function toGeogridGate(error: unknown, fallbackMessage: string): GeogridGate {
  const kind = error instanceof ApiError ? (STATUS_KIND[error.status] ?? 'failed') : 'failed';
  return { kind, message: geogridServerMessage(error) || fallbackMessage };
}
