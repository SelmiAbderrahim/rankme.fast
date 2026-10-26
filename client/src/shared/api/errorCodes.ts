/** Client aliases mirror the server's canonical error-code authority. */
export const API_ERROR_CODE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  SITES_ERRORS_NOT_FOUND: 'SITE_NOT_FOUND',
  SITES_NOT_FOUND: 'SITE_NOT_FOUND',
  PAGES_SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  BACKLINKS_ERRORS_SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  COMPETITORS_ERRORS_SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  TEAM_ERRORS_SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  LOCAL_SEO_ERRORS_SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  KEYWORD_RESEARCH_ERRORS_SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  ALERTS_ERRORS_SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  AI_VISIBILITY_ERRORS_SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  ERRORS_USER_NOT_FOUND: 'USER_NOT_FOUND',
  AUDITS_ERRORS_NOT_FOUND: 'AUDIT_RUN_NOT_FOUND',
  UNAUTHORIZED: 'AUTH_REQUIRED',
  FORBIDDEN: 'ACCESS_FORBIDDEN',
  CONFLICT: 'RESOURCE_CONFLICT',
  INTERNAL: 'INTERNAL_ERROR',
  ERROR: 'UNKNOWN_ERROR',
});

export const API_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/u;

/** Resolve known legacy names; unknown codes remain opaque for forward compatibility. */
export const canonicalApiErrorCode = (code: string): string =>
  Object.hasOwn(API_ERROR_CODE_ALIASES, code) ? API_ERROR_CODE_ALIASES[code]! : code;

/** Existing localized copy keeps resource ownership errors deliberately generic. */
export const API_ERROR_CODE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  SITE_NOT_FOUND: 'errors:notFound',
  AUDIT_RUN_NOT_FOUND: 'errors:notFound',
  USER_NOT_FOUND: 'errors:notFound',
});
