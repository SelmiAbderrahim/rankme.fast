/**
 * Source deep-link resolvers (the prompt owns "source deep
 * links"). The server's allowlisted `sourceLink` values are stable internal
 * paths (see `server/src/modules/actions/actions.identity.ts` →
 * `INTERNAL_ROUTE_BUILDERS`); these routes resolve each shape onto the
 * shipped SPA surface with a replace-redirect so back/forward never traps
 * the user on the resolver. Pure navigation — no fetch, no spend.
 */
import { Navigate, useParams, type RouteObject } from 'react-router-dom';

const encode = (value: string | undefined): string =>
  encodeURIComponent(value ?? '');

/**
 * Legacy resolver: current audit links target the latest report with a
 * `?finding=` query. Keep old run-scoped links precise too by forwarding the
 * rule while they land on their historical report.
 */
export function AuditFindingSourceRedirect() {
  const params = useParams<{ siteId: string; runId: string; ruleId: string }>();
  return (
    <Navigate
      to={`/sites/${encode(params.siteId)}/report/${encode(params.runId)}?finding=${encode(
        params.ruleId,
      )}`}
      replace
    />
  );
}

export function SiteTabSourceRedirect({ tab }: { tab: string }) {
  const params = useParams<{ siteId: string }>();
  return <Navigate to={`/sites/${encode(params.siteId)}?tab=${tab}`} replace />;
}

export function AudienceSignalSourceRedirect() {
  const params = useParams<{ siteId: string; signalId: string }>();
  return (
    <Navigate
      to={`/sites/${encode(params.siteId)}?tab=audience-research&signal=${encode(
        params.signalId,
      )}`}
      replace
    />
  );
}

export const actionsRoutes: RouteObject[] = [
  {
    path: 'sites/:siteId/audits/:runId/findings/:ruleId',
    element: <AuditFindingSourceRedirect />,
  },
  {
    path: 'sites/:siteId/ranks/drops/:sourceId',
    element: <SiteTabSourceRedirect tab="keywords" />,
  },
  {
    path: 'sites/:siteId/gsc/declines/:sourceId',
    element: <SiteTabSourceRedirect tab="google" />,
  },
  {
    path: 'sites/:siteId/ga4/declines/:sourceId',
    element: <SiteTabSourceRedirect tab="google" />,
  },
  {
    path: 'sites/:siteId/content-intelligence/:analysisId/recommendations/:recommendationId',
    element: <SiteTabSourceRedirect tab="content" />,
  },
  {
    path: 'sites/:siteId/content-intelligence/citation-gaps/:sourceId',
    element: <SiteTabSourceRedirect tab="content" />,
  },
  {
    path: 'sites/:siteId/audience-research/:signalId',
    element: <AudienceSignalSourceRedirect />,
  },
];
