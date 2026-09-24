import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type SupportedLocale,
} from './locales';

export interface PresentationLocaleSnapshot {
  locale: SupportedLocale;
  generation: number;
}

export type PresentationLocaleListener = (
  snapshot: PresentationLocaleSnapshot,
) => void;

export interface PresentationRefreshSignal extends PresentationLocaleSnapshot {
  refreshGeneration: number;
  reason: 'language-changed' | 'stale-mutation';
}

export type PresentationRefreshListener = (
  signal: PresentationRefreshSignal,
) => void;

let currentSnapshot: PresentationLocaleSnapshot = {
  locale: DEFAULT_LOCALE,
  generation: 0,
};
let refreshGeneration = 0;
let currentRefreshSignal: PresentationRefreshSignal = {
  ...currentSnapshot,
  refreshGeneration,
  reason: 'language-changed',
};
const localeListeners = new Set<PresentationLocaleListener>();
const refreshListeners = new Set<PresentationRefreshListener>();

export function getPresentationLocale(): SupportedLocale {
  return currentSnapshot.locale;
}

export function getPresentationLocaleSnapshot(): PresentationLocaleSnapshot {
  return currentSnapshot;
}

export function isCurrentPresentationSnapshot(
  snapshot: PresentationLocaleSnapshot,
): boolean {
  return (
    snapshot.locale === currentSnapshot.locale &&
    snapshot.generation === currentSnapshot.generation
  );
}

export function subscribePresentationLocale(
  listener: PresentationLocaleListener,
): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function subscribePresentationRefresh(
  listener: PresentationRefreshListener,
): () => void {
  refreshListeners.add(listener);
  return () => refreshListeners.delete(listener);
}

export function getPresentationRefreshSignal(): PresentationRefreshSignal {
  return currentRefreshSignal;
}

const emitRefresh = (
  reason: PresentationRefreshSignal['reason'],
): PresentationRefreshSignal => {
  currentRefreshSignal = {
    ...currentSnapshot,
    refreshGeneration: ++refreshGeneration,
    reason,
  };
  for (const listener of refreshListeners) listener(currentRefreshSignal);
  return currentRefreshSignal;
};

export function setPresentationLocale(
  locale: SupportedLocale,
): PresentationLocaleSnapshot {
  if (!isSupportedLocale(locale) || locale === currentSnapshot.locale) {
    return currentSnapshot;
  }
  currentSnapshot = {
    locale,
    generation: currentSnapshot.generation + 1,
  };
  for (const listener of localeListeners) listener(currentSnapshot);
  emitRefresh('language-changed');
  return currentSnapshot;
}

export function requestPresentationRefresh(): PresentationRefreshSignal {
  return emitRefresh('stale-mutation');
}

/** Test-only reset for module-scoped locale/request identity. */
export function __resetPresentationLocaleForTests(
  locale: SupportedLocale = DEFAULT_LOCALE,
): void {
  currentSnapshot = { locale, generation: 0 };
  refreshGeneration = 0;
  currentRefreshSignal = {
    ...currentSnapshot,
    refreshGeneration,
    reason: 'language-changed',
  };
  refreshListeners.clear();
}
