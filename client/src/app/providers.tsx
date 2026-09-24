import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { HelmetProvider } from 'react-helmet-async';
import { DirectionProvider } from '@radix-ui/react-direction';
import type { i18n as I18nType } from 'i18next';
import { useI18nDirection } from '@shared/i18n/useDirection';
import { ThemeProvider } from '@shared/theme/ThemeProvider';
import { TooltipProvider } from '@shared/ui/tooltip';
import { Toaster } from '@shared/ui/sonner';
import type { AppStore } from './store';
import { PrincipalStateBoundary } from './PrincipalStateBoundary';
import { AuthenticatedLocaleBoundary } from './AuthenticatedLocaleBoundary';
import { PresentationLocaleBoundary } from './PresentationLocaleBoundary';

interface ProvidersProps {
  /** Redux store — singleton on the client, per-request on the server. */
  store: AppStore;
  /** i18next instance — singleton on the client, per-request on the server. */
  i18n: I18nType;
  /**
   * Mutable object react-helmet-async fills with the rendered head on the
   * server (read back in entry-server). Omit on the client.
   */
  helmetContext?: object;
  children: ReactNode;
}

/**
 * App-wide providers. Store and i18n are injected (not imported as
 * module singletons) so the same tree renders safely on the server, where
 * each request needs its own store + i18n instance. No side effects at
 * module load — i18n is initialised by the entry point.
 */
export const Providers = ({
  store,
  i18n,
  helmetContext,
  children,
}: ProvidersProps) => {
  const dir = useI18nDirection(i18n);
  return (
    <Provider store={store}>
      <HelmetProvider context={helmetContext}>
        <I18nextProvider i18n={i18n}>
          <DirectionProvider dir={dir}>
            <ThemeProvider>
              <TooltipProvider>
                <PrincipalStateBoundary />
                <PresentationLocaleBoundary store={store} />
                <AuthenticatedLocaleBoundary>
                  {children}
                </AuthenticatedLocaleBoundary>
                <Toaster position="top-right" />
              </TooltipProvider>
            </ThemeProvider>
          </DirectionProvider>
        </I18nextProvider>
      </HelmetProvider>
    </Provider>
  );
};
