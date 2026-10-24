import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { useAuthSession, type AuthSessionState } from '@features/auth';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { TooltipProvider } from '@shared/ui/tooltip';
import * as api from '../../api';
import { sitesReducer } from '../../store/slice';
import type { Site, SitesState } from '../../types';
import { SiteNavigationFrame } from '../SiteNavigation';
import { SITE_SIDEBAR_OVERLAY_QUERY, SiteNavigationProvider, useSiteNavigation } from './context';
import { SiteMenu } from './SiteMenu';
import { SiteMobileBar } from './SiteMobileBar';
import { SiteFavicon, SiteSwitcher } from './SiteSwitcher';

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  fetchSitesRequest: vi.fn(),
  fetchSiteRequest: vi.fn(),
  createSiteRequest: vi.fn(),
}));


vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: vi.fn(),
}));

const MOBILE_QUERY = '(max-width: 767.98px)';

const site = (id: string, overrides: Partial<Site> = {}): Site => ({
  id,
  url: `https://${id}.example.com`,
  domain: `${id}.example.com`,
  displayName: '',
  paused: false,
  pausedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const SITES = [site('s1'), site('s2', { displayName: 'Second brand' }), site('s3')];

const setUser = (user: Partial<NonNullable<AuthSessionState['user']>> | null) =>
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated: user !== null,
    isPending: false,
    emailVerified: true,
    user: user as AuthSessionState['user'],
  } satisfies AuthSessionState);

/** A controllable `matchMedia`: queries listed in `media` match. */
const media = new Set<string>();
const mediaListeners = new Set<() => void>();
const setMedia = (queries: string[]) =>
  act(() => {
    media.clear();
    queries.forEach((query) => media.add(query));
    mediaListeners.forEach((listener) => listener());
  });

const makeStore = (sites: Partial<SitesState> = {}) =>
  configureStore({
    reducer: { sites: sitesReducer },
    preloadedState: {
      sites: {
        ...sitesReducer(undefined, { type: '@@init' }),
        items: SITES,
        loaded: true,
        ...sites,
      },
    },
  });

const Probe = () => {
  const location = useLocation();
  return <output data-testid="loc">{`${location.pathname}${location.search}`}</output>;
};

const GoTo = ({ to }: { to: string }) => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go
    </button>
  );
};

const NavState = () => {
  const nav = useSiteNavigation();
  return (
    <output data-testid="nav-state">
      {`${nav.isSiteRoute}|${nav.siteId}|${nav.siteMenuExpanded}|${nav.siteMenuOverlay}`}
    </output>
  );
};

const renderWith = (
  ui: ReactNode,
  {
    entry = '/sites/s1',
    store = makeStore(),
  }: { entry?: string; store?: ReturnType<typeof makeStore> } = {},
) =>
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={0}>
          <MemoryRouter initialEntries={[entry]}>
            <SiteNavigationProvider>
              {ui}
              <Probe />
            </SiteNavigationProvider>
          </MemoryRouter>
        </TooltipProvider>
      </I18nextProvider>
    </Provider>,
  );

const clearCookie = () => {
  document.cookie = 'site_sidebar_state=; path=/; max-age=0';
};

const originalMatchMedia = window.matchMedia;

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  setUser({ id: 'u1', email: 'u1@example.com', role: 'Member' });
  vi.mocked(api.fetchSitesRequest).mockResolvedValue({ sites: SITES, nextCursor: null });
  vi.mocked(api.fetchSiteRequest).mockResolvedValue({
    site: site('s9', { displayName: 'Far away' }),
  });
  window.localStorage.clear();
  clearCookie();
  media.clear();
  mediaListeners.clear();
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return media.has(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  window.matchMedia = originalMatchMedia;
  clearCookie();
  await changeLanguage('en');
});

const nav = () => screen.getByTestId('site-navigation');
const loc = () => screen.getByTestId('loc');
const filterBox = () => screen.getByTestId('site-nav-filter');

describe('SiteNavigationProvider', () => {
  it('throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<NavState />)).toThrow(/inside SiteNavigationProvider/);
    spy.mockRestore();
  });

  it('defaults to expanded, saves the choice in a cookie, and remembers visited sites', async () => {
    setUser({ email: 'only@example.com' });
    renderWith(<NavState />);
    expect(screen.getByTestId('nav-state')).toHaveTextContent('true|s1|true|false');
    expect(
      JSON.parse(window.localStorage.getItem('rankmefast.recent-sites.only@example.com')!),
    ).toEqual(['s1']);
  });

  it('reads a saved rail from the cookie and is no site route elsewhere', () => {
    setUser(null);
    document.cookie = 'site_sidebar_state=false; path=/';
    renderWith(<NavState />, { entry: '/dashboard' });
    expect(screen.getByTestId('nav-state')).toHaveTextContent('false|null|false|false');
    expect(window.localStorage.getItem('rankmefast.recent-sites.anonymous')).toBeNull();
  });

  it('`[` toggles the site sidebar outside text fields, and never on phones', async () => {
    const user = userEvent.setup();
    renderWith(
      <>
        <NavState />
        <input aria-label="field" />
      </>,
    );
    const state = () => screen.getByTestId('nav-state').textContent;
    await user.keyboard('[[');
    expect(state()).toBe('true|s1|false|false');
    expect(document.cookie).toContain('site_sidebar_state=false');
    await user.keyboard('{Control>}[[{/Control}');
    expect(state()).toBe('true|s1|false|false');
    await user.keyboard('a');
    expect(state()).toBe('true|s1|false|false');
    await user.click(screen.getByLabelText('field'));
    await user.keyboard('[[');
    expect(state()).toBe('true|s1|false|false');
    (document.activeElement as HTMLElement).blur();
    setMedia([MOBILE_QUERY]);
    await user.keyboard('[[');
    expect(state()).toBe('true|s1|false|false');
    setMedia([]);
    await user.keyboard('[[');
    expect(state()).toBe('true|s1|true|false');
  });
});

describe('SiteMenu — expanded', () => {
  it('marks the current page, opens its group, and remembers group toggles', async () => {
    const user = userEvent.setup();
    renderWith(<SiteMenu />, { entry: '/sites/s1?tab=keywords' });
    expect(nav()).toHaveAttribute('data-state', 'expanded');
    expect(nav()).toHaveAccessibleName('Site');
    expect(screen.getByRole('link', { name: 'Keywords' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const search = screen.getByRole('button', { name: 'Search' });
    expect(search).toHaveAttribute('aria-expanded', 'true');
    const content = screen.getByRole('button', { name: 'Content' });
    expect(content).toHaveAttribute('aria-expanded', 'false');
    await user.click(content);
    expect(content).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(window.localStorage.getItem('rankmefast.site-groups.u1')!)).toEqual({
      content: true,
    });
    // Closing the active group sticks until the page changes.
    await user.click(search);
    expect(search).toHaveAttribute('aria-expanded', 'false');
    await user.click(search);
    expect(search).toHaveAttribute('aria-expanded', 'true');
    await user.click(search);
    await user.click(screen.getByRole('link', { name: 'Internal links' }));
    expect(loc()).toHaveTextContent('tab=internal-links');
    await user.click(content);
    expect(screen.getByRole('button', { name: 'Content' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Arrow keys on a heading are not list navigation.
    const heading = screen.getByRole('button', { name: 'Search' });
    heading.focus();
    fireEvent.keyDown(heading, { key: 'ArrowDown' });
    expect(heading).toHaveFocus();
  });

  it('re-reads the saved groups when the user changes', () => {
    window.localStorage.setItem('rankmefast.site-groups.u2', '{"visibility":true}');
    const store = makeStore();
    const view = renderWith(<SiteMenu />, { store });
    expect(screen.getByRole('button', { name: 'Visibility' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    setUser({ id: 'u2', role: 'Member' });
    view.rerender(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider delayDuration={0}>
            <MemoryRouter initialEntries={['/sites/s1']}>
              <SiteNavigationProvider>
                <SiteMenu />
              </SiteNavigationProvider>
            </MemoryRouter>
          </TooltipProvider>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByRole('button', { name: 'Visibility' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('filters pages: opens matching groups, highlights, moves with arrows, Enter opens the first', async () => {
    const user = userEvent.setup();
    renderWith(<SiteMenu />);
    await user.type(filterBox(), 'cann');
    const match = screen.getByRole('link', { name: /cann/i });
    expect(match.querySelector('mark')).toHaveTextContent('cann');
    expect(screen.queryByRole('button', { name: 'Content' })).not.toBeInTheDocument();
    expect(screen.getByText('Content', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(match).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(match).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(match).toHaveFocus();
    await user.keyboard('x');
    expect(match).toHaveFocus();

    await user.clear(filterBox());
    await user.type(filterBox(), 're');
    const links = within(nav()).getAllByRole('link');
    links[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(links[1]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(links[0]).toHaveFocus();

    await user.clear(filterBox());
    await user.type(filterBox(), 'overview');
    expect(screen.getByRole('link', { name: /Overview/ }).querySelector('mark')).toHaveTextContent(
      'Overview',
    );
    await user.keyboard('{Enter}');
    expect(loc()).toHaveTextContent('/sites/s1?tab=overview');
    expect(filterBox()).toHaveValue('');
    // Enter without a query, or other keys, do nothing.
    await user.keyboard('{Enter}');
    await user.keyboard('{Tab}');
    expect(loc()).toHaveTextContent('/sites/s1?tab=overview');
  });

  it('shows a no-results state, clears with the button or Escape, and blurs on a second Escape', async () => {
    const user = userEvent.setup();
    renderWith(<SiteMenu />);
    await user.type(filterBox(), 'qqq');
    expect(screen.getByTestId('site-nav-no-results')).toHaveTextContent('No pages match “\u2068qqq\u2069”');
    await user.keyboard('{Enter}');
    expect(loc()).toHaveTextContent('/sites/s1');
    await user.click(
      within(screen.getByTestId('site-nav-no-results')).getByRole('button', {
        name: 'Clear filter',
      }),
    );
    expect(filterBox()).toHaveValue('');
    expect(filterBox()).toHaveFocus();
    await user.type(filterBox(), 'key');
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(filterBox()).toHaveValue('');
    expect(filterBox()).toHaveFocus();
    await user.type(filterBox(), 'key');
    await user.keyboard('{Escape}');
    expect(filterBox()).toHaveValue('');
    expect(filterBox()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(filterBox()).not.toHaveFocus();
  });

  it('`/` focuses the filter outside text fields and on wider screens only', async () => {
    const user = userEvent.setup();
    renderWith(
      <>
        <SiteMenu />
        <input aria-label="field" />
      </>,
    );
    await user.keyboard('a');
    expect(filterBox()).not.toHaveFocus();
    await user.keyboard('{Control>}/{/Control}');
    expect(filterBox()).not.toHaveFocus();
    setMedia([MOBILE_QUERY]);
    await user.keyboard('/');
    expect(filterBox()).not.toHaveFocus();
    setMedia([]);
    await user.keyboard('/');
    expect(filterBox()).toHaveFocus();
    await user.click(screen.getByLabelText('field'));
    await user.keyboard('/');
    expect(screen.getByLabelText('field')).toHaveValue('/');
  });

  it('collapses to the rail from its toggle', async () => {
    const user = userEvent.setup();
    renderWith(<SiteMenu />);
    const toggle = screen.getByTestId('site-sidebar-toggle');
    expect(toggle).toHaveAccessibleName('Collapse site menu');
    expect(toggle).toHaveAttribute('aria-controls', 'site-sidebar');
    await user.click(toggle);
    expect(nav()).toHaveAttribute('data-state', 'collapsed');
    expect(screen.getByTestId('site-sidebar-toggle')).toHaveAccessibleName('Expand site menu');
  });
});

describe('SiteMenu — rail', () => {
  beforeEach(() => {
    document.cookie = 'site_sidebar_state=false; path=/';
  });

  it('names its icon links and expands into the focused filter from the rail search', async () => {
    const user = userEvent.setup();
    renderWith(<SiteMenu />, { entry: '/sites/s1?tab=apps' });
    expect(nav()).toHaveAttribute('data-state', 'collapsed');
    expect(within(nav()).getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(document.querySelector('[data-site-rail-group="local-apps"]')).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(document.querySelector('[data-site-rail-group="search"]')).not.toHaveAttribute(
      'data-active',
    );
    await user.click(screen.getByTestId('site-nav-filter-rail'));
    expect(nav()).toHaveAttribute('data-state', 'expanded');
    await waitFor(() => expect(filterBox()).toHaveFocus());
  });

  it('`/` from the rail expands the sidebar and focuses the filter', async () => {
    const user = userEvent.setup();
    renderWith(<SiteMenu />);
    await user.keyboard('/');
    expect(nav()).toHaveAttribute('data-state', 'expanded');
    await waitFor(() => expect(filterBox()).toHaveFocus());
  });

  it('opens a flyout by click and keyboard, closes it with the inline-start arrow', async () => {
    const user = userEvent.setup();
    renderWith(<SiteMenu />, { entry: '/sites/s1?tab=google' });
    const trigger = document.querySelector<HTMLElement>('[data-site-rail-group="search"]')!;
    await user.click(trigger);
    const flyout = await screen.findByTestId('site-rail-flyout-search');
    expect(within(flyout).getByText('Search')).toBeInTheDocument();
    expect(within(flyout).getByRole('menuitem', { name: 'Google' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() => expect(flyout).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('site-rail-flyout-search')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() =>
      expect(screen.queryByTestId('site-rail-flyout-search')).not.toBeInTheDocument(),
    );
    trigger.focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByTestId('site-rail-flyout-search')).toBeInTheDocument();
    await user.click(
      within(screen.getByTestId('site-rail-flyout-search')).getByRole('menuitem', {
        name: 'Research',
      }),
    );
    expect(loc()).toHaveTextContent('tab=research');
  });

  it('mirrors the flyout arrows in RTL', async () => {
    await changeLanguage('ar');
    const user = userEvent.setup();
    renderWith(<SiteMenu />);
    const trigger = document.querySelector<HTMLElement>('[data-site-rail-group="content"]')!;
    trigger.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.queryByTestId('site-rail-flyout-content')).not.toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    const flyout = await screen.findByTestId('site-rail-flyout-content');
    await waitFor(() => expect(flyout).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByTestId('site-rail-flyout-content')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(screen.queryByTestId('site-rail-flyout-content')).not.toBeInTheDocument(),
    );
  });

  it('opens on mouse hover after a short delay without taking focus, pins on click, and ignores touch', async () => {
    renderWith(<SiteMenu />);
    const trigger = document.querySelector<HTMLElement>('[data-site-rail-group="visibility"]')!;
    const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
    // jsdom has no PointerEvent; React derives enter/leave from over/out.
    const pointer = (
      type: 'pointerover' | 'pointerout' | 'pointerdown',
      target: Element,
      pointerType: 'mouse' | 'touch',
      relatedTarget: Element | null = document.body,
    ) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        relatedTarget,
        button: 0,
      });
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    };
    const flyout = () => screen.queryByTestId('site-rail-flyout-visibility');

    // Touch never opens or closes by hover.
    pointer('pointerover', trigger, 'touch');
    await wait(200);
    expect(flyout()).not.toBeInTheDocument();
    pointer('pointerout', trigger, 'touch');
    // Leaving before anything opened does nothing.
    pointer('pointerout', trigger, 'mouse');

    pointer('pointerover', trigger, 'mouse');
    await waitFor(() => expect(flyout()).toBeInTheDocument());
    expect(flyout()).not.toContainElement(document.activeElement as HTMLElement);
    // Hovering again while open keeps it open.
    pointer('pointerout', trigger, 'mouse');
    pointer('pointerover', trigger, 'mouse');
    // Into the flyout: the pending close is cancelled; touch entering is ignored.
    pointer('pointerout', trigger, 'mouse', flyout());
    pointer('pointerover', flyout()!, 'touch', null);
    pointer('pointerover', flyout()!, 'mouse', null);
    await wait(200);
    expect(flyout()).toBeInTheDocument();
    // Leaving the flyout closes it after the delay.
    pointer('pointerout', flyout()!, 'mouse');
    await waitFor(() => expect(flyout()).not.toBeInTheDocument());

    // Hover-open, then a press on the trigger: the menu's own toggle is
    // suppressed (the press is meant to pin, not to close), and the hover
    // close timer no longer applies.
    pointer('pointerover', trigger, 'mouse');
    await waitFor(() => expect(flyout()).toBeInTheDocument());
    expect(pointer('pointerdown', trigger, 'mouse', null).defaultPrevented).toBe(true);
    // ...and the flyout stays open: the trigger press is not an outside press.
    await wait(200);
    expect(flyout()).toBeInTheDocument();
    // A press anywhere else still dismisses it.
    pointer('pointerdown', document.body, 'mouse', null);
    await waitFor(() => expect(flyout()).not.toBeInTheDocument());
  });
});

describe('SiteMenu — tablet overlay', () => {
  beforeEach(() => {
    media.add(SITE_SIDEBAR_OVERLAY_QUERY);
  });

  it('overlays, closes on Escape or an outside press, returns focus, and never saves', async () => {
    const user = userEvent.setup();
    renderWith(
      <>
        <SiteMenu />
        <GoTo to="/sites/s1?tab=apps" />
      </>,
    );
    expect(nav()).toHaveAttribute('data-state', 'collapsed');
    await user.click(screen.getByTestId('site-sidebar-toggle'));
    expect(nav()).toHaveAttribute('data-state', 'expanded');
    expect(nav()).toHaveClass('absolute', 'shadow-lg');
    expect(document.cookie).not.toContain('site_sidebar_state');
    await user.keyboard('{Escape}');
    expect(nav()).toHaveAttribute('data-state', 'collapsed');
    await waitFor(() => expect(screen.getByTestId('site-sidebar-toggle')).toHaveFocus());

    // The rail search opened it; that button is gone, so focus goes to the toggle.
    await user.click(screen.getByTestId('site-nav-filter-rail'));
    expect(nav()).toHaveAttribute('data-state', 'expanded');
    await user.click(screen.getByRole('button', { name: 'go' }));
    expect(nav()).toHaveAttribute('data-state', 'collapsed');
    await user.click(screen.getByTestId('site-nav-filter-rail'));
    fireEvent.pointerDown(document.body);
    expect(nav()).toHaveAttribute('data-state', 'collapsed');
    await waitFor(() => expect(screen.getByTestId('site-sidebar-toggle')).toHaveFocus());

    // The toggle closes it again; `[` opens it with no trigger to remember.
    await user.click(screen.getByTestId('site-sidebar-toggle'));
    await user.click(screen.getByTestId('site-sidebar-toggle'));
    expect(nav()).toHaveAttribute('data-state', 'collapsed');
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('[[');
    expect(nav()).toHaveAttribute('data-state', 'expanded');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByTestId('site-sidebar-toggle')).toHaveFocus());
  });
});

describe('outside a site route', () => {
  it('still renders every link (with an empty site id) and keys storage without a user id', async () => {
    const user = userEvent.setup();
    setUser({ email: 'only@example.com' });
    const view = renderWith(
      <>
        <SiteMenu />
        <SiteMobileBar />
      </>,
      { entry: '/dashboard' },
    );
    expect(within(nav()).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'href',
      '/sites/?tab=overview',
    );
    await user.type(filterBox(), 'backl');
    await user.keyboard('{Enter}');
    expect(loc()).toHaveTextContent('/sites/?tab=backlinks');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('link', { name: 'Google' })).toHaveAttribute(
      'href',
      '/sites/?tab=google',
    );
    await user.click(screen.getByTestId('site-sidebar-toggle'));
    await user.click(document.querySelector<HTMLElement>('[data-site-rail-group="search"]')!);
    expect(
      within(await screen.findByTestId('site-rail-flyout-search')).getByRole('menuitem', {
        name: 'Google',
      }),
    ).toHaveAttribute('href', '/sites/?tab=google');
    view.unmount();
    setUser(null);
    renderWith(<SiteMenu />, { entry: '/dashboard' });
    expect(within(nav()).getByTestId('site-switcher')).toHaveAccessibleName(
      'Switch site · \u2068Loading site…\u2069',
    );
  });
});

describe('SiteSwitcher', () => {
  it('shows a letter avatar and never requests a remote favicon', () => {
    const { container, rerender } = render(<SiteFavicon site={site('s1')} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-site-avatar]')).toHaveTextContent('S');
    rerender(<SiteFavicon site={site('www', { url: 'not a url', displayName: 'www.zeta.com' })} />);
    expect(container.querySelector('[data-site-avatar]')).toHaveTextContent('Z');
    rerender(<SiteFavicon site={undefined} />);
    expect(container.querySelector('[data-site-avatar]')).toHaveTextContent('?');
  });

  it('lists sites without duplicate text and switches while keeping the page', async () => {
    const user = userEvent.setup();
    renderWith(<SiteSwitcher />, { entry: '/sites/s1?tab=content&view=briefs&run=9' });
    const trigger = screen.getByTestId('site-switcher');
    await waitFor(() => expect(trigger).toHaveAccessibleName('Switch site · \u2068s1.example.com\u2069'));
    await user.click(trigger);
    const popover = await screen.findByTestId('site-switcher-popover');
    const first = within(popover).getByRole('option', { name: /s1\.example\.com/ });
    expect(first).toHaveTextContent('Current site');
    expect(first.querySelector('.text-xs')).toBeNull();
    expect(within(popover).getByRole('option', { name: /Second brand/ })).toHaveTextContent(
      's2.example.com',
    );
    expect(within(popover).queryByText('Recent')).not.toBeInTheDocument();
    // Choosing the current site only closes.
    await user.click(first);
    expect(loc()).toHaveTextContent('/sites/s1?tab=content&view=briefs&run=9');
    await user.click(trigger);
    await user.click(
      within(await screen.findByTestId('site-switcher-popover')).getByRole('option', {
        name: /Second brand/,
      }),
    );
    expect(loc()).toHaveTextContent('/sites/s2?tab=content&view=briefs');
  });

  it('filters, shows empty states, and offers add and manage actions', async () => {
    const user = userEvent.setup();
    renderWith(<SiteSwitcher variant="bar" />);
    await user.click(screen.getByTestId('site-switcher'));
    const popover = await screen.findByTestId('site-switcher-popover');
    await user.type(within(popover).getByRole('combobox'), 'zzz');
    expect(within(popover).getByRole('status')).toHaveTextContent('No sites match “zzz”');
    await user.click(within(popover).getByRole('option', { name: 'Add site' }));
    expect(loc()).toHaveTextContent(/^\/sites$/);
    await user.click(screen.getByTestId('site-switcher'));
    // The query was reset when the popover closed.
    expect(
      within(await screen.findByTestId('site-switcher-popover')).getByRole('combobox'),
    ).toHaveValue('');
    await user.click(screen.getByRole('option', { name: 'Manage sites' }));
    expect(loc()).toHaveTextContent(/^\/sites$/);
  });

  it('says there are no sites when the list is empty', async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchSitesRequest).mockResolvedValue({ sites: [], nextCursor: null });
    renderWith(<SiteSwitcher />, { store: makeStore({ items: [] }) });
    await user.click(screen.getByTestId('site-switcher'));
    expect(
      within(await screen.findByTestId('site-switcher-popover')).getByRole('status'),
    ).toHaveTextContent('No sites found');
  });

  it('adds a Recent section once there are more than five sites', async () => {
    const many = Array.from({ length: 7 }, (_, index) => site(`m${index}`));
    vi.mocked(api.fetchSitesRequest).mockResolvedValue({ sites: many, nextCursor: null });
    window.localStorage.setItem(
      'rankmefast.recent-sites.u1',
      JSON.stringify(['m3', 'gone', 'm0', 'm5', 'm6', 'm1']),
    );
    const user = userEvent.setup();
    renderWith(<SiteSwitcher />, { entry: '/sites/m0', store: makeStore({ items: many }) });
    await user.click(screen.getByTestId('site-switcher'));
    const popover = await screen.findByTestId('site-switcher-popover');
    const recent = within(popover).getByRole('group', { name: 'Recent' });
    // m0 is the provider's own visit, so it was remembered first, then excluded.
    expect(
      within(recent)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      expect.stringContaining('m3'),
      expect.stringContaining('m5'),
      expect.stringContaining('m6'),
    ]);
    expect(within(popover).getByRole('group', { name: 'All sites' })).toBeInTheDocument();
  });

  it('loads the list on open when it is not loaded, and reads an unlisted current site directly', async () => {
    const user = userEvent.setup();
    const view = renderWith(<SiteSwitcher variant="rail" />, {
      store: makeStore({ items: [], loaded: false }),
    });
    expect(screen.getByTestId('site-switcher')).toHaveAccessibleName('Switch site · \u2068Loading site…\u2069');
    await user.click(screen.getByTestId('site-switcher'));
    expect(api.fetchSitesRequest).toHaveBeenCalled();
    view.unmount();
    await changeLanguage('ar');
    renderWith(<SiteSwitcher variant="rail" />, { entry: '/sites/s9' });
    expect(api.fetchSiteRequest).toHaveBeenCalledWith('s9');
    await waitFor(() =>
      expect(screen.getByTestId('site-switcher').getAttribute('aria-label')).toContain('Far away'),
    );
    await user.click(screen.getByTestId('site-switcher'));
    expect(await screen.findByTestId('site-switcher-popover')).toHaveAttribute('data-side', 'left');
  });
});

describe('SiteSwitcher — unknown site (QA round 3, F-Z)', () => {
  it('settles on "Unknown site" instead of "Loading site…" when the direct read fails', async () => {
    vi.mocked(api.fetchSiteRequest).mockRejectedValueOnce(new Error('gone'));
    renderWith(<SiteSwitcher variant="rail" />, { entry: '/sites/s404', store: makeStore({ items: [], loaded: false }) });
    await waitFor(() =>
      expect(screen.getByTestId('site-switcher').getAttribute('aria-label')).toContain('Unknown site'),
    );
  });
});

describe('SiteMobileBar', () => {
  it('shows sibling chips and picks a page from the filtered sheet', async () => {
    const user = userEvent.setup();
    renderWith(<SiteMobileBar />, { entry: '/sites/s1?tab=keywords' });
    const chips = screen.getByRole('group', { name: 'Pages in this section' });
    expect(within(chips).getByRole('link', { name: 'Keywords' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await user.click(screen.getByTestId('site-page-picker'));
    const sheet = await screen.findByRole('dialog', { name: 'Choose a page' });
    const filter = within(sheet).getByRole('searchbox', { name: 'Filter pages…' });
    await user.type(filter, 'zzz');
    expect(within(sheet).getByRole('status')).toHaveTextContent('No pages match “\u2068zzz\u2069”');
    await user.clear(filter);
    await user.type(filter, 'back');
    expect(within(sheet).queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('link', { name: 'Backlinks' }));
    expect(loc()).toHaveTextContent('tab=backlinks');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Reopened, the filter starts empty.
    await user.click(screen.getByTestId('site-page-picker'));
    expect(
      within(await screen.findByRole('dialog', { name: 'Choose a page' })).getByRole('searchbox'),
    ).toHaveValue('');
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Overview' }));
    expect(loc()).toHaveTextContent('tab=overview');
  });

  it('has no chips on Overview', () => {
    renderWith(<SiteMobileBar />);
    expect(screen.queryByRole('group', { name: 'Pages in this section' })).not.toBeInTheDocument();
    expect(screen.getByTestId('site-page-picker')).toHaveTextContent('Overview');
  });
});

describe('SiteNavigationFrame', () => {
  const frame = (
    <SiteNavigationFrame footer={<footer>FOOT</footer>}>
      <main>MAIN</main>
    </SiteNavigationFrame>
  );

  it('passes non-site pages through with the footer after them', () => {
    const { container } = renderWith(frame, { entry: '/dashboard' });
    expect(screen.getByText('MAIN').nextElementSibling).toHaveTextContent('FOOT');
    expect(container.querySelector('[data-site-menu]')).toBeNull();
  });

  it('defaults to no footer', () => {
    renderWith(
      <SiteNavigationFrame>
        <main>ONLY</main>
      </SiteNavigationFrame>,
      { entry: '/dashboard' },
    );
    expect(screen.getByText('ONLY').nextElementSibling).toBe(screen.getByTestId('loc'));
  });

  it('puts the site sidebar beside a content column that ends with the footer', () => {
    const { container } = renderWith(frame, { entry: '/sites/s1?tab=apps' });
    const column = screen.getByText('MAIN').parentElement!;
    expect(column.lastElementChild).toHaveTextContent('FOOT');
    const desktop = container.querySelector('[data-site-menu="desktop"]')!;
    expect(desktop).toHaveClass('sticky', 'top-14');
    expect(desktop).not.toHaveClass('w-(--site-sidebar-width-icon)');
    expect(container.querySelector('[data-site-active-tab="apps"]')).not.toBeNull();
    expect(screen.getByTestId('site-mobile-bar')).toBeInTheDocument();
  });

  it('reserves only the rail width on tablets', () => {
    media.add(SITE_SIDEBAR_OVERLAY_QUERY);
    const { container } = renderWith(frame);
    expect(container.querySelector('[data-site-menu="desktop"]')).toHaveClass(
      'w-(--site-sidebar-width-icon)',
    );
  });
});


it('returns focus to the mobile page picker after Escape and after choosing a destination', async () => {
  const user = userEvent.setup();
  renderWith(<SiteMobileBar />, { entry: '/sites/s1?tab=keywords&view=queries#details' });
  const trigger = screen.getByTestId('site-page-picker');
  await user.click(trigger);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(trigger);
  const target = within(screen.getByRole('dialog')).getByRole('link', { name: 'Report' });
  expect(target).toHaveAttribute('href', '/sites/s1?tab=report&view=queries#details');
  await user.click(target);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(loc()).toHaveTextContent('/sites/s1?tab=report&view=queries');
});

it('shows picker failures with retry and marks bounded all-site reads as partial', async () => {
  vi.mocked(api.fetchSitesRequest).mockRejectedValueOnce(new Error('network'));
  const user = userEvent.setup();
  renderWith(<SiteSwitcher />);
  await user.click(screen.getByTestId('site-switcher'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your sites.');
  vi.mocked(api.fetchSitesRequest).mockImplementation(async (cursor) => ({ sites: [site(cursor ? 's2' : 's1')], nextCursor: 'repeated' }));
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Only your first 2 sites are listed here.')).toHaveAttribute('role', 'status');
  expect(screen.getByRole('option', { name: /s1.example.com/ })).toBeInTheDocument();
});

it('dismisses a mobile page sheet when the viewport grows or another route opens', async () => {
  media.add(MOBILE_QUERY);
  const user = userEvent.setup();
  renderWith(<><SiteMobileBar /><GoTo to="/sites/s1?tab=report" /></>);
  await user.click(screen.getByTestId('site-page-picker'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  setMedia([]);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  setMedia([MOBILE_QUERY]);
  await user.click(screen.getByTestId('site-page-picker'));
  // External route change while the modal is open, like browser history navigation.
  fireEvent.click(screen.getByText('go'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
