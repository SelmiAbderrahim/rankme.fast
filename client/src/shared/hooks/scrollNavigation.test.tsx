import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_RESTORE_WINDOW_MS, useShellScrollRestoration } from './useShellScrollRestoration';
import { useScrollTopOnNavigate } from './useScrollTopOnNavigate';

let outer = 0;
let inner: HTMLDivElement;
const routers: ReturnType<typeof createMemoryRouter>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  outer = 0;
  inner = document.createElement('div');
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => outer });
  vi.spyOn(window, 'scrollTo').mockImplementation((_x, y) => {
    outer = y as number;
  });
});
afterEach(() => {
  cleanup();
  routers.splice(0).forEach((router) => router.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
function mount(kind: 'shell' | 'public', entry = '/a') {
  function Shell() {
    useShellScrollRestoration(() => inner);
    return null;
  }
  function Public() {
    useScrollTopOnNavigate();
    return null;
  }
  const router = createMemoryRouter(
    [{ path: '*', element: kind === 'shell' ? <Shell /> : <Public /> }],
    { initialEntries: [entry], future: { v7_relativeSplatPath: true } },
  );
  routers.push(router);
  const view = render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
  return { router, view };
}
const navigate = async (
  router: ReturnType<typeof createMemoryRouter>,
  to: string | number,
  replace = false,
) => {
  await act(async () => {
    if (typeof to === 'number') await router.navigate(to);
    else await router.navigate(to, { replace });
  });
};
const record = (top: number, outside = top) => {
  inner.scrollTop = top;
  outer = outside;
  fireEvent.scroll(inner);
  fireEvent.scroll(window);
};

describe('shell scroll restoration', () => {
  it('resets new pathnames, keeps query-only moves, restores POP and returns browser ownership', async () => {
    window.history.scrollRestoration = 'auto';
    const { router, view } = mount('shell');
    expect(window.history.scrollRestoration).toBe('manual');
    record(120, 240);
    await navigate(router, '/a?tab=details');
    expect(inner.scrollTop).toBe(120);
    expect(outer).toBe(240);
    record(160, 260);
    await navigate(router, '/b');
    expect(inner.scrollTop).toBe(0);
    expect(outer).toBe(0);
    record(80, 180);
    await navigate(router, -1);
    expect(inner.scrollTop).toBe(160);
    expect(outer).toBe(260);
    await navigate(router, -1);
    expect(inner.scrollTop).toBe(120);
    expect(outer).toBe(240);
    await navigate(router, 1);
    expect(inner.scrollTop).toBe(160);
    view.unmount();
    expect(window.history.scrollRestoration).toBe('auto');
  });

  it.each([false, true])(
    'restores a preserved query entry without another scroll (replace=%s)',
    async (replace) => {
      const { router } = mount('shell');
      record(120, 240);
      await navigate(router, '/a?tab=details', replace);
      expect(inner.scrollTop).toBe(120);
      expect(outer).toBe(240);
      await navigate(router, '/b');
      expect(inner.scrollTop).toBe(0);
      expect(outer).toBe(0);
      await navigate(router, -1);
      expect(inner.scrollTop).toBe(120);
      expect(outer).toBe(240);
    },
  );

  it('waits for late content on POP, then stops once the saved position lands', async () => {
    const { router } = mount('shell');
    record(300, 400);
    await navigate(router, '/b');
    let available = false;
    let current = 0;
    Object.defineProperty(inner, 'scrollTop', {
      configurable: true,
      get: () => current,
      set: (top) => {
        current = available ? top : 0;
      },
    });
    await navigate(router, -1);
    expect(inner.scrollTop).toBe(0);
    await advance(32);
    available = true;
    await advance(32);
    expect(inner.scrollTop).toBe(300);
    expect(outer).toBe(400);
    const calls = vi.mocked(window.scrollTo).mock.calls.length;
    await advance(100);
    expect(window.scrollTo).toHaveBeenCalledTimes(calls);
  });

  it('waits for encoded hash targets and handles malformed hashes without a selector', async () => {
    const { router } = mount('shell', '/a#late%20target');
    const anchor = document.createElement('div');
    anchor.id = 'late target';
    document.body.append(anchor);
    const scroll = vi.spyOn(anchor, 'scrollIntoView');
    await advance(32);
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    const malformed = document.createElement('div');
    malformed.id = '%broken';
    document.body.append(malformed);
    const badScroll = vi.spyOn(malformed, 'scrollIntoView').mockClear();
    await navigate(router, '/a#%broken');
    expect(badScroll).toHaveBeenCalledTimes(1);
    await navigate(router, '/a?tab=one#%broken');
    expect(badScroll).toHaveBeenCalledTimes(1);
  });

  it.each(['wheel', 'touchstart', 'keydown', 'mousedown'])(
    'stops a pending anchor restore on %s',
    async (type) => {
      const { router } = mount('shell');
      await navigate(router, '/b#late');
      window.dispatchEvent(new Event(type));
      const anchor = document.createElement('div');
      anchor.id = 'late';
      document.body.append(anchor);
      const scroll = vi.spyOn(anchor, 'scrollIntoView');
      await advance(100);
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  it('stops retrying after the deadline and cancels pending work on navigation/unmount', async () => {
    const { router, view } = mount('shell', '/a#missing');
    await advance(SCROLL_RESTORE_WINDOW_MS + 32);
    const anchor = document.createElement('div');
    anchor.id = 'missing';
    document.body.append(anchor);
    const scroll = vi.spyOn(anchor, 'scrollIntoView');
    await advance(32);
    expect(scroll).not.toHaveBeenCalled();
    await navigate(router, '/b#future');
    await navigate(router, '/c');
    anchor.id = 'future';
    await advance(32);
    expect(scroll).not.toHaveBeenCalled();
    await navigate(router, '/d#later');
    view.unmount();
    anchor.id = 'later';
    await advance(32);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('tolerates absent inner scrollers and scrollTo, and POP without a saved position', async () => {
    function Probe() {
      useShellScrollRestoration(() => null);
      return null;
    }
    const router = createMemoryRouter([{ path: '*', element: <Probe /> }], {
      initialEntries: ['/prior', '/current'],
      initialIndex: 1,
    });
    routers.push(router);
    const view = render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
    outer = 99;
    await navigate(router, -1);
    expect(outer).toBe(99);
    vi.stubGlobal('scrollTo', undefined);
    await navigate(router, '/next');
    view.unmount();
  });

  it('restores window-only entries and retries when the window is still clamped', async () => {
    function Probe() {
      useShellScrollRestoration(() => null);
      return null;
    }
    const router = createMemoryRouter([{ path: '*', element: <Probe /> }], {
      initialEntries: ['/a'],
    });
    routers.push(router);
    render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
    outer = 240;
    fireEvent.scroll(window);
    await navigate(router, '/a?tab=details');
    await navigate(router, '/b');
    let available = false;
    vi.mocked(window.scrollTo).mockImplementation((_x, y) => {
      outer = available ? (y as number) : 0;
    });
    await navigate(router, -1);
    expect(outer).toBe(0);
    await advance(32);
    expect(outer).toBe(0);
    available = true;
    await advance(32);
    expect(outer).toBe(240);
  });

  it('ignores a queued animation callback after user input has cancelled restoration', async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    mount('shell', '/a#late');
    fireEvent.wheel(window);
    const anchor = document.createElement('div');
    anchor.id = 'late';
    document.body.append(anchor);
    const scroll = vi.spyOn(anchor, 'scrollIntoView');
    act(() => callbacks[0]?.(0));
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('window scroll on public navigation', () => {
  it('resets PUSH and REPLACE pathnames while preserving queries, hashes and POP', async () => {
    const { router } = mount('public');
    outer = 200;
    await navigate(router, '/a?tab=details');
    expect(outer).toBe(200);
    await navigate(router, '/b');
    expect(outer).toBe(0);
    outer = 300;
    await navigate(router, '/c', true);
    expect(outer).toBe(0);
    outer = 400;
    await navigate(router, -1);
    expect(outer).toBe(400);
    await navigate(router, '/hash#section');
    expect(outer).toBe(400);
  });

  it('tolerates an unavailable browser scroll API', async () => {
    vi.stubGlobal('scrollTo', undefined);
    const { router } = mount('public');
    await navigate(router, '/next');
  });
});
