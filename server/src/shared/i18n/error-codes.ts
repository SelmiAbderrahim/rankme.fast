/** Stable API error codes. Aliases retain compatibility through `legacyCode`. */
export const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/u;

/** Shared logical errors use the same code across every product route. */
export const ERROR_CODE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
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

/** Normalize dictionary-derived and legacy codes to `<DOMAIN>_<REASON>`. */
export function canonicalErrorCode(code: string): string {
    const aliased = Object.hasOwn(ERROR_CODE_ALIASES, code) ? ERROR_CODE_ALIASES[code] : undefined;
    if (aliased)
        return aliased;
    const cleaned = code
        .toUpperCase()
        .replace(/[^A-Z0-9_]/gu, '')
        .replace(/_{2,}/gu, '_')
        .replace(/^_+|_+$/gu, '')
        .replace(/^ERR(?:ORS?)?_(?=[A-Z])/u, '');
    const normalized = ERROR_CODE_ALIASES[cleaned] ?? cleaned;
    if (ERROR_CODE_PATTERN.test(normalized) && !normalized.startsWith('ERR'))
        return normalized;
    const suffixed = `${normalized}_ERROR`;
    return ERROR_CODE_PATTERN.test(suffixed) && !normalized.startsWith('ERR') ? suffixed : 'UNKNOWN_ERROR';
}
