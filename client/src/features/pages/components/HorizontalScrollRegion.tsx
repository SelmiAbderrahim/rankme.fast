import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

interface HorizontalScrollRegionProps {
  /** Must contain a shared `Table`, whose container is the element that scrolls. */
  children: ReactNode;
  className?: string;
}

interface ScrollEdges {
  start: boolean;
  end: boolean;
}

/**
 * Makes sideways scrolling visible. A wide table clips its last column at the
 * container edge with no hint that more is there (for example "Average position"
 * looking cut off). This wrapper watches the table's own scroll container and
 * shows a soft edge shadow on whichever side still has hidden columns, and
 * flags `data-scrolled` so pinned cells can cast a shadow over what slides
 * beneath them. Edge sides are logical, so right-to-left layouts mirror.
 */
export function HorizontalScrollRegion({ children, className }: HorizontalScrollRegionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

  useEffect(() => {
    const scroller = rootRef.current!.querySelector('[data-slot="table-container"]') as HTMLElement;
    const measure = () => {
      const offset = Math.abs(scroller.scrollLeft);
      const hidden = scroller.scrollWidth - scroller.clientWidth;
      const start = offset > 1;
      const end = hidden - offset > 1;
      setEdges((current) =>
        current.start === start && current.end === end ? current : { start, end });
    };
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    // Columns appearing, a locale change, or a resize change how much overflows.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(scroller.firstElementChild as Element);
    return () => {
      scroller.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn('group/scroll relative min-w-0', className)}
      data-scrolled={edges.start}
      data-more-end={edges.end}
      data-testid="pages-scroll-region"
    >
      {children}
      {edges.end ? (
        <span
          aria-hidden="true"
          data-testid="pages-scroll-shadow-end"
          className="pointer-events-none absolute inset-y-0 end-0 w-3 ltr:shadow-[inset_-10px_0_8px_-8px_color-mix(in_oklab,var(--foreground)_30%,transparent)] rtl:shadow-[inset_10px_0_8px_-8px_color-mix(in_oklab,var(--foreground)_30%,transparent)]"
        />
      ) : null}
    </div>
  );
}
