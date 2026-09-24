/**
 * Map an API failure onto the honest state the surface renders. Every branch
 * carries the server's localized message — the client never invents copy for a
 * refusal it did not author (same discipline as `features/cannibalization`).
 *
 * `403` is the kill switch: the shipped service answers a flag-off generation
 * with the feature-scoped `schemaGenerator.errors.productUnavailable` (spec
 * divergence D-9), while stored reads stay open.
 */
import { ApiError } from '@shared/api/client';
import type { SchemaGate, SchemaGateKind } from './types';

const STATUS_KIND: Record<number, SchemaGateKind> = {
  400: 'unsafeUrl',
  403: 'killSwitch',
  404: 'notFound',
  429: 'rateLimited',
};

function serverMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '';
  const data = error.data as { error?: { message?: unknown } } | undefined;
  const message = data?.error?.message;
  return typeof message === 'string' ? message : '';
}

export function toSchemaGate(error: unknown, fallbackMessage: string): SchemaGate {
  const kind =
    error instanceof ApiError ? (STATUS_KIND[error.status] ?? 'failed') : 'failed';
  return { kind, message: serverMessage(error) || fallbackMessage };
}
