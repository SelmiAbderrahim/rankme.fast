import { Navigate, type RouteObject } from 'react-router-dom';
import { docsRoute } from '@features/docs';
import { NotFoundRoute } from '@shared/components/NotFoundRoute';
import { PublicLayout } from '@shared/components/PublicLayout';
import { DEFAULT_LOCALE, type SupportedLocale } from '@shared/i18n';
import { authEntryHref, MARKETING_LOCALE_PREFIXES } from '@shared/i18n/localePath';

/**
 * The self-hosted edition ships no marketing site: the root (and each locale
 * root) goes straight to sign-in, which bounces an existing session on to the
 * dashboard. The web server issues the same redirect before any HTML is sent.
 */
const rootRedirect = (locale: SupportedLocale): RouteObject => ({
  index: true,
  element: <Navigate to={authEntryHref('/login', locale)} replace />,
});

/**
 * Real-404 catch-all. The loader throws a 404 Response so the SSR static
 * handler emits an HTTP 404 (not a soft-404 200); errorElement paints the same
 * NotFoundRoute on both the SSR and client data routers. It sits beside — not
 * inside — PublicLayout because NotFoundRoute picks the shell itself: the
 * signed-out public chrome, or the authenticated app shell for a signed-in user.
 */
const notFoundRoute: RouteObject = {
  path: '*',
  loader: () => {
    throw new Response(null, { status: 404 });
  },
  element: <NotFoundRoute />,
  errorElement: <NotFoundRoute />,
};

/**
 * Public, server-rendered pages: the docs plus a real-404 catch-all. Shared
 * by the English (un-prefixed) branch and one branch per non-default locale
 * (/ar, /fr, …). Locale prefixes are literal path segments — never a
 * `:locale` param — so they cannot hijack app routes like /login.
 */
const pages = (locale: SupportedLocale): RouteObject[] => [
  { element: <PublicLayout />, children: [rootRedirect(locale), docsRoute] },
  notFoundRoute,
];

export const publicRoutes: RouteObject[] = [
  ...pages(DEFAULT_LOCALE),
  ...MARKETING_LOCALE_PREFIXES.map((locale) => ({
    path: locale,
    children: pages(locale),
  })),
];
