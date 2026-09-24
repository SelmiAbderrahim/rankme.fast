import { apiErrorInfo } from '@shared/api/errorMessage';

/**
 * Report-export surfaces receive both the ordinary object envelope and the
 * legacy rate-limit string envelope. Both are read through the one shared
 * parser, so a raw translation key, an unresolved placeholder, or an
 * unrecognized body falls back to the caller's localized copy instead of
 * being rendered.
 */
export function reportExportErrorMessage(error: unknown, fallback: string): string {
  return apiErrorInfo(error)?.message ?? fallback;
}
