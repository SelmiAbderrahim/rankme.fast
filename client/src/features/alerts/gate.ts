/**
 * Map an API failure onto the honest state the surface renders. Every branch
 * carries the server's localized message — the client never invents copy for a
 * refusal it did not author.
 */
import { ApiError } from '@shared/api/client';
import type { AlertGate, AlertGateKind } from './types';

const STATUS_KIND: Record<number, AlertGateKind> = {
  400: 'invalid',
  404: 'notFound',
  429: 'rateLimited',
  503: 'disabled',
};

interface ErrorBody {
  error?: { message?: unknown };
}

function body(error: unknown): ErrorBody | undefined {
  return error instanceof ApiError ? (error.data as ErrorBody | undefined) : undefined;
}

function serverMessage(error: unknown): string {
  const message = body(error)?.error?.message;
  return typeof message === 'string' ? message : '';
}

export function toAlertGate(error: unknown, fallbackMessage: string): AlertGate {
  let kind: AlertGateKind = 'failed';
  if (error instanceof ApiError) {
    kind = STATUS_KIND[error.status] ?? 'failed';
  }
  return { kind, message: serverMessage(error) || fallbackMessage };
}
