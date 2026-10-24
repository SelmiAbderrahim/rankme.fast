import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigationType } from 'react-router-dom';
import { selectSites } from '@features/sites';
import { useAppSelector } from '@shared/hooks/redux';
import { formatAppTitle, resolveAppTitleTarget } from '@shared/navigation/appTitle';
import type { AppTitleDetail, AppTitleRegistry } from '@shared/navigation/appTitleContext';

/**
 * Keeps `document.title` in step with the authenticated route: page name
 * (from the shared nav / site tab config), the site's name or domain on site
 * workspace routes, then the brand — translated, and recomputed on language
 * change. The title that was in place before the shell mounted is restored on
 * unmount. A small effect rather than Helmet: the shell is client-only and
 * Helmet stays reserved for the server-rendered public pages.
 */
export const useAppDocumentTitle = () => {
  const { t } = useTranslation([
    'common',
    'alerts',
    'sites',
    'pages',
    'clientReports',
    'competitorsTraffic',
    'auth',
    'team',
  ]);
  const { pathname, search, key } = useLocation();
  const navigation = useNavigationType();
  const sites = useAppSelector(selectSites);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [detail, setDetail] = useState<AppTitleDetail | null>(null);
  const registry = useMemo<AppTitleRegistry>(() => ({
    set(next) {
      if (next.locationKey === currentKey.current) setDetail(next);
    },
    clear(token) {
      setDetail((previous) => previous?.token === token ? null : previous);
    },
  }), []);

  const { pageKey, siteId } = resolveAppTitleTarget(pathname, search);
  const site = siteId === null ? undefined : sites.find((s) => s.id === siteId);
  // Until the site list loads there is no honest name; never show the raw id.
  const title = detail?.locationKey === key ? formatAppTitle(detail.segments.join(' · '), null) : formatAppTitle(
    pageKey === null ? null : t(pageKey),
    site ? site.displayName || site.domain : null,
  );

  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    document.title = title;
  }, [title]);

  const previous = useRef({ key, pathname, title });
  const hasNavigated = useRef(false);
  const [announced, setAnnounced] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    const before = previous.current;
    const pathChanged = before.pathname !== pathname;
    if (before.key !== key || pathChanged) hasNavigated.current = true;
    previous.current = { key, pathname, title };
    if (pathChanged && navigation !== 'REPLACE') {
      const main = document.getElementById('main-content') ?? document.querySelector('main');
      if (main) {
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
      }
    }
    if (hasNavigated.current && (pathChanged || before.title !== title)) setAnnounced({ key, text: title });
  }, [key, pathname, title, navigation]);

  return { title, registry, announcement: announced?.key === key ? announced.text : '' };
};
