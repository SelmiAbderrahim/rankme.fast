import type { ReactNode } from 'react';
import { useAppDocumentTitle } from '@shared/hooks/useAppDocumentTitle';
import { AppTitleRegistryContext } from '@shared/navigation/appTitleContext';
import { Bdi } from './Bdi';

/** One title writer and polite navigation announcer per app or auth shell. */
export function AppTitleBoundary({ children }: { children: ReactNode }) {
  const { registry, announcement } = useAppDocumentTitle();
  return <AppTitleRegistryContext.Provider value={registry}>
    {children}
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="route-announcer"><Bdi>{announcement}</Bdi></div>
  </AppTitleRegistryContext.Provider>;
}
