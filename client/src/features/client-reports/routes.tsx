import type { LoaderFunctionArgs, RouteObject } from 'react-router-dom';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type SupportedLocale,
} from '@shared/i18n';
import { apiFetch } from '@shared/api/client';
import { ClientPortalNotFound, ClientPortalPage } from './components/ClientPortalPage';
import type { ClientPortalReport, PortalLoaderContext } from './types';

function localeFromPath(pathname: string): SupportedLocale {
  const first = pathname.split('/').filter(Boolean)[0];
  return first && first !== DEFAULT_LOCALE && isSupportedLocale(first)
    ? first
    : DEFAULT_LOCALE;
}

export async function clientPortalLoader({
  request,
  params,
  context,
}: LoaderFunctionArgs): Promise<ClientPortalReport> {
  const token = params.token;
  if (!token) throw new Response(null, { status: 404 });
  const url = new URL(request.url);
  const locale = localeFromPath(url.pathname);
  const apiOrigin = (context as PortalLoaderContext | undefined)?.apiOrigin;
  const endpoint = new URL(
    `/api/client-portal/${encodeURIComponent(token)}?locale=${locale}`,
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
    return await response.json() as ClientPortalReport;
  } catch {
    throw new Response(null, { status: 502 });
  }
}

const route = (path: string): RouteObject => ({
  path,
  loader: clientPortalLoader,
  element: <ClientPortalPage />,
  errorElement: <ClientPortalNotFound />,
});

export const clientPortalRoutes: RouteObject[] = [
  route('portal/:token'),
  ...SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE).map((locale) =>
    route(`${locale}/portal/:token`)),
];
