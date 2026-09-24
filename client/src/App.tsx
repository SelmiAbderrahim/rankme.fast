import type { ReactNode } from 'react';
import type { i18n as I18nType } from 'i18next';
import { Providers } from './app/providers';
import type { AppStore } from './app/store';

interface AppProps {
  store: AppStore;
  i18n: I18nType;
  /** Server-only: react-helmet-async collector. */
  helmetContext?: object;
  /** The router element — RouterProvider (client) or StaticRouterProvider (server). */
  children: ReactNode;
}

/**
 * Root shell. Store, i18n, and the router element are injected by the entry
 * point (client or server) so the same tree renders in both environments.
 */
export const App = ({ store, i18n, helmetContext, children }: AppProps) => (
  <Providers store={store} i18n={i18n} helmetContext={helmetContext}>
    {children}
  </Providers>
);
