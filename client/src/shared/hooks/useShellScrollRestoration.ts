import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export const SCROLL_RESTORE_WINDOW_MS = 1500;
interface SavedPosition {
  inner: number;
  outer: number;
}
const INPUT_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
const scrollWindow = (top: number): void => {
  if (typeof window.scrollTo === 'function') window.scrollTo(0, top);
};

function settle(attempt: () => boolean): () => void {
  if (attempt()) return () => undefined;
  const deadline = Date.now() + SCROLL_RESTORE_WINDOW_MS;
  let frame = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    for (const event of INPUT_EVENTS) window.removeEventListener(event, stop);
  };
  for (const event of INPUT_EVENTS) window.addEventListener(event, stop, { passive: true });
  const tick = () => {
    if (stopped) return;
    if (attempt() || Date.now() > deadline) {
      stop();
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return stop;
}

function restore(scroller: HTMLElement | null, target: SavedPosition): boolean {
  if (scroller) scroller.scrollTop = target.inner;
  scrollWindow(target.outer);
  return (
    (!scroller || Math.abs(scroller.scrollTop - target.inner) <= 1) &&
    Math.abs(window.scrollY - target.outer) <= 1
  );
}

function anchor(hash: string): boolean {
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    id = hash.slice(1);
  }
  const node = document.getElementById(id);
  if (node === null) return false;
  node.scrollIntoView({ block: 'start' });
  return true;
}

/** One restoration authority for the app's inner scroller and phone window. */
export function useShellScrollRestoration(getScroller: () => HTMLElement | null): void {
  const location = useLocation();
  const navigation = useNavigationType();
  const saved = useRef(new Map<string, SavedPosition>());
  const key = useRef(location.key);
  const previous = useRef<{ pathname: string; hash: string } | null>(null);
  const latest = useRef(getScroller);
  latest.current = getScroller;
  useEffect(() => {
    const before = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = before;
    };
  }, []);
  useEffect(() => {
    const scroller = latest.current();
    const record = () =>
      saved.current.set(key.current, { inner: scroller?.scrollTop ?? 0, outer: window.scrollY });
    scroller?.addEventListener('scroll', record, { passive: true });
    window.addEventListener('scroll', record, { passive: true });
    return () => {
      scroller?.removeEventListener('scroll', record);
      window.removeEventListener('scroll', record);
    };
  }, []);
  useLayoutEffect(() => {
    const scroller = latest.current();
    const before = previous.current;
    previous.current = { pathname: location.pathname, hash: location.hash };
    key.current = location.key;
    const pathChanged = before !== null && before.pathname !== location.pathname;
    const hashChanged = before === null || pathChanged || before.hash !== location.hash;
    if (navigation === 'POP' && before !== null) {
      const target = saved.current.get(location.key);
      return target ? settle(() => restore(scroller, target)) : undefined;
    }
    if (!pathChanged && !hashChanged) {
      // A query-only entry inherits the current position even without a new scroll event.
      saved.current.set(location.key, { inner: scroller?.scrollTop ?? 0, outer: window.scrollY });
    }
    if (location.hash && hashChanged) return settle(() => anchor(location.hash));
    if (pathChanged) {
      if (scroller) scroller.scrollTop = 0;
      scrollWindow(0);
    }
    return undefined;
    // A history entry triggers navigation; read the scroller and location fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}
