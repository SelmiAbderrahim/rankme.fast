import { createAction } from '@reduxjs/toolkit';
import {
  getPresentationLocaleSnapshot,
  type PresentationLocaleSnapshot,
  type PresentationRefreshSignal,
} from './presentationLocale';

export interface PresentationRequestIdentity {
  presentationLocale: PresentationLocaleSnapshot['locale'];
  presentationGeneration: number;
}

export const presentationRequestIdentity = (): PresentationRequestIdentity => {
  const snapshot = getPresentationLocaleSnapshot();
  return {
    presentationLocale: snapshot.locale,
    presentationGeneration: snapshot.generation,
  };
};

export const presentationCacheKey = (
  resourceKey: string,
  identity: Pick<PresentationRequestIdentity, 'presentationLocale'>,
): string => `${resourceKey}::${identity.presentationLocale}`;

export const isCurrentPresentationRequest = (
  identity: PresentationRequestIdentity,
): boolean => {
  const current = getPresentationLocaleSnapshot();
  return (
    identity.presentationLocale === current.locale &&
    identity.presentationGeneration === current.generation
  );
};

/** Central store/UI invalidation event emitted for a switch or stale mutation. */
export const presentationLocaleChanged = createAction<PresentationRefreshSignal>(
  'i18n/presentationLocaleChanged',
);
