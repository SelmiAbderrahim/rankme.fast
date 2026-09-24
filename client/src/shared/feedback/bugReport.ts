import i18n from 'i18next';
import { BRAND_SUPPORT_EMAIL } from '@shared/brand';
import { githubUrl } from '@shared/config/github';
import { releaseStage } from '@shared/config/release';
import { appVersion } from '@shared/config/version';
import { isSupportedLocale } from '@shared/i18n/locales';

function browserFamily(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Edg(?:e|A|iOS)?\//u.test(agent)) return 'Edge';
  if (/(?:Firefox|FxiOS)\//u.test(agent)) return 'Firefox';
  if (/(?:Chrome|CriOS)\//u.test(agent)) return 'Chrome';
  if (/Safari\//u.test(agent)) return 'Safari';
  return 'Other';
}

function isSafeRoutePattern(routePattern: string): boolean {
  if (routePattern.length > 300 || !/^\/(?:[a-zA-Z0-9_:/?*-])*$/u.test(routePattern)) {
    return false;
  }
  // A declared route may contain named parameters but never an opaque concrete
  // identifier. Reject the identifier shapes our route callers can encounter
  // if a location path is accidentally supplied instead of a match pattern.
  return !routePattern
    .split('/')
    .some(
      (segment) =>
        /^[a-f0-9]{24}$/iu.test(segment) ||
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(segment),
    );
}

/** Callers supply declared route paths, never resolved URLs or user data. */
export function buildBugReportHref({
  routePattern,
  requestId,
}: {
  routePattern: string;
  requestId?: string;
}): string {
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const fields = {
    version: appVersion,
    edition: 'cloud',
    stage: releaseStage(),
    route: isSafeRoutePattern(routePattern) ? routePattern : '/',
    browser: browserFamily(),
    locale: isSupportedLocale(locale) ? locale : 'en',
  };
  // Only canonical UUID request IDs can be attached, and only by a caller that
  // already displays that ID. Current shared surfaces display none.
  const displayedId =
    requestId && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(requestId)
      ? requestId
      : undefined;
  const body =
    Object.entries(fields)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n') + (displayedId ? `\nrequestId: ${displayedId}` : '');
  const subject = i18n.t('common:feedback.mailSubject', { version: appVersion });
  const mail = `mailto:${BRAND_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const repo = githubUrl();
  if (repo) {
    const url = new URL(`${repo.split(/[?#]/u)[0]!.replace(/\/+$/u, '')}/issues/new`);
    // Reject credentials and discard configured query/fragment before adding
    // the fixed issue-form fields. Never truncate an encoded URL.
    if (url.protocol === 'https:' && !url.username && !url.password) {
      url.search = new URLSearchParams({
        template: 'bug_report.yml',
        ...fields,
        ...(displayedId ? { body: `requestId: ${displayedId}` } : {}),
      }).toString();
      url.hash = '';
      if (url.href.length < 2000) return url.href;
    }
  }
  return mail;
}
