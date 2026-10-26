import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Table, TableBody, TableCell, TableRow } from '@shared/ui/table';
import { HorizontalScrollRegion } from './HorizontalScrollRegion';

type ObserverCallback = () => void;
const observers: Array<{ callback: ObserverCallback; observed: Element[]; disconnect: Mock<() => void> }> = [];
const originalObserver = globalThis.ResizeObserver;

beforeEach(() => {
  observers.length = 0;
  globalThis.ResizeObserver = class {
    private readonly entry: (typeof observers)[number];
    constructor(callback: ObserverCallback) {
      this.entry = { callback, observed: [], disconnect: vi.fn<() => void>() };
      observers.push(this.entry);
    }
    observe(element: Element) { this.entry.observed.push(element); }
    unobserve() {}
    disconnect() { this.entry.disconnect(); }
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalObserver;
});

const geometry = (element: HTMLElement, values: { scrollWidth: number; clientWidth: number; scrollLeft: number }) => {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(element, key, { configurable: true, writable: true, value });
  }
};

const renderRegion = () => {
  const view = render(
    <HorizontalScrollRegion className="extra">
      <Table><TableBody><TableRow><TableCell>cell</TableCell></TableRow></TableBody></Table>
    </HorizontalScrollRegion>,
  );
  const scroller = view.container.querySelector('[data-slot="table-container"]') as HTMLElement;
  return { ...view, scroller };
};

describe('HorizontalScrollRegion', () => {
  it('shows no edge shadow when the table fits', () => {
    renderRegion();
    const region = screen.getByTestId('pages-scroll-region');
    expect(region).toHaveClass('extra');
    expect(region).toHaveAttribute('data-more-end', 'false');
    expect(region).toHaveAttribute('data-scrolled', 'false');
    expect(screen.queryByTestId('pages-scroll-shadow-end')).toBeNull();
  });

  it('shows the end shadow while columns are hidden past the edge and flags a scrolled table', () => {
    const { scroller } = renderRegion();
    geometry(scroller, { scrollWidth: 1200, clientWidth: 800, scrollLeft: 0 });
    act(() => { scroller.dispatchEvent(new Event('scroll')); });
    expect(screen.getByTestId('pages-scroll-shadow-end')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('pages-scroll-region')).toHaveAttribute('data-more-end', 'true');
    expect(screen.getByTestId('pages-scroll-region')).toHaveAttribute('data-scrolled', 'false');

    // Part-way: more on both sides.
    geometry(scroller, { scrollWidth: 1200, clientWidth: 800, scrollLeft: 120 });
    act(() => { scroller.dispatchEvent(new Event('scroll')); });
    expect(screen.getByTestId('pages-scroll-region')).toHaveAttribute('data-scrolled', 'true');
    expect(screen.getByTestId('pages-scroll-shadow-end')).toBeInTheDocument();

    // At the far end the shadow goes away; right-to-left scroll offsets are negative.
    geometry(scroller, { scrollWidth: 1200, clientWidth: 800, scrollLeft: -400 });
    act(() => { scroller.dispatchEvent(new Event('scroll')); });
    expect(screen.queryByTestId('pages-scroll-shadow-end')).toBeNull();
    expect(screen.getByTestId('pages-scroll-region')).toHaveAttribute('data-scrolled', 'true');
  });

  it('re-measures when the table or its container is resized, and cleans up', () => {
    const { scroller, unmount } = renderRegion();
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observed).toEqual([scroller, scroller.firstElementChild]);
    geometry(scroller, { scrollWidth: 1000, clientWidth: 600, scrollLeft: 0 });
    act(() => { observers[0]!.callback(); });
    expect(screen.getByTestId('pages-scroll-shadow-end')).toBeInTheDocument();

    // A resize that changes nothing keeps the same edges (no extra render).
    act(() => { observers[0]!.callback(); });
    expect(screen.getByTestId('pages-scroll-shadow-end')).toBeInTheDocument();

    const removeListener = vi.spyOn(scroller, 'removeEventListener');
    unmount();
    expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
