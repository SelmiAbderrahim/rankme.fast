import { useCallback, useEffect, useRef, type RefCallback } from 'react';

/** Expose overflow edges to the shared navigation fade styles. */
export function useScrollFades<T extends HTMLElement>(): RefCallback<T> {
  const cleanup = useRef<(() => void) | null>(null);
  const element = useRef<T | null>(null);
  const ref = useCallback((node: T | null) => {
    element.current = node;
    cleanup.current?.();
    cleanup.current = null;
    if (node === null) return;
    const update = () => {
      node.dataset.fadeTop = String(node.scrollTop > 1);
      node.dataset.fadeBottom = String(node.scrollTop + node.clientHeight < node.scrollHeight - 1);
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    cleanup.current = () => {
      node.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);
  useEffect(() => {
    // Reconnect after effect replay without creating parallel subscriptions.
    if (cleanup.current === null) ref(element.current);
    return () => {
      cleanup.current?.();
      cleanup.current = null;
    };
  }, [ref]);
  return ref;
}
