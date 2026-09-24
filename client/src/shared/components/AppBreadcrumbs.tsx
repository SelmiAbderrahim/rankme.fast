import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { DEFAULT_BACKLINK_TAB, isBacklinkTab } from '@features/backlinks';
import { DEFAULT_SITE_TAB, getSiteTabLabelKey, isSiteTab, selectSites } from '@features/sites';
import { useAppSelector } from '@shared/hooks/redux';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@shared/ui/breadcrumb';

interface Crumb {
  label: string;
  to?: string;
}

/**
 * One breadcrumb system for the authed shell. Renders a trail only on the
 * deep pages that need it — the site workspace (+ standalone report) — and
 * nothing elsewhere. Composed into `AppLayout`, never
 * forked per feature. Labels reuse existing nav/tab keys.
 */
export const AppBreadcrumbs = () => {
  const { t } = useTranslation([
    'common',
    'sites',
    'backlinks',
    'pages',
    'clientReports',
    'competitorsTraffic',
  ]);
  const { pathname, search } = useLocation();
  const sites = useAppSelector(selectSites);
  const parts = pathname.split('/').filter(Boolean);

  const crumbs = ((): Crumb[] | null => {
    if (parts[0] === 'sites' && parts[1]) {
      const siteId = parts[1];
      const site = sites.find((s) => s.id === siteId);
      const siteLabel = site?.displayName || site?.domain || siteId;
      const trail: Crumb[] = [
        { label: t('common:nav.dashboard'), to: '/dashboard' },
        { label: t('common:nav.sites'), to: '/sites' },
        { label: siteLabel, to: `/sites/${siteId}` },
      ];
      if (parts[2] === 'report') {
        trail.push({ label: t('sites:workspace.tabs.report') });
      } else if (parts[2] === 'backlinks') {
        // The Link Intelligence workspace owns its own `?tab=`
        // vocabulary (`overview|rows|domains|anchors|history|gap`), which does
        // NOT live in the site-workspace tab namespace. Reading it as one leaked
        // raw keys such as `workspace.tabs.history` into the breadcrumb.
        const tab = new URLSearchParams(search).get('tab') ?? DEFAULT_BACKLINK_TAB;
        trail.push({
          label: t('sites:workspace.tabs.backlinks'),
          to: `/sites/${siteId}?tab=backlinks`,
        });
        trail.push({
          label: t(`backlinks:intelligence.tabs.${isBacklinkTab(tab) ? tab : DEFAULT_BACKLINK_TAB}`),
        });
      } else {
        const requestedTab = new URLSearchParams(search).get('tab');
        const tab = isSiteTab(requestedTab) ? requestedTab : DEFAULT_SITE_TAB;
        trail.push({
          label: t(getSiteTabLabelKey(tab)),
        });
      }
      return trail;
    }
    return null;
  })();

  if (!crumbs) return null;

  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <BreadcrumbItem key={`${crumb.label}-${index}`}>
              {isLast ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink asChild>
                    {/* Non-last crumbs always carry `to` (only the current page omits it). */}
                    <Link to={crumb.to!}>{crumb.label}</Link>
                  </BreadcrumbLink>
                  <BreadcrumbSeparator className="rtl:rotate-180" />
                </>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};
