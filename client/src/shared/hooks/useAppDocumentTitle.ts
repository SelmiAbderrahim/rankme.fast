import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { selectSites } from '@features/sites';
import { useAppSelector } from '@shared/hooks/redux';
import { formatAppTitle, resolveAppTitleTarget } from '@shared/navigation/appTitle';

/**
 * Keeps `document.title` in step with the authenticated route: page name
 * (from the shared nav / site tab config), the site's name or domain on site
 * workspace routes, then the brand — translated, and recomputed on language
 * change. The title that was in place before the shell mounted is restored on
 * unmount. A small effect rather than Helmet: the shell is client-only and
 * Helmet stays reserved for the server-rendered public pages.
 */
export const useAppDocumentTitle = (): void => {
  const { t } = useTranslation([
    'common',
    'alerts',
    'sites',
    'pages',
    'clientReports',
    'competitorsTraffic',
  ]);
  const { pathname, search } = useLocation();
  const sites = useAppSelector(selectSites);

  const { pageKey, siteId } = resolveAppTitleTarget(pathname, search);
  const site = siteId === null ? undefined : sites.find((s) => s.id === siteId);
  // Until the site list loads there is no honest name; never show the raw id.
  const title = formatAppTitle(
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
};
