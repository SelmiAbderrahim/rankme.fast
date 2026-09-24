import i18n from 'i18next';
import { ApiError } from '@shared/api/client';

/**
 * Normalized view of every error envelope the API can return.
 *
 * Three wire families are accepted:
 *  - ordinary object errors — `{ error: { message, details?, code?, messageKey? } }`
 *  - coded rate limits      — `{ error: { code, message, messageKey? } }`
 *  - legacy rate limits     — `{ error: '<string>', errorInfo?: { code, messageKey, message } }`
 */
export interface ApiErrorInfo {
  /** Which wire family produced this envelope. */
  family: 'object' | 'legacy';
  code: string | null;
  messageKey: string | null;
  /** Display-safe localized copy, or null when nothing displayable was sent. */
  message: string | null;
  details: unknown;
}

/** `errors.notFound` — a translation key must never reach a user. */
const KEY_SHAPED = /^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)+$/;
/** `{{metric}}` — an unresolved placeholder must never reach a user either. */
const PLACEHOLDER = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/;

/** Accept a string only when it is real localized copy. */
const displayable = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (KEY_SHAPED.test(trimmed)) return null;
  if (PLACEHOLDER.test(trimmed)) return null;
  return trimmed;
};

/** Machine identifiers stay opaque strings; anything else is discarded. */
const machineString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Parse any accepted envelope into one shape. Returns null when the body is
 * not a recognized error envelope — an untrusted shape never becomes copy.
 */
export const parseApiErrorEnvelope = (data: unknown): ApiErrorInfo | null => {
  const body = asRecord(data);
  if (body === null) return null;

  const nested = asRecord(body.error);
  if (nested !== null) {
    return {
      family: 'object',
      code: machineString(nested.code),
      messageKey: machineString(nested.messageKey),
      message: displayable(nested.message),
      details: nested.details,
    };
  }

  if (typeof body.error !== 'string') return null;
  const info = asRecord(body.errorInfo);
  return {
    family: 'legacy',
    code: info === null ? null : machineString(info.code),
    messageKey: info === null ? null : machineString(info.messageKey),
    message: displayable(body.error) ?? displayable(info?.message),
    details: body.details,
  };
};

/** Normalized envelope for an `ApiError`, or null for any other value. */
export const apiErrorInfo = (err: unknown): ApiErrorInfo | null =>
  err instanceof ApiError ? parseApiErrorEnvelope(err.data) : null;

/**
 * Prefer the server's localized error message; fall back to a localized
 * client-side string via `i18n.t(fallbackKey)` for network-level failures and
 * for any body that carried nothing displayable. A raw translation key, an
 * unresolved placeholder, the internal `ApiError.message` wrapper text, and
 * untrusted shapes are never shown.
 *
 * A legacy string envelope counts as copy only when the server marked it with
 * the additive `errorInfo` metadata. An unmarked `{ error: '<string>' }` body
 * may be an opaque token from an older producer, so it keeps falling back to
 * the caller's own localized copy.
 */
export function apiErrorMessage(err: unknown, fallbackKey: string): string {
  if (err instanceof ApiError) {
    const info = parseApiErrorEnvelope(err.data);
    const trusted = info !== null && (info.family === 'object' || info.messageKey !== null);
    if (trusted && info.message !== null) return info.message;
    if (err.code === 'network' || err.code === 'timeout') {
      return i18n.t(`errors:${err.code}`);
    }
  }
  return i18n.t(fallbackKey);
}

export function apiErrorStatus(err: unknown): number | null {
  return err instanceof ApiError ? err.status : null;
}

/** Stable machine code the server attached to this error, when it sent one. */
export function apiErrorCode(err: unknown): string | null {
  return apiErrorInfo(err)?.code ?? null;
}

/** Stable dictionary key the server rendered this error from. */
export function apiErrorMessageKey(err: unknown): string | null {
  return apiErrorInfo(err)?.messageKey ?? null;
}

/** Render a stable server message key from the active client dictionary. */
export function translateApiMessageKey(messageKey: string | null): string | null {
  if (messageKey === null) return null;
  const separator = messageKey.indexOf('.');
  if (separator <= 0 || separator === messageKey.length - 1) return null;
  const clientKey = `${messageKey.slice(0, separator)}:${messageKey.slice(separator + 1)}`;
  return i18n.exists(clientKey) ? i18n.t(clientKey) : null;
}

/** Locale the server rendered this error in (`Content-Language`). */
export function apiErrorLanguage(err: unknown): string | null {
  return err instanceof ApiError ? err.contentLanguage : null;
}

/** Cooldown length a 429 refresh response carries in its details payload. */
export function apiErrorRetryAfterMs(err: unknown): number | null {
  const details = asRecord(apiErrorInfo(err)?.details);
  const value = details?.retryAfterMs;
  return typeof value === 'number' && value > 0 ? value : null;
}
