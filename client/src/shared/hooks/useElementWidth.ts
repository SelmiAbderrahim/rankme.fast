import { useCallback, useEffect, useRef, useState } from 'react';

/** Measure CSS pixels for charts, using the fallback while layout has no width. */
export function useElementWidth<T extends Element>(
  fallback: number,
): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const element = useRef<T | null>(null);
  const ref = useCallback(
    (node: T | null) => {
      element.current = node;
      observer.current?.disconnect();
      observer.current = null;
      if (node === null) return;
      const measure = () => {
        const measured = Math.round(node.getBoundingClientRect().width);
        setWidth(measured > 0 ? measured : fallback);
      };
      measure();
      observer.current = new ResizeObserver(measure);
      observer.current.observe(node);
    },
    [fallback],
  );
  useEffect(() => {
    // Effect replay cleans subscriptions while retaining the attached node.
    if (observer.current === null) ref(element.current);
    return () => {
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [ref]);
  return [ref, width];
}
