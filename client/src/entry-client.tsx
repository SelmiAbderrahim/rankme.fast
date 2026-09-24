import { StrictMode } from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { App } from './App';
import { store } from './app/store';
import { setWorkspaceIdProvider } from '@shared/api/client';
import { selectActiveWorkspaceId } from '@features/workspace';
import { createAppRouter, waitForAppRouterInitialization } from './app/router';
import { LazyRouteFallback } from './app/routes';
import { initI18n } from '@shared/i18n';
import { resolveMarketingRoute } from '@shared/i18n/localePath';
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

const router = createAppRouter();

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
