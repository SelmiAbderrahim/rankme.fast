import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  getPresentationLocaleSnapshot,
  getPresentationRefreshSignal,
  subscribePresentationLocale,
  subscribePresentationRefresh,
  type PresentationLocaleSnapshot,
  type PresentationRefreshSignal,
} from './presentationLocale';

export function usePresentationLocaleSnapshot(): PresentationLocaleSnapshot {
  return useSyncExternalStore(
    subscribePresentationLocale,
    getPresentationLocaleSnapshot,
    getPresentationLocaleSnapshot,
  );
}

export function usePresentationRefreshSignal(): PresentationRefreshSignal {
  return useSyncExternalStore(
    subscribePresentationRefresh,
    getPresentationRefreshSignal,
    getPresentationRefreshSignal,
  );
}

/** Clear component-local presentation copy without remounting its operation state. */
export function useClearOnPresentationRefresh(clear: () => void): void {
  const signal = usePresentationRefreshSignal();
  const previous = useRef(signal.refreshGeneration);
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    if (previous.current === signal.refreshGeneration) return;
    previous.current = signal.refreshGeneration;
    clearRef.current();
  }, [signal.refreshGeneration]);
}
