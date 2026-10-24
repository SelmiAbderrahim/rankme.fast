import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';
import { useIsMobile } from './use-mobile';
import { useElementWidth } from './useElementWidth';
import { returnFocusTo, useOverlayDismiss } from './useOverlayDismiss';
import { useScrollFades } from './useScrollFades';
import { useRevealOnReady } from './useRevealOnReady';

let resize: ResizeObserverCallback;
const disconnect = vi.fn();
const observe = vi.fn();
function trackResizes() {
  const active = new Set<ResizeObserverCallback>();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        active.add(this.callback);
      }
      disconnect() {
        active.delete(this.callback);
      }
    },
  );
  return {
    active,
    emit: () => act(() => active.forEach((callback) => callback([], {} as ResizeObserver))),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  disconnect.mockClear();
  observe.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('media query subscriptions', () => {
  it('reads synchronously, updates when the query changes, and unsubscribes', () => {
    const small = new EventTarget();
    const large = new EventTarget();
    const smallList = Object.assign(small, { matches: true });
    const largeList = Object.assign(large, { matches: false });
    const remove = vi.spyOn(smallList, 'removeEventListener');
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => (q === '(max-width: 767px)' ? smallList : largeList)),
    );
    const mobile = renderHook(() => useIsMobile());
    expect(mobile.result.current).toBe(true);
    const hook = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: '(max-width: 767px)' },
    });
    expect(hook.result.current).toBe(true);
    act(() => {
      smallList.matches = false;
      small.dispatchEvent(new Event('change'));
    });
    expect(mobile.result.current).toBe(false);
    expect(hook.result.current).toBe(false);
    hook.rerender({ query: '(min-width: 1000px)' });
    act(() => {
      largeList.matches = true;
      large.dispatchEvent(new Event('change'));
    });
    expect(hook.result.current).toBe(true);
    hook.unmount();
    mobile.unmount();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('returns a stable false server snapshot', () => {
    function Probe() {
      return <span>{String(useMediaQuery('(min-width: 0px)'))}</span>;
    }
    expect(renderToString(<Probe />)).toBe('<span>false</span>');
  });
});

describe('element width measurement', () => {
  it('keeps observing measurements through StrictMode effect replay', () => {
    const { active, emit } = trackResizes();
    let measured = 200;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: measured }) as DOMRect,
    );
    function Probe() {
      const [ref, width] = useElementWidth<HTMLDivElement>(100);
      return <div ref={ref}>{width}</div>;
    }
    const view = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(view.getByText('200')).toBeInTheDocument();
    measured = 400;
    emit();
    expect(view.getByText('400')).toBeInTheDocument();
    view.unmount();
    expect(active.size).toBe(0);
  });

  it('rounds actual width, falls back for empty layout, and disconnects replaced nodes', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');
    const bounds = vi
      .spyOn(first, 'getBoundingClientRect')
      .mockReturnValue({ width: 300.6 } as DOMRect);
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ width: 480 } as DOMRect);
    const hook = renderHook(({ fallback }) => useElementWidth<HTMLDivElement>(fallback), {
      initialProps: { fallback: 100 },
    });
    expect(hook.result.current[1]).toBe(100);
    act(() => hook.result.current[0](first));
    expect(hook.result.current[1]).toBe(301);
    bounds.mockReturnValue({ width: 0 } as DOMRect);
    act(() => resize([], {} as ResizeObserver));
    expect(hook.result.current[1]).toBe(100);
    act(() => hook.result.current[0](second));
    expect(hook.result.current[1]).toBe(480);
    expect(disconnect).toHaveBeenCalledTimes(1);
    act(() => hook.result.current[0](null));
    expect(disconnect).toHaveBeenCalledTimes(2);
    hook.rerender({ fallback: 120 });
    act(() => hook.result.current[0](first));
    expect(hook.result.current[1]).toBe(120);
    hook.unmount();
    expect(disconnect).toHaveBeenCalledTimes(3);
    expect(observe).toHaveBeenCalledWith(first);
  });
});

describe('overlay dismissal', () => {
  it('dismisses outside presses and Escape, respecting active state, portals and prevented keys', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const root = document.createElement('aside');
    const child = document.createElement('button');
    root.append(child);
    document.body.append(root);
    const hook = renderHook(
      ({ active, onDismiss }) => useOverlayDismiss(active, () => root, onDismiss),
      { initialProps: { active: false, onDismiss: first } },
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    hook.rerender({ active: true, onDismiss: first });
    fireEvent.keyDown(document, { key: 'Enter' });
    const prevented = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    prevented.preventDefault();
    document.dispatchEvent(prevented);
    fireEvent.pointerDown(child);
    fireEvent.pointerDown(document);
    const portal = document.createElement('div');
    portal.setAttribute('data-radix-popper-content-wrapper', '');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    portal.append(menu);
    document.body.append(portal);
    fireEvent.pointerDown(menu);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    portal.remove();
    for (const role of ['dialog', 'alertdialog']) {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', role);
      document.body.append(dialog);
      fireEvent.pointerDown(dialog);
      dialog.remove();
    }
    hook.rerender({ active: true, onDismiss: latest });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(latest.mock.calls).toEqual([['escape'], ['outside']]);
    hook.unmount();
    fireEvent.pointerDown(document.body);
    expect(latest).toHaveBeenCalledTimes(2);
    root.remove();
    const missing = renderHook(() => useOverlayDismiss(true, () => null, first));
    fireEvent.pointerDown(document.body);
    expect(first).toHaveBeenCalledWith('outside');
    missing.unmount();
  });

  it('returns focus after the opener is rendered and tolerates a missing opener', () => {
    vi.useFakeTimers();
    const button = document.createElement('button');
    document.body.append(button);
    returnFocusTo(() => button);
    expect(document.activeElement).not.toBe(button);
    act(() => vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(button);
    returnFocusTo(() => null);
    act(() => vi.advanceTimersByTime(20));
    button.remove();
  });
});

describe('scroll fades', () => {
  it('keeps scroll listeners and resize observation through StrictMode effect replay', () => {
    const { active, emit } = trackResizes();
    function Probe() {
      const ref = useScrollFades<HTMLDivElement>();
      return (
        <div ref={ref} data-testid="fades">
          <div />
        </div>
      );
    }
    const view = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    const node = view.getByTestId('fades');
    Object.defineProperties(node, {
      clientHeight: { value: 100 },
      scrollHeight: { configurable: true, value: 200 },
    });
    emit();
    expect(node.dataset.fadeBottom).toBe('true');
    node.scrollTop = 20;
    fireEvent.scroll(node);
    expect(node.dataset.fadeTop).toBe('true');
    expect(node.dataset.fadeBottom).toBe('true');
    Object.defineProperty(node, 'scrollHeight', { value: 100 });
    emit();
    expect(node.dataset.fadeBottom).toBe('false');
    view.unmount();
    expect(active.size).toBe(0);
    node.scrollTop = 0;
    fireEvent.scroll(node);
    expect(node.dataset.fadeTop).toBe('true');
  });

  it('tracks scroll and resize boundaries and cleans up when the node changes', () => {
    const node = document.createElement('div');
    const content = document.createElement('div');
    node.append(content);
    Object.defineProperties(node, {
      clientHeight: { value: 100 },
      scrollHeight: { configurable: true, value: 200 },
    });
    const hook = renderHook(() => useScrollFades<HTMLDivElement>());
    act(() => hook.result.current(node));
    expect(node.dataset).toMatchObject({ fadeTop: 'false', fadeBottom: 'true' });
    expect(observe.mock.calls).toEqual([[node], [content]]);
    node.scrollTop = 1;
    fireEvent.scroll(node);
    expect(node.dataset.fadeTop).toBe('false');
    node.scrollTop = 99;
    fireEvent.scroll(node);
    expect(node.dataset).toMatchObject({ fadeTop: 'true', fadeBottom: 'false' });
    Object.defineProperty(node, 'scrollHeight', { value: 300 });
    act(() => resize([], {} as ResizeObserver));
    expect(node.dataset.fadeBottom).toBe('true');
    act(() => hook.result.current(null));
    expect(disconnect).toHaveBeenCalledTimes(1);
    node.scrollTop = 0;
    fireEvent.scroll(node);
    expect(node.dataset.fadeTop).toBe('true');
    const empty = document.createElement('div');
    act(() => hook.result.current(empty));
    hook.unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('continues observing scroll without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const hook = renderHook(() => useScrollFades<HTMLDivElement>());
    const node = document.createElement('div');
    act(() => hook.result.current(node));
    node.scrollTop = 10;
    fireEvent.scroll(node);
    expect(node.dataset.fadeTop).toBe('true');
    hook.unmount();
  });
});

describe('result reveal', () => {
  it('reveals and focuses one fresh requested result, leaving background results alone', () => {
    const scroll = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);
    let arm!: () => void;
    function Probe({ value, visible = true }: { value: unknown; visible?: boolean }) {
      const reveal = useRevealOnReady(value);
      arm = reveal.arm;
      return visible ? (
        <div tabIndex={-1} ref={reveal.ref}>
          result
        </div>
      ) : null;
    }
    const first = {};
    const view = render(<Probe value={first} />);
    view.rerender(<Probe value={{}} />);
    expect(scroll).not.toHaveBeenCalled();
    act(() => arm());
    view.rerender(<Probe value={null} />);
    expect(scroll).not.toHaveBeenCalled();
    view.rerender(<Probe value={first} />);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).toBe(view.getByText('result'));
    view.rerender(<Probe value={{}} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    act(() => arm());
    view.rerender(<Probe value={{}} visible={false} />);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('does not reveal the same result after arming', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const value = {};
    const hook = renderHook(({ result }) => useRevealOnReady(result), {
      initialProps: { result: value },
    });
    act(() => hook.result.current.arm());
    hook.rerender({ result: value });
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('overlay additional inside containers', () => {
  it('ignores opener descendants, allows outside dismissal, and reads replacement containers', () => {
    const root = document.createElement('aside');
    const opener = document.createElement('button');
    const icon = document.createElement('span');
    opener.append(icon);
    const replacement = document.createElement('button');
    document.body.append(root, opener, replacement);
    const dismiss = vi.fn();
    const hook = renderHook(
      ({ containers }) => useOverlayDismiss(true, () => root, dismiss, () => containers),
      { initialProps: { containers: [null, opener] as (HTMLElement | null)[] } },
    );
    fireEvent.pointerDown(icon);
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(dismiss.mock.calls).toEqual([['outside']]);
    hook.rerender({ containers: [replacement] });
    fireEvent.pointerDown(replacement);
    expect(dismiss).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(opener);
    expect(dismiss.mock.calls).toEqual([['outside'], ['outside']]);
    hook.unmount();
    root.remove(); opener.remove(); replacement.remove();
  });
});
