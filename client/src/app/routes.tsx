import { Link, type RouteObject } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@shared/components/AppLayout';
import { MinimalLayout } from '@shared/components/MinimalLayout';
import { NotFound } from '@shared/components/NotFound';
import { Bug } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { buildBugReportHref } from '@shared/feedback/bugReport';
import { useRoutePattern } from '@shared/feedback/useRoutePattern';
import { Skeleton } from '@shared/ui/skeleton';
import { authRoutes } from '@features/auth';
import { accountRoutes } from '@features/account/routes';
import { actionsRoutes } from '@features/actions/routes';
import { aiVisibilityRoutes } from '@features/ai-visibility/routes';
import { assistantRoutes } from '@features/assistant/routes';
import { backlinksRoutes } from '@features/backlinks/routes';
import { alertsRoutes } from '@features/alerts/routes';
import { competitorsRoutes } from '@features/competitors/routes';
import { trafficRoutes } from '@features/competitors/traffic/routes';
import { contentIntelligenceRoutes } from '@features/content-intelligence/routes';
import { contentBriefRoutes } from '@features/content-briefs/routes';
import { dashboardRoutes } from '@features/dashboard';
import { googleRoutes } from '@features/google';
import { keywordResearchRoutes } from '@features/keyword-research/routes';
import { localSeoRoutes } from '@features/local-seo/routes';
import { reportRoutes } from '@features/report/routes';
import { settingsRoutes } from '@features/settings/routes';
import { sitesRoutes } from '@features/sites';
import { teamActionRoutes, teamRoutes } from '@features/team/routes';
import { RequirePasswordCurrent } from '@features/auth';
import { clientPortalRoutes } from '@features/client-reports';
import { authenticatedReportExportRoutes, publicReportRoutes } from '@features/report-export';
import { publicRoutes } from './publicRoutes';

// Guest / pre-auth screens render without the app sidebar; every other auth
// route (e.g. settings/security) belongs inside the authenticated shell.
const GUEST_AUTH_PATHS = new Set([
  'login',
  'register',
  'forgot-password',
  'reset-password',
  'verify-email',
  'two-factor',
  'logout',
]);
const guestAuthRoutes = authRoutes.filter(
  (route) => route.path !== undefined && GUEST_AUTH_PATHS.has(route.path),
);
const shellAuthRoutes = authRoutes.filter(
  (route) => route.path === undefined || !GUEST_AUTH_PATHS.has(route.path),
);

export function LazyRouteFallback() {
  const { t } = useTranslation('common');
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-6" aria-busy="true">
      <p className="text-sm text-muted-foreground">{t('dashboard.loading')}</p>
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-2/3" />
    </main>
  );
}

export function RouteErrorBoundary() {
  const { t } = useTranslation(['common', 'errors']);
  const routePattern = useRoutePattern();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-3 p-6" role="alert">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('common:notFound.title')}
      </h1>
      <p className="text-muted-foreground">{t('errors:internal')}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild><Link to="/dashboard">{t('common:notFound.backToDashboard')}</Link></Button>
        <Button variant="secondary" asChild>
          <a href={buildBugReportHref({ routePattern })} target="_blank" rel="noopener noreferrer">
            <Bug aria-hidden="true" />{t('common:feedback.reportProblem')}
          </a>
        </Button>
      </div>
    </main>
  );
}

/**
 * Authenticated SPA shell (sidebar + framed main). A pathless parent so its
 * children resolve to absolute paths (/dashboard, …). Rendered client-side only.
 */
export const appShellRoutes: RouteObject[] = [
  {
    element: <MinimalLayout />,
    children: [...guestAuthRoutes, ...teamActionRoutes],
  },
  {
    element: (
      <RequirePasswordCurrent>
        <AppLayout />
      </RequirePasswordCurrent>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      ...shellAuthRoutes,
      ...accountRoutes,
      ...dashboardRoutes,
      ...assistantRoutes,
      ...sitesRoutes,
      ...keywordResearchRoutes,
      ...aiVisibilityRoutes,
      ...alertsRoutes,
      ...localSeoRoutes,
      ...backlinksRoutes,
      ...competitorsRoutes,
      ...trafficRoutes,
      ...contentIntelligenceRoutes,
      ...contentBriefRoutes,
      ...reportRoutes,
      ...actionsRoutes,
      ...googleRoutes,
      ...teamRoutes,
      ...settingsRoutes,
      ...authenticatedReportExportRoutes,
      // Authed-shell catch-all: an unmatched path inside the app renders the
      // shared NotFound (with a working "back to dashboard" link) rather than a
      // blank frame. The public catch-all (with its 404 loader) owns SSR and
      // guest paths; this keeps the shared component reachable in every tree.
      { path: '*', element: <NotFound /> },
    ],
  },
];

/**
 * Full route tree. Public routes come first (server-rendered docs + root
 * redirect); the app shell follows (client-rendered, authenticated). Consumed by both
 * the browser router (entry-client) and the static handler (entry-server).
 */
export const routes: RouteObject[] = [
  ...clientPortalRoutes,
  ...publicReportRoutes,
  ...publicRoutes,
  ...appShellRoutes,
];
