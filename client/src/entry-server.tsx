import { renderToString } from 'react-dom/server';
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from 'react-router-dom/server';
import type { HelmetServerState } from 'react-helmet-async';
import { App } from './App';
import { makeStore } from './app/store';
import { publicRoutes } from './app/publicRoutes';
import { clientPortalRoutes } from '@features/client-reports';
import { publicReportRoutes } from '@features/report-export';
import { createServerI18n } from '@shared/i18n/server';
import { resolveMarketingRoute } from '@shared/i18n/localePath';

export interface RenderResult {
  statusCode: number;
  /** Present when a loader returned a redirect Response. */
  redirect?: string;
  /** Serialized #root inner HTML. */
  appHtml: string;
  /** Serialized <head> tags (title/meta/link/script). */
  headTags: string;
  /** Serialized <html> attributes (lang, dir). */
  htmlAttrs: string;
}

// Public docs and token-scoped client portals are server-rendered; the
// authenticated app stays CSR. Portal routes precede the public catch-all.
const handler = createStaticHandler([
  ...clientPortalRoutes,
  ...publicReportRoutes,
  ...publicRoutes,
]);

/** Render a public URL to HTML for the SSR server. */
export async function render(url: string, requestContext?: unknown): Promise<RenderResult> {
  const fullUrl = new URL(url, 'http://ssr.local');
  const { locale } = resolveMarketingRoute(fullUrl.pathname);

  const context = await handler.query(new Request(fullUrl), { requestContext });

  // A loader may return a redirect/response instead of route context.
  if (context instanceof Response) {
    const location = context.headers.get('Location') ?? '/';
    return {
      statusCode: context.status,
      redirect: location,
      appHtml: '',
      headTags: '',
      htmlAttrs: '',
    };
  }

  const store = makeStore();
  const i18n = createServerI18n(locale);
  const helmetContext: { helmet?: HelmetServerState } = {};
  const router = createStaticRouter(handler.dataRoutes, context);

  const appHtml = renderToString(
    <App store={store} i18n={i18n} helmetContext={helmetContext}>
      <StaticRouterProvider router={router} context={context} />
    </App>,
  );

  const { helmet } = helmetContext;
  const headTags = helmet
    ? helmet.title.toString() +
      helmet.meta.toString() +
      helmet.link.toString() +
      helmet.script.toString() +
      helmet.style.toString() +
      helmet.noscript.toString() +
      helmet.base.toString()
    : '';
  const htmlAttrs = helmet ? helmet.htmlAttributes.toString() : '';

  return {
    statusCode: context.statusCode ?? 200,
    appHtml,
    headTags,
    htmlAttrs,
  };
}
