import { StrictMode } from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { App } from './App';
import { store } from './app/store';
import { setWorkspaceIdProvider } from '@shared/api/client';
import { retainAuthSession } from '@features/auth';
import { selectActiveWorkspaceId } from '@features/workspace';
import { createAppRouter, waitForAppRouterInitialization } from './app/router';
import { LazyRouteFallback } from './app/routes';
import { initI18n } from '@shared/i18n';
import { resolveMarketingRoute } from '@shared/i18n/localePath';
import { reloadOnceForStaleChunk } from '@shared/lib/chunkReload';
import { startAnalyticsPageTracking } from '@shared/analytics';
// Self-hosted fonts (bundled locally by Vite — no external CDN request).
// JetBrains Mono covers code blocks; Inter is served from static font faces.
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles/tailwind.css';

declare global {
  interface Window {
    /** Set by the SSR shell so we hydrate instead of client-rendering. */
    __SSR__?: boolean;
  }
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root not found in index.html');
}

// Server-rendered public pages must hydrate in the locale the server used:
// URL-derived for all public paths, including un-prefixed English routes.
const ssrLocale = window.__SSR__
  ? resolveMarketingRoute(window.location.pathname).locale
  : undefined;
const i18n = initI18n(ssrLocale ? { initialLocale: ssrLocale } : {});

// Wire the workspace header once, at the single fetch choke point
//. Reading the store lazily per request means a
// switch takes effect without re-registering anything, and returns null in the
// ordinary single-workspace case so no header is sent at all.
setWorkspaceIdProvider(() => selectActiveWorkspaceId(store.getState()));

// Vite fires `vite:preloadError` when a hashed chunk from the build this tab
// loaded is gone after a deploy. Reload once to pick up the new build; the
// route error boundary covers the case the guard refuses.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForStaleChunk()) event.preventDefault();
});

// One permanent session subscription + throttled tab-return refresh instead of
// a get-session fetch on every route-guard remount and every focus.
retainAuthSession();

const router = createAppRouter();

// Google Analytics stays unloaded until the visitor opts in; this only wires the
// consent + route listeners (a no-op when the build has no VITE_GA_ID).
startAnalyticsPageTracking(router);

const renderApp = async () => {
  if (ssrLocale) {
    await Promise.all([i18n.loadLanguages(ssrLocale), waitForAppRouterInitialization(router)]);
  }

  const tree = (
    <StrictMode>
      <App store={store} i18n={i18n}>
        <RouterProvider router={router} fallbackElement={<LazyRouteFallback />} />
      </App>
    </StrictMode>
  );

  if (window.__SSR__) {
    hydrateRoot(container, tree);
  } else {
    createRoot(container).render(tree);
  }
};

void renderApp();
