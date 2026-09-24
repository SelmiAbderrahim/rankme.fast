/**
 * Map an API failure onto the honest state the surface renders. Every branch
 * carries the server's localized message — the client never invents copy for a
 * refusal it did not author.
 *
 * `cap` and `tierLocked` share HTTP 402, so they are separated by the server's
 * `details.structuralLimit` / `details.requiredTier` discriminator rather than
 * by string matching on a translated message.
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
  error?: {
    message?: unknown;
    details?: { structuralLimit?: unknown; requiredTier?: unknown };
  };
}

function body(error: unknown): ErrorBody | undefined {
  return error instanceof ApiError ? (error.data as ErrorBody | undefined) : undefined;
}

function serverMessage(error: unknown): string {
  const message = body(error)?.error?.message;
  return typeof message === 'string' ? message : '';
}

function paymentKind(error: unknown): AlertGateKind {
  const details = body(error)?.error?.details;
  // A structural-limit refusal names the limit; a channel refusal names the
  // tier it needs. Anything else on 402 is still disclosed as a cap.
  return details?.requiredTier !== undefined && details?.structuralLimit === undefined
    ? 'tierLocked'
    : 'cap';
}

export function toAlertGate(error: unknown, fallbackMessage: string): AlertGate {
  let kind: AlertGateKind = 'failed';
  if (error instanceof ApiError) {
    kind = error.status === 402 ? paymentKind(error) : (STATUS_KIND[error.status] ?? 'failed');
  }
  return { kind, message: serverMessage(error) || fallbackMessage };
}
