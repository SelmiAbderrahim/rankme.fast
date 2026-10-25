import { Bdi } from '@shared/components/Bdi';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { DEFAULT_BACKLINK_TAB, isBacklinkTab } from '@features/backlinks';
import {
  DEFAULT_SITE_TAB,
  getExplicitSubView,
  getSiteTabLabelKey,
  isSiteTab,
  selectSites,
  useSiteLookup,
} from '@features/sites';
import { useAppSelector } from '@shared/hooks/redux';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@shared/ui/breadcrumb';
import { Skeleton } from '@shared/ui/skeleton';

interface Crumb {
  label: string;
  to?: string;
  /** The label is still being looked up: render a neutral skeleton (never the last crumb). */
  pending?: boolean;
}

interface StaticCrumb {
  /** `namespace:key` i18n key. */
  labelKey: string;
  /** Link target; omitted on the current page (the last crumb). */
  to?: string;
}

/**
 * The one breadcrumb rule for the authed shell: every page shows
 * `Dashboard › …`; the Dashboard itself is its only crumb. Fixed pages are described by this
 * table (exact pathname → trail below the Dashboard crumb); the site workspace
 * and its standalone report and Link Intelligence pages are computed from the
 * site record and `?tab=` / `?view=`. Labels reuse the nav/tab keys, so every
 * crumb is localized with the page it names. Composed into `AppLayout`, never
 * forked per feature.
 */
const STATIC_TRAILS: Readonly<Record<string, readonly StaticCrumb[]>> = {
  '/sites': [{ labelKey: 'common:nav.sites' }],
  '/assistant': [{ labelKey: 'common:nav.assistant' }],
  '/keyword-research': [{ labelKey: 'common:nav.keywordResearch' }],
  '/keyword-research/live-trends': [
    { labelKey: 'common:nav.keywordResearch', to: '/keyword-research' },
    { labelKey: 'keywordResearch:liveTrends.title' },
  ],
  '/keyword-research/history': [
    { labelKey: 'common:nav.keywordResearch', to: '/keyword-research' },
    { labelKey: 'keywordResearch:history.title' },
  ],
  '/dashboard/alerts': [{ labelKey: 'alerts:title' }],
  '/exports': [{ labelKey: 'common:nav.exports' }],
  '/settings/profile': [{ labelKey: 'common:shell.profile' }],
  '/settings/team': [{ labelKey: 'common:nav.team' }],
  '/settings/notifications': [{ labelKey: 'common:nav.notifications' }],
  '/settings/security': [{ labelKey: 'common:nav.security' }],
  '/settings/workspace': [{ labelKey: 'common:nav.workspace' }],
  '/team/invitations': [{ labelKey: 'team:inbox.title' }],
};

const normalizePath = (pathname: string): string =>
  pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;

export const AppBreadcrumbs = () => {
  const { t } = useTranslation([
    'common',
    'sites',
    'backlinks',
    'pages',
    'clientReports',
    'competitorsTraffic',
    'competitors',
    'contentIntelligence',
    'google',
    'appSeo',
    'keywordResearch',
    'alerts',
    'team',
  ]);
  const { pathname, search } = useLocation();
  const sites = useAppSelector(selectSites);
  const parts = pathname.split('/').filter(Boolean);
  const siteId = parts[0] === 'sites' && parts[1] ? parts[1] : '';
  const listedSite = sites.find((s) => s.id === siteId);
  // A site that is not in the loaded list — a later page, an id that does not
  // exist, or a route that never loads the list (the standalone report) — is
  // read directly, so the crumb settles on the name or "Unknown site" instead
  // of staying on "Loading site…", and never falls back to the raw id.
  const lookup = useSiteLookup(siteId, siteId !== '' && !listedSite);
  const lookupSettled = lookup.status === 'found' || lookup.status === 'notFound' || lookup.status === 'error';

  const dashboard: Crumb = { label: t('common:nav.dashboard'), to: '/dashboard' };

  const crumbs = ((): Crumb[] | null => {
    if (siteId) {
      const site = listedSite ?? lookup.site;
      const sitesCrumb: Crumb = { label: t('common:nav.sites'), to: '/sites' };
      if (!site && lookupSettled) {
        // The site does not exist (or is not readable): the page itself is the
        // "site not found" state, so "Unknown site" is the current page and no
        // tab crumb follows it. The raw id is never shown.
        return [dashboard, sitesCrumb, { label: t('common:breadcrumbs.unknownSite') }];
      }
      const siteCrumb: Crumb = site
        ? { label: site.displayName || site.domain, to: `/sites/${siteId}` }
        : { label: t('common:breadcrumbs.loadingSite'), pending: true };
      const trail: Crumb[] = [dashboard, sitesCrumb, siteCrumb];
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
        const subView = getExplicitSubView(tab, search);
        if (subView) {
          // A nested `?view=` is the current page, so the tab crumb becomes
          // the link back to the tab's default view.
          trail.push({
            label: t(getSiteTabLabelKey(tab)),
            to: `/sites/${siteId}?tab=${tab}`,
          });
          trail.push({ label: t(subView.labelKey) });
        } else {
          trail.push({ label: t(getSiteTabLabelKey(tab)) });
        }
      }
      return trail;
    }
    const path = normalizePath(pathname);
    // The Dashboard gets the same trail as every other page, with itself as the
    // only, current crumb.
    if (path === '/dashboard') return [{ label: dashboard.label }];
    const fixed = STATIC_TRAILS[path];
    if (fixed) {
      return [dashboard, ...fixed.map(({ labelKey, to }) => ({ label: t(labelKey), to }))];
    }
    return null;
  })();

  if (!crumbs) return null;

  return (
    <Breadcrumb className="mb-4" aria-label={t('common:breadcrumbs.label')}>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <BreadcrumbItem key={`${crumb.label}-${index}`}>
              {crumb.pending ? (
                <>
                  <Skeleton className="h-4 w-24" aria-hidden="true" />
                  <span className="sr-only" role="status">
                    <Bdi>{crumb.label}</Bdi>
                  </span>
                  <BreadcrumbSeparator className="rtl:rotate-180" />
                </>
              ) : isLast ? (
                <BreadcrumbPage><Bdi>{crumb.label}</Bdi></BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink asChild>
                    {/* Non-last crumbs always carry `to` (only the current page omits it). */}
                    <Link to={crumb.to!}><Bdi>{crumb.label}</Bdi></Link>
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
