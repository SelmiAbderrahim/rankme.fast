/**
 * The language a crawled page is written in, resolved in
 * the order the evidence is trustworthy:
 *   1. the page's own declaration (`<html lang>`), when the crawl reported it;
 *   2. a locale segment at the start of the URL path (`/zh/about`,
 *      `/pt-br/pricing`) — how multilingual sites publish hreflang variants;
 *   3. the script of the title, heading and description.
 * `null` = nothing names a language; callers measure it as a spaced language.
 */
import type { AuditPage } from '../../../shared/providers/index.js';
import { detectLanguage, primaryLanguage } from '../../../shared/utils/text-length.js';

/** `/zh`, `/zh-cn`, `/pt_BR` — a leading locale segment of a path. */
const LOCALE_PATH_SEGMENT = /^\/([a-z]{2,3})(?:[-_][a-z0-9]{2,4})?(?=\/|$)/i;

/** Primary language named by the URL's leading path segment, if any. */
export function urlPathLanguage(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = LOCALE_PATH_SEGMENT.exec(pathname);
  return match ? primaryLanguage(match[1]) : null;
}

export function pageLanguage(
  page: Pick<AuditPage, 'url' | 'htmlLang' | 'title' | 'h1' | 'metaDescription'>,
): string | null {
  return (
    primaryLanguage(page.htmlLang) ??
    urlPathLanguage(page.url) ??
    detectLanguage([page.title ?? '', ...page.h1, page.metaDescription ?? ''].join(' '))
  );
}
