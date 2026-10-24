import { useCallback, useEffect, useRef, type RefObject } from 'react';

export interface RevealOnReady<T extends HTMLElement> {
  /** Give the region tabIndex={-1} so it can receive focus. */
  ref: RefObject<T>;
  arm: () => void;
}

/** Reveal one fresh result requested by the user; background updates stay put. */
export function useRevealOnReady<T extends HTMLElement = HTMLDivElement>(
  result: unknown,
): RevealOnReady<T> {
  const ref = useRef<T>(null);
  const latest = useRef(result);
  latest.current = result;
  const armed = useRef(false);
  const previous = useRef<unknown>(undefined);
  const arm = useCallback(() => {
    armed.current = true;
    previous.current = latest.current;
  }, []);
  useEffect(() => {
    if (!armed.current || !result || result === previous.current) return;
    armed.current = false;
    const node = ref.current;
    if (node === null) return;
    node.scrollIntoView({ block: 'nearest' });
    node.focus({ preventScroll: true });
  }, [result]);
  return { ref, arm };
}
