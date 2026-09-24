import type { LoaderFunctionArgs, RouteObject } from 'react-router-dom';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type SupportedLocale,
} from '@shared/i18n';
import { apiFetch } from '@shared/api/client';
import {
  PublicReportNotFound,
  PublicReportPage,
} from './components/PublicReportPage';
import type { PublicReport, ReportShareLoaderContext } from './types';
import { rootReducer } from '@app/store';
import { RequireVerified } from '@features/auth';
import { reportExportReducer } from './store/slice';

function localeFromPath(pathname: string): SupportedLocale {
  const first = pathname.split('/').filter(Boolean)[0];
  return first && first !== DEFAULT_LOCALE && isSupportedLocale(first)
    ? first
    : DEFAULT_LOCALE;
}

export async function publicReportLoader({
  request,
  params,
  context,
}: LoaderFunctionArgs): Promise<PublicReport> {
  const token = params.token;
  if (!token) throw new Response(null, { status: 404 });
  const url = new URL(request.url);
  const locale = localeFromPath(url.pathname);
  const apiOrigin = (context as ReportShareLoaderContext | undefined)?.apiOrigin;
  const endpoint = new URL(
    `/api/report-shares/${encodeURIComponent(token)}`,
    apiOrigin || url.origin,
  );
  let response: Response;
  try {
    response = await apiFetch(endpoint.toString(), {
      localeMode: 'artifact',
      locale,
      workspace: 'omit',
      headers: { Accept: 'application/json' },
      signal: request.signal,
    });
  } catch {
    throw new Response(null, { status: 502 });
  }
  if (!response.ok) {
    throw new Response(null, { status: response.status === 404 ? 404 : 502 });
  }
  try {
    const payload = await response.json() as { report?: PublicReport };
    if (!payload.report) throw new Error('missing public report');
    return payload.report;
  } catch {
    throw new Response(null, { status: 502 });
  }
}

const route = (path: string): RouteObject => ({
  path,
  loader: publicReportLoader,
  element: <PublicReportPage />,
  errorElement: <PublicReportNotFound />,
});

export const publicReportRoutes: RouteObject[] = [
  route('share/:token'),
  ...SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE).map(
    (locale) => route(`${locale}/share/:token`),
  ),
];

export const authenticatedReportExportRoutes: RouteObject[] = [
  {
    path: 'exports',
    lazy: async () => {
      const { ExportCenterPage } = await import('./components/ExportCenterPage');
      rootReducer.inject({ reducerPath: 'reportExport', reducer: reportExportReducer });
      return {
        element: (
          <RequireVerified>
            <ExportCenterPage />
          </RequireVerified>
        ),
      };
    },
  },
];
