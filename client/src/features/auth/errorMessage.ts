import type { TFunction } from 'i18next';

export interface AuthClientError {
  status?: number;
  code?: string;
  message?: string;
}

interface AuthMessageRef {
  namespace: 'auth' | 'errors';
  key: string;
}

const errors = (key: string): AuthMessageRef => ({ namespace: 'errors', key });
const auth = (key: string): AuthMessageRef => ({ namespace: 'auth', key });

/** Mirrors the installed Better Auth base + two-factor codes and RankMe hooks. */
export const AUTH_CODE_TO_MESSAGE = Object.freeze({
  USER_NOT_FOUND: errors('invalidCredentials'),
  FAILED_TO_CREATE_USER: auth('error.accountUnavailable'),
  FAILED_TO_CREATE_SESSION: auth('error.sessionUnavailable'),
  FAILED_TO_UPDATE_USER: auth('error.accountUpdateFailed'),
  FAILED_TO_GET_SESSION: auth('error.sessionUnavailable'),
  INVALID_PASSWORD: errors('invalidCredentials'),
  INVALID_EMAIL: errors('emailInvalid'),
  INVALID_EMAIL_OR_PASSWORD: errors('invalidCredentials'),
  INVALID_USER: errors('invalidCredentials'),
  SOCIAL_ACCOUNT_ALREADY_LINKED: auth('error.accountLinkUnavailable'),
  PROVIDER_NOT_FOUND: auth('error.oauthUnavailable'),
  INVALID_TOKEN: auth('error.linkInvalidOrExpired'),
  TOKEN_EXPIRED: auth('error.linkInvalidOrExpired'),
  ID_TOKEN_NOT_SUPPORTED: auth('error.oauthUnavailable'),
  FAILED_TO_GET_USER_INFO: auth('error.oauthUnavailable'),
  USER_EMAIL_NOT_FOUND: errors('invalidCredentials'),
  EMAIL_NOT_VERIFIED: auth('error.emailNotVerified'),
  PASSWORD_TOO_SHORT: errors('passwordTooShort'),
  PASSWORD_TOO_LONG: auth('error.passwordTooLong'),
  USER_ALREADY_EXISTS: auth('error.accountUnavailable'),
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: auth('error.accountUnavailable'),
  EMAIL_CAN_NOT_BE_UPDATED: auth('error.emailChangeUnavailable'),
  CHANGE_EMAIL_DISABLED: auth('error.emailChangeUnavailable'),
  CREDENTIAL_ACCOUNT_NOT_FOUND: errors('invalidCredentials'),
  SESSION_EXPIRED: auth('sessionExpired'),
  FAILED_TO_UNLINK_LAST_ACCOUNT: auth('error.accountLinkUnavailable'),
  ACCOUNT_NOT_FOUND: errors('invalidCredentials'),
  USER_ALREADY_HAS_PASSWORD: auth('error.requestInvalid'),
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: errors('forbidden'),
  VERIFICATION_EMAIL_NOT_ENABLED: auth('error.verificationUnavailable'),
  EMAIL_ALREADY_VERIFIED: auth('error.requestInvalid'),
  EMAIL_MISMATCH: auth('error.requestInvalid'),
  SESSION_NOT_FRESH: auth('error.recentSignInRequired'),
  LINKED_ACCOUNT_ALREADY_EXISTS: auth('error.accountLinkUnavailable'),
  INVALID_ORIGIN: errors('forbidden'),
  INVALID_CALLBACK_URL: auth('error.requestInvalid'),
  INVALID_REDIRECT_URL: auth('error.requestInvalid'),
  INVALID_ERROR_CALLBACK_URL: auth('error.requestInvalid'),
  INVALID_NEW_USER_CALLBACK_URL: auth('error.requestInvalid'),
  MISSING_OR_NULL_ORIGIN: errors('forbidden'),
  CALLBACK_URL_REQUIRED: auth('error.requestInvalid'),
  FAILED_TO_CREATE_VERIFICATION: auth('error.verificationUnavailable'),
  FIELD_NOT_ALLOWED: auth('error.requestInvalid'),
  ASYNC_VALIDATION_NOT_SUPPORTED: auth('error.requestInvalid'),
  VALIDATION_ERROR: errors('validationFailed'),
  MISSING_FIELD: errors('validationFailed'),
  METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED: auth('error.requestInvalid'),
  BODY_MUST_BE_AN_OBJECT: auth('error.requestInvalid'),
  PASSWORD_ALREADY_SET: auth('error.requestInvalid'),
  OTP_NOT_ENABLED: auth('error.factorNotEnabled'),
  OTP_HAS_EXPIRED: auth('error.twoFactorExpired'),
  TOTP_NOT_ENABLED: auth('error.factorNotEnabled'),
  TWO_FACTOR_NOT_ENABLED: auth('error.factorNotEnabled'),
  BACKUP_CODES_NOT_ENABLED: auth('error.factorNotEnabled'),
  INVALID_BACKUP_CODE: auth('error.invalidTwoFactorCode'),
  INVALID_CODE: auth('error.invalidTwoFactorCode'),
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: auth('error.twoFactorLocked'),
  ACCOUNT_TEMPORARILY_LOCKED: auth('error.twoFactorLocked'),
  INVALID_TWO_FACTOR_COOKIE: auth('sessionExpired'),
  DIRECT_ID_TOKEN_OAUTH_DISABLED: auth('error.directOauthDisabled'),
  PROVISIONAL_ACCOUNT_RESTRICTED: auth('error.provisionalRestricted'),
} satisfies Record<string, AuthMessageRef>);

/**
 * Map a Better Auth client error onto the localized message catalog. Codes
 * take precedence (stable across locales); 401/429 fall back by status so
 * rate-limit and stale-credential responses stay localized too.
 */
export const messageForAuthError = (
  error: AuthClientError,
  t: TFunction<['auth', 'errors']>,
): string => {
  const ref = error.code ? AUTH_CODE_TO_MESSAGE[error.code as keyof typeof AUTH_CODE_TO_MESSAGE] : undefined;
  if (ref) return t(ref.key as never, { ns: ref.namespace });
  // A future/plugin code is deliberately generic until its security and UX
  // semantics are reviewed. Never display the server/library prose here.
  if (error.code) return t('internal', { ns: 'errors' });
  if (error.status === 401) return t('invalidCredentials', { ns: 'errors' });
  if (error.status === 429) return t('tooManyRequests', { ns: 'auth' });
  return t('internal', { ns: 'errors' });
};
