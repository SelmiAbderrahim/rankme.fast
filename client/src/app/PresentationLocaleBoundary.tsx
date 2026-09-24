import { useEffect } from 'react';
import { toast } from 'sonner';
import type { AppStore } from './store';
import { presentationLocaleChanged } from '@shared/i18n/requestIdentity';
import { subscribePresentationRefresh } from '@shared/i18n/presentationLocale';
import { brandManifestPath } from '@shared/brand';

export interface PresentationLocaleBoundaryProps {
  store: AppStore;
}

/**
 * Bridges the framework-neutral locale signal into Redux and transient UI.
 * It never remounts children, so an accepted stream or mutation keeps running.
 */
export function PresentationLocaleBoundary({
  store,
}: PresentationLocaleBoundaryProps) {
  useEffect(
    () =>
      subscribePresentationRefresh((signal) => {
        document
          .querySelector<HTMLLinkElement>('link[rel="manifest"]')
          ?.setAttribute('href', brandManifestPath(signal.locale));
        toast.dismiss();
        store.dispatch(presentationLocaleChanged(signal));
      }),
    [store],
  );
  return null;
}
