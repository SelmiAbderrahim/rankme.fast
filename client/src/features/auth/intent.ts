import {
  isSupportedLocale,
  type SupportedLocale,
} from '@shared/i18n';
export { authEntryHref } from '@shared/i18n/localePath';

interface SafeAuthIntent {
  locale: SupportedLocale | null;
  returnTo: string | null;
}

const SAFE_TEAM_RETURN_PATH = /^\/team\/(?:accept|reject)\/[A-Za-z0-9_-]{16,200}$/;

export function safeTeamReturnTo(value: string | null | undefined): string | null {
  if (!value || !SAFE_TEAM_RETURN_PATH.test(value)) return null;
  return value;
}

function paramsFrom(search: string | URLSearchParams): URLSearchParams {
  return typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
}

function readSafeAuthIntent(search: string | URLSearchParams): SafeAuthIntent {
  const params = paramsFrom(search);
  const locale = params.get('lng');
  return {
    locale: isSupportedLocale(locale) ? locale : null,
    returnTo: safeTeamReturnTo(params.get('returnTo')),
  };
}

export function authSuccessHref(search: string | URLSearchParams): string {
  return readSafeAuthIntent(search).returnTo ?? '/dashboard';
}

export function loginHrefForReturnTo(returnTo: string): string {
  const safe = safeTeamReturnTo(returnTo);
  if (!safe) return '/login';
  return `/login?${new URLSearchParams({ returnTo: safe }).toString()}`;
}

export function requiredPasswordChangeHref(returnTo: string): string {
  const safe = safeTeamReturnTo(returnTo);
  const params = safe ? `?${new URLSearchParams({ returnTo: safe }).toString()}` : '';
  return `/team/change-password${params}`;
}

export function verifyEmailHref(search: string | URLSearchParams): string {
  const { locale } = readSafeAuthIntent(search);
  return locale ? `/verify-email?${new URLSearchParams({ lng: locale }).toString()}` : '/verify-email';
}
