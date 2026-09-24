import { BASE_ERROR_CODES } from '@better-auth/core/error';
import { TWO_FACTOR_ERROR_CODES } from 'better-auth/plugins';
import { renderTranslation, statusFamily, type TranslationKey, } from '../../shared/i18n/errors.js';
import { localeFromFetchRequest } from '../../shared/i18n/request-locale.js';
export const RANKME_AUTH_ERROR_CODES = Object.freeze({
    DIRECT_ID_TOKEN_OAUTH_DISABLED: 'DIRECT_ID_TOKEN_OAUTH_DISABLED',
    PROVISIONAL_ACCOUNT_RESTRICTED: 'PROVISIONAL_ACCOUNT_RESTRICTED',
} as const);
export const REACHABLE_BETTER_AUTH_ERROR_CODES = Object.freeze({
    ...BASE_ERROR_CODES,
    ...TWO_FACTOR_ERROR_CODES,
    ...Object.fromEntries(Object.entries(RANKME_AUTH_ERROR_CODES).map(([name, code]) => [name, { code, message: code }])),
});
type BaseCode = keyof typeof BASE_ERROR_CODES;
type TwoFactorCode = keyof typeof TWO_FACTOR_ERROR_CODES;
type RankMeCode = keyof typeof RANKME_AUTH_ERROR_CODES;
export type ReachableAuthErrorCode = BaseCode | TwoFactorCode | RankMeCode;
/**
 * Exhaustive installed-code policy. Several upstream codes intentionally
 * share broad copy so password, reset, verification, and account-recovery
 * responses never reveal whether an identity exists.
 */
export const BETTER_AUTH_ERROR_KEYS = Object.freeze({
    USER_NOT_FOUND: 'errors.invalidCredentials',
    FAILED_TO_CREATE_USER: 'auth.error.accountUnavailable',
    FAILED_TO_CREATE_SESSION: 'auth.error.sessionUnavailable',
    FAILED_TO_UPDATE_USER: 'auth.error.accountUpdateFailed',
    FAILED_TO_GET_SESSION: 'auth.error.sessionUnavailable',
    INVALID_PASSWORD: 'errors.invalidCredentials',
    INVALID_EMAIL: 'validation.issue.invalidEmail',
    INVALID_EMAIL_OR_PASSWORD: 'errors.invalidCredentials',
    INVALID_USER: 'errors.invalidCredentials',
    SOCIAL_ACCOUNT_ALREADY_LINKED: 'auth.error.accountLinkUnavailable',
    PROVIDER_NOT_FOUND: 'auth.error.oauthUnavailable',
    INVALID_TOKEN: 'auth.error.linkInvalidOrExpired',
    TOKEN_EXPIRED: 'auth.error.linkInvalidOrExpired',
    ID_TOKEN_NOT_SUPPORTED: 'auth.error.oauthUnavailable',
    FAILED_TO_GET_USER_INFO: 'auth.error.oauthUnavailable',
    USER_EMAIL_NOT_FOUND: 'errors.invalidCredentials',
    EMAIL_NOT_VERIFIED: 'errors.emailNotVerified',
    PASSWORD_TOO_SHORT: 'errors.passwordTooShort',
    PASSWORD_TOO_LONG: 'auth.error.passwordTooLong',
    USER_ALREADY_EXISTS: 'auth.error.accountUnavailable',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.error.accountUnavailable',
    EMAIL_CAN_NOT_BE_UPDATED: 'auth.error.emailChangeUnavailable',
    CHANGE_EMAIL_DISABLED: 'auth.error.emailChangeUnavailable',
    CREDENTIAL_ACCOUNT_NOT_FOUND: 'errors.invalidCredentials',
    SESSION_EXPIRED: 'auth.error.sessionExpired',
    FAILED_TO_UNLINK_LAST_ACCOUNT: 'auth.error.accountLinkUnavailable',
    ACCOUNT_NOT_FOUND: 'errors.invalidCredentials',
    USER_ALREADY_HAS_PASSWORD: 'auth.error.requestInvalid',
    CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: 'errors.forbidden',
    VERIFICATION_EMAIL_NOT_ENABLED: 'auth.error.verificationUnavailable',
    EMAIL_ALREADY_VERIFIED: 'auth.error.requestInvalid',
    EMAIL_MISMATCH: 'auth.error.requestInvalid',
    SESSION_NOT_FRESH: 'auth.error.recentSignInRequired',
    LINKED_ACCOUNT_ALREADY_EXISTS: 'auth.error.accountLinkUnavailable',
    INVALID_ORIGIN: 'errors.forbidden',
    INVALID_CALLBACK_URL: 'auth.error.requestInvalid',
    INVALID_REDIRECT_URL: 'auth.error.requestInvalid',
    INVALID_ERROR_CALLBACK_URL: 'auth.error.requestInvalid',
    INVALID_NEW_USER_CALLBACK_URL: 'auth.error.requestInvalid',
    MISSING_OR_NULL_ORIGIN: 'errors.forbidden',
    CALLBACK_URL_REQUIRED: 'auth.error.requestInvalid',
    FAILED_TO_CREATE_VERIFICATION: 'auth.error.verificationUnavailable',
    FIELD_NOT_ALLOWED: 'auth.error.requestInvalid',
    ASYNC_VALIDATION_NOT_SUPPORTED: 'auth.error.requestInvalid',
    VALIDATION_ERROR: 'errors.validationFailed',
    MISSING_FIELD: 'validation.issue.required',
    METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED: 'auth.error.requestInvalid',
    BODY_MUST_BE_AN_OBJECT: 'auth.error.requestInvalid',
    PASSWORD_ALREADY_SET: 'auth.error.requestInvalid',
    OTP_NOT_ENABLED: 'auth.error.factorNotEnabled',
    OTP_HAS_EXPIRED: 'auth.error.twoFactorExpired',
    TOTP_NOT_ENABLED: 'auth.error.factorNotEnabled',
    TWO_FACTOR_NOT_ENABLED: 'auth.error.factorNotEnabled',
    BACKUP_CODES_NOT_ENABLED: 'auth.error.factorNotEnabled',
    INVALID_BACKUP_CODE: 'auth.error.invalidTwoFactorCode',
    INVALID_CODE: 'auth.error.invalidTwoFactorCode',
    TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'auth.error.twoFactorLocked',
    ACCOUNT_TEMPORARILY_LOCKED: 'auth.error.twoFactorLocked',
    INVALID_TWO_FACTOR_COOKIE: 'auth.error.sessionExpired',
    DIRECT_ID_TOKEN_OAUTH_DISABLED: 'auth.error.directOauthDisabled',
    PROVISIONAL_ACCOUNT_RESTRICTED: 'auth.error.provisionalRestricted',
} satisfies Record<ReachableAuthErrorCode, TranslationKey>);
const STABLE_CODE = /^[A-Z][A-Z0-9_]{0,95}$/;
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function localizeErrorRecord(record: Record<string, unknown>, status: number, locale: ReturnType<typeof localeFromFetchRequest>): Record<string, unknown> {
    const family = statusFamily(status);
    const upstreamCode = record.code;
    const code = typeof upstreamCode === 'string' && STABLE_CODE.test(upstreamCode)
        ? upstreamCode
        : family.code;
    const messageKey = BETTER_AUTH_ERROR_KEYS[code as ReachableAuthErrorCode] ?? family.messageKey;
    return {
        ...record,
        code,
        message: renderTranslation(locale, messageKey),
        messageKey,
    };
}
/**
 * Localize only Better Auth JSON failures. Response reconstruction copies all
 * headers (including every Set-Cookie/security/rate-limit header), removes the
 * now-stale length, and leaves successes, redirects, HTML, and streams alone.
 */
export async function localizeBetterAuthResponse(request: Request, response: Response): Promise<Response> {
    if (response.status < 400)
        return response;
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('application/json'))
        return response;
    let body: unknown;
    try {
        body = await response.clone().json();
    }
    catch {
        return response;
    }
    if (!isRecord(body))
        return response;
    const locale = localeFromFetchRequest(request);
    const localized = isRecord(body.error)
        ? { ...body, error: localizeErrorRecord(body.error, response.status, locale) }
        : localizeErrorRecord(body, response.status, locale);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('Content-Language', locale);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(localized), {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
