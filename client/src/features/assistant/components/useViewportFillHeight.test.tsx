import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewportFillHeight, type ViewportFillOptions } from './useViewportFillHeight';

const observers: Array<{ callback: () => void; observed: Element[]; disconnect: () => void }> = [];

class RecordingResizeObserver {
  callback: () => void;
  observed: Element[] = [];
  disconnect = vi.fn();
  constructor(callback: () => void) {
    this.callback = callback;
    observers.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve() {}
}

function Probe({ attach = true, options }: { attach?: boolean; options?: ViewportFillOptions }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const height = useViewportFillHeight(node, options);
  return (
    <div data-testid="outer">
      <div data-testid="scroller">
        <div data-testid="section" style={{ paddingBottom: '24px' }}>
          <div ref={attach ? setNode : undefined} data-testid="target">
            {height === null ? 'unmeasured' : String(height)}
          </div>
        </div>
        <footer data-testid="footer" />
        <div data-testid="gone" style={{ display: 'none' }} />
        <div data-testid="floating" style={{ position: 'absolute' }} />
      </div>
    </div>
  );
}

const originalInnerHeight = window.innerHeight;

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 950 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
});

describe('useViewportFillHeight — the document scrolls (phones)', () => {
  it('stays unmeasured until a node is attached', () => {
    render(<Probe attach={false} />);
    expect(screen.getByTestId('target')).toHaveTextContent('unmeasured');
    expect(observers).toHaveLength(0);
  });

  it('fills the viewport below the node, ignoring ancestor scroll, and re-measures', () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: 300 } as DOMRect);
    const view = render(<Probe />);
    const target = screen.getByTestId('target');
    // 950 viewport - 300 top - 8 default gap.
    expect(target).toHaveTextContent('642');

    // Scrolling an ancestor moves the viewport rect up by the same amount,
    // so the document-space offset (and the height) is unchanged.
    Object.defineProperty(screen.getByTestId('outer'), 'scrollTop', { configurable: true, value: 120 });
    rect.mockReturnValue({ top: 180 } as DOMRect);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(target).toHaveTextContent('642');

    // An ancestor resize (e.g. a dismissed banner) re-measures.
    rect.mockReturnValue({ top: 140 } as DOMRect);
    const observer = observers.at(-1)!;
    expect(observer.observed).toContain(screen.getByTestId('outer'));
    act(() => observer.callback());
    expect(target).toHaveTextContent('682');

    // Never below the minimum, even on a very short window.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(target).toHaveTextContent('0');

    view.unmount();
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it('honours a custom bottom gap and a minimum height', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 50 } as DOMRect);
    const view = render(<Probe options={{ bottomGap: 0 }} />);
    expect(screen.getByTestId('target')).toHaveTextContent('900');
    view.unmount();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    render(<Probe options={{ minHeight: 320 }} />);
    expect(screen.getByTestId('target')).toHaveTextContent('320');
  });

  it('follows the visual viewport, so an on-screen keyboard shrinks the node (QA 02)', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 200 } as DOMRect);
    const listeners = new Map<string, () => void>();
    const visualViewport = {
      height: 667,
      addEventListener: (type: string, cb: () => void) => listeners.set(type, cb),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
    const view = render(<Probe />);
    expect(screen.getByTestId('target')).toHaveTextContent('459');
    visualViewport.height = 350;
    act(() => listeners.get('resize')!());
    expect(screen.getByTestId('target')).toHaveTextContent('142');
    view.unmount();
    expect(visualViewport.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});

describe('useViewportFillHeight — a scrolling app column (desktop, QA 02)', () => {
  it('ends where the column ends, reserving its padding and footer so the column has nothing left to scroll', () => {
    const rects = new Map<string, { top?: number; bottom?: number; height?: number }>([
      ['target', { top: 260 }],
      ['scroller', { bottom: 900 }],
      ['footer', { height: 56 }],
    ]);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (rects.get(this.dataset.testid ?? '') ?? {}) as DOMRect;
    });
    const original = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
      const style = original(element);
      return (element as HTMLElement).dataset.testid === 'scroller'
        ? ({ ...style, overflowY: 'auto', paddingBottom: '0px', borderBottomWidth: '0px', display: 'block', position: 'static' } as CSSStyleDeclaration)
        : style;
    });
    render(<Probe />);
    // 900 column bottom - 260 top - (24 section padding + 56 footer).
    expect(screen.getByTestId('target')).toHaveTextContent('560');
  });
});
