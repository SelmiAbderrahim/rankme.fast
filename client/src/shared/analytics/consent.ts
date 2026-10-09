import { useSyncExternalStore } from 'react';

/**
 * Analytics consent. The only persisted state is the visitor's explicit
 * choice; `null` means "not asked yet", which is treated as denied everywhere.
 */
export type AnalyticsChoice = 'granted' | 'denied';

export const ANALYTICS_CONSENT_STORAGE_KEY = 'rmf.analytics.consent';

type Listener = () => void;

const listeners = new Set<Listener>();
// Storage can be blocked (private mode, policy). The choice then lasts for
// this page view only, which is the honest fallback — never an assumed grant.
let memoryChoice: AnalyticsChoice | null = null;

const parse = (value: string | null): AnalyticsChoice | null =>
  value === 'granted' || value === 'denied' ? value : null;

export function readAnalyticsChoice(): AnalyticsChoice | null {
  try {
    return parse(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY));
  } catch {
    return memoryChoice;
  }
}

const emit = (): void => {
  for (const listener of listeners) listener();
};

/** Persist a choice, or clear it (`null`) so the visitor is asked again. */
export function writeAnalyticsChoice(choice: AnalyticsChoice | null): void {
  memoryChoice = choice;
  try {
    if (choice === null) window.localStorage.removeItem(ANALYTICS_CONSENT_STORAGE_KEY);
    else window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, choice);
  } catch {
    // See memoryChoice above.
  }
  emit();
}

export function subscribeAnalyticsChoice(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === ANALYTICS_CONSENT_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** `'unknown'` during SSR/hydration, so server and first client render agree. */
export type AnalyticsChoiceState = AnalyticsChoice | 'unset' | 'unknown';

const snapshot = (): AnalyticsChoiceState => readAnalyticsChoice() ?? 'unset';
const serverSnapshot = (): AnalyticsChoiceState => 'unknown';

export function useAnalyticsChoice(): AnalyticsChoiceState {
  return useSyncExternalStore(subscribeAnalyticsChoice, snapshot, serverSnapshot);
}

/** Test seam: forget the in-memory fallback. */
export function resetAnalyticsChoiceMemory(): void {
  memoryChoice = null;
}
