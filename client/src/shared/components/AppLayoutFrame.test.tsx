import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sitesReducer } from '@features/sites';
import { workspaceReducer } from '@features/workspace';
import { i18n, initI18n } from '@shared/i18n';
import { AppLayout } from './AppLayout';
import { ThemeProvider } from '@shared/theme/ThemeProvider';

// Identity is the network boundary; shell, navigation and primitives run as shipped.
vi.mock('@features/auth', async (original) => ({
  ...(await original<typeof import('@features/auth')>()),
  useAuthSession: () => ({
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: null,
  }),
}));
vi.mock('@features/team/components/InvitationInbox', () => ({ InvitationInbox: () => null }));
let width = 1440;
const listeners = new Set<() => void>();
function resize(next: number) {
  act(() => {
    width = next;
    listeners.forEach((listener) => listener());
  });
}
function mount(path = '/dashboard') {
  const store = configureStore({ reducer: { sites: sitesReducer, workspace: workspaceReducer } });
  const router = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          {
            path: '*',
            element: (
              <>
                <h1>Current page</h1>
                <div id="anchor">Anchor content</div>
              </>
            ),
          },
        ],
      },
    ],
    { initialEntries: [path], future: { v7_relativeSplatPath: true } },
  );
  const result = render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </ThemeProvider>
      </I18nextProvider>
    </Provider>,
  );
  const state = () => result.container.querySelector('[data-slot="sidebar"]');
  const scroller = () =>
    result.container.querySelector<HTMLElement>('[data-slot="sidebar-inset"]')!;
  const toggle = () => within(screen.getByRole('banner')).getByTestId('app-sidebar-toggle');
  return { ...result, router, state, scroller, toggle };
}
beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  width = 1440;
  listeners.clear();
  document.cookie = 'app_sidebar_state=; max-age=0; path=/';
  document.cookie = 'sidebar_state=; max-age=0; path=/';
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches:
      (!query.includes('min-width: 768') || width >= 768) &&
      (!query.includes('max-width: 767') || width <= 767) &&
      (!query.includes('max-width: 1279') || width < 1280) &&
      (!query.includes('max-width: 1023') || width < 1024),
    media: query,
    onchange: null,
    addEventListener: (_event: string, listener: unknown) => listeners.add(listener as () => void),
    removeEventListener: (_event: string, listener: unknown) =>
      listeners.delete(listener as () => void),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => true,
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe('app viewport frame', () => {
  it('bounds desktop content and exposes a first-tab skip target within one main landmark', async () => {
    const { container, scroller } = mount();
    expect(container.querySelector('[data-app-frame]')).toHaveClass(
      'md:h-dvh',
      'md:overflow-hidden',
    );
    expect(scroller()).toHaveClass('md:overflow-y-auto', 'md:overscroll-y-none', 'md:*:shrink-0');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    expect(document.activeElement).toHaveAttribute('href', '#main-content');
    expect(scroller()).toContainElement(container.querySelector('footer'));
  });
  it('resets new paths, preserves query positions, restores POP entries and follows anchors', async () => {
    const { router, scroller } = mount();
    scroller().scrollTop = 300;
    fireEvent.scroll(scroller());
    await act(() => router.navigate('/sites'));
    expect(scroller().scrollTop).toBe(0);
    scroller().scrollTop = 180;
    fireEvent.scroll(scroller());
    await act(() => router.navigate('/sites?tab=overview'));
    expect(scroller().scrollTop).toBe(180);
    await act(() => router.navigate(-1));
    expect(scroller().scrollTop).toBe(180);
    await act(() => router.navigate(-1));
    expect(scroller().scrollTop).toBe(300);
    await act(() => router.navigate(1));
    expect(scroller().scrollTop).toBe(180);
    const anchorScroll = vi.spyOn(document.getElementById('anchor')!, 'scrollIntoView');
    await act(() => router.navigate('/sites#anchor'));
    expect(anchorScroll).toHaveBeenCalledWith({ block: 'start' });
  });
});
describe('responsive sidebar choice', () => {
  it('defaults to a rail below 1280 and expands above it before any choice', () => {
    width = 1100;
    const { state } = mount();
    expect(state()).toHaveAttribute('data-state', 'collapsed');
    resize(1280);
    expect(state()).toHaveAttribute('data-state', 'expanded');
  });
  it.each(['app_sidebar_state', 'sidebar_state'])(
    'reads saved %s before paint and persists deliberate inline changes',
    async (name) => {
      document.cookie = `${name}=false; path=/`;
      const { state, toggle } = mount();
      expect(state()).toHaveAttribute('data-state', 'collapsed');
      await userEvent.click(toggle());
      expect(state()).toHaveAttribute('data-state', 'expanded');
      expect(document.cookie).toContain('app_sidebar_state=true');
      resize(1100);
      expect(state()).toHaveAttribute('data-state', 'expanded');
    },
  );
  it('keeps tablets temporary without pushing content and dismisses on Escape, outside press and navigation', async () => {
    width = 900;
    document.cookie = 'app_sidebar_state=true; path=/';
    const { state, toggle, router, container } = mount();
    expect(state()).toHaveAttribute('data-state', 'collapsed');
    await userEvent.click(toggle());
    expect(state()).toHaveAttribute('data-overlay', 'true');
    expect(container.querySelector('[data-slot="sidebar-gap"]')).toHaveClass(
      'group-data-[overlay=true]:w-(--sidebar-width-icon)',
    );
    expect(document.cookie).toContain('app_sidebar_state=true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(state()).toHaveAttribute('data-state', 'collapsed');
    await waitFor(() => expect(toggle()).toHaveFocus());
    await userEvent.click(toggle());
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Current page' }));
    expect(state()).toHaveAttribute('data-state', 'collapsed');
    await waitFor(() => expect(toggle()).toHaveFocus());
    await userEvent.click(toggle());
    await act(() => router.navigate('/sites'));
    expect(state()).toHaveAttribute('data-state', 'collapsed');
    await userEvent.click(toggle());
    await act(() => router.navigate('/sites?tab=overview'));
    expect(state()).toHaveAttribute('data-state', 'collapsed');
    resize(1300);
    expect(state()).toHaveAttribute('data-state', 'expanded');
    resize(900);
    expect(state()).toHaveAttribute('data-state', 'collapsed');
  });
  it('keeps the phone Sheet width cap and restores keyboard focus after dismissal', async () => {
    width = 500;
    const { toggle } = mount();
    await userEvent.click(toggle());
    expect(screen.getByRole('dialog', { name: 'Primary navigation' })).toHaveStyle(
      '--sidebar-width: min(18rem, calc(100vw - 2rem))',
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(toggle()).toHaveFocus());
    expect(document.cookie).not.toContain('app_sidebar_state');
  });
});

describe('sidebar navigation scroll', () => {
  it.each([
    [0, 180, 220, 20],
    [100, 60, 90, 60],
    [20, 110, 140, 20],
  ])('keeps the active row visible inside the nav alone (%s)', (initial, top, bottom, expected) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return {
        top: this.hasAttribute('data-app-nav') ? 100 : top,
        bottom: this.hasAttribute('data-app-nav') ? 200 : bottom,
        x: 0,
        y: top,
        width: 100,
        height: bottom - top,
        left: 0,
        right: 100,
        toJSON: () => ({}),
      };
    });
    const positions = new WeakMap<HTMLElement, number>();
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement) {
        return positions.get(this) ?? initial;
      },
      set(this: HTMLElement, value: number) {
        positions.set(this, value);
      },
    });
    const outerScroll = vi.spyOn(window, 'scrollTo');
    outerScroll.mockClear();
    const intoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    intoView.mockClear();
    try {
      const { scroller } = mount('/settings/security');
      const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
      expect(nav.scrollTop).toBe(expected);
      expect(scroller().scrollTop).toBe(initial);
      expect(outerScroll).not.toHaveBeenCalled();
      expect(intoView).not.toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTop;
    }
  });
});

describe('phone navigation lifecycle', () => {
  it('reveals the active row when the phone navigation mounts after the page', async () => {
    width = 500;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = this.hasAttribute('data-app-nav') ? 100 : 240;
      const bottom = this.hasAttribute('data-app-nav') ? 200 : 280;
      return {
        top,
        bottom,
        x: 0,
        y: top,
        width: 100,
        height: bottom - top,
        left: 0,
        right: 100,
        toJSON: () => ({}),
      };
    });
    const { toggle } = mount('/settings/security');
    await userEvent.click(toggle());
    expect(screen.getByRole('navigation', { name: 'Primary navigation' }).scrollTop).toBe(80);
  });
  it('preserves focus deliberately moved to the destination main while the Sheet closes', async () => {
    width = 500;
    const { toggle } = mount();
    await userEvent.click(toggle());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Sites' }));
    const main = screen.getByRole('main');
    main.focus();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    expect(main).toHaveFocus();
  });
});


describe('tablet toggle pointer sequence', () => {
  it('closes an expanded overlay on the second actual toggle click', async () => {
    width = 900;
    const { toggle, state } = mount();
    await userEvent.click(toggle());
    expect(state()).toHaveAttribute('data-state', 'expanded');
    await userEvent.click(toggle());
    expect(state()).toHaveAttribute('data-state', 'collapsed');
    expect(toggle()).toHaveFocus();
    expect(document.cookie).not.toContain('app_sidebar_state');
  });
});

it('keeps site navigation beside the single main and closes only its content column with the footer', async () => {
  const { container } = mount('/sites/s1?tab=keywords');
  const main = screen.getByRole('main');
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getAllByRole('banner')).toHaveLength(1);
  const navigation = await screen.findByTestId('site-navigation');
  expect(main.contains(navigation)).toBe(false);
  expect(main.parentElement!.lastElementChild).toBe(screen.getByRole('contentinfo'));
  expect(container.querySelector('[data-site-menu="desktop"]')).toBeInTheDocument();
});
