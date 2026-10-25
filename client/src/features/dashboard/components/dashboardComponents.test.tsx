import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { useAuthSession, type AuthSessionState, type AuthSessionUser } from '@features/auth';
import { Dashboard } from './Dashboard';
import { sitesReducer } from '@features/sites';
import type { Site } from '@features/sites';
import { i18n, initI18n } from '@shared/i18n';
import * as sitesApi from '@features/sites/api';
import { dashboardReducer } from '../store/slice';
import * as dashboardApi from '../api';

vi.mock('@features/sites/api', () => ({
  fetchSitesRequest: vi.fn(),
  createSiteRequest: vi.fn(),
  deleteSiteRequest: vi.fn(),
}));
vi.mock('../api', () => ({ fetchSiteHealthRequest: vi.fn() }));
vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: vi.fn(),
}));

const mockedSites = vi.mocked(sitesApi);
const mockedDashboard = vi.mocked(dashboardApi);

const sessionUser = (overrides: Partial<AuthSessionUser> = {}): AuthSessionUser =>
  ({
    id: 'u-1',
    email: 'me@example.com',
    name: 'Me Example',
    emailVerified: true,
    role: 'Member',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }) as AuthSessionUser;

const mockSession = (user: AuthSessionUser | null) => {
  vi.mocked(useAuthSession).mockReturnValue({
    authenticated: Boolean(user),
    isPending: false,
    emailVerified: user?.emailVerified ?? false,
    user,
  } satisfies AuthSessionState);
};

const site = (id = 's-1'): Site => ({
  id,
  url: 'https://example.com',
  domain: 'example.com',
  displayName: 'Example',
  paused: false,
  pausedAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
  mockedDashboard.fetchSiteHealthRequest.mockResolvedValue({ generatedAt: new Date(0).toISOString(),
    limit: 10, totalSites: 0, activeSites: 0, pausedSites: 0, hasMore: false, sites: [], pausedList: [] });
});

const makeStore = () =>
  configureStore({
    reducer: {
      dashboard: dashboardReducer,
      sites: sitesReducer,
    },
  });

const renderComp = (ui: React.ReactNode) =>
  render(
    <Provider store={makeStore()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

const primeSites = (sites: Site[] = [site()]) => {
  mockedSites.fetchSitesRequest.mockResolvedValue({ sites, nextCursor: null });
};

describe('Dashboard', () => {
  it('renders every product card for a signed-in member with a site', async () => {
    mockSession(sessionUser({}));
    primeSites();
    renderComp(<Dashboard />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open rank tracking' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Open sites' })).toHaveAttribute('href', '/sites');
    expect(screen.getByRole('link', { name: 'Open profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('link', { name: 'Open rank tracking' })).toHaveAttribute(
      'href',
      '/sites/s-1?tab=keywords',
    );
    expect(screen.getByRole('link', { name: 'Research keywords' })).toHaveAttribute(
      'href',
      '/keyword-research',
    );
    expect(screen.getByRole('link', { name: 'View backlinks' })).toHaveAttribute(
      'href',
      '/sites/s-1?tab=backlinks',
    );
    expect(screen.getByRole('link', { name: 'View competitors' })).toHaveAttribute(
      'href',
      '/sites/s-1?tab=competitors',
    );
    const assistantEntry = screen.getByTestId('dashboard-assistant-entry');
    expect(document.querySelector('[data-slot="card"]')).toBe(assistantEntry);
    expect(screen.getByRole('link', { name: 'Open Assistant' })).toHaveAttribute(
      'href',
      '/assistant',
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
  });

  it('hides site-scoped cards when there is no site yet (anonymous session)', async () => {
    mockSession(null);
    primeSites([]);
    renderComp(<Dashboard />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open sites' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Research keywords' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open rank tracking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View backlinks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View competitors' })).not.toBeInTheDocument();
  });

  it('shows a loading skeleton while the first site fetch is in flight', async () => {
    mockSession(sessionUser({}));
    mockedSites.fetchSitesRequest.mockReturnValue(new Promise(() => {}));
    renderComp(<Dashboard />);
    expect(screen.getByRole('status', { name: 'Loading dashboard…' })).toBeInTheDocument();
    await screen.findByText('Add a site to see its audit, search, and keyword health here.');
  });

  it('asks which site to open when several sites are available', async () => {
    const user = userEvent.setup();
    mockSession(sessionUser());
    primeSites([site('s-1'), { ...site('s-2'), domain: 'second.example', displayName: 'Second' }]);
    renderComp(<Dashboard />);
    const picker = await screen.findByRole('button', { name: /choose a site to open rank tracking/i });
    expect(screen.queryByRole('link', { name: 'Open rank tracking' })).not.toBeInTheDocument();
    await user.click(picker);
    expect(await screen.findByRole('menuitem', { name: 'Second' })).toHaveAttribute('href', '/sites/s-2?tab=keywords');
    expect(screen.getByRole('menuitem', { name: 'See all sites' })).toHaveAttribute('href', '/sites?open=keywords');
  });

  it('does not offer paused sites as tool choices', async () => {
    const user = userEvent.setup();
    mockSession(sessionUser());
    primeSites([site('s-1'), { ...site('s-2'), displayName: 'Paused', paused: true }]);
    renderComp(<Dashboard />);
    await user.click(await screen.findByRole('button', { name: /choose a site to open rank tracking/i }));
    expect(screen.getByRole('menuitem', { name: 'Example' })).toHaveAttribute('href', '/sites/s-1?tab=keywords');
    expect(screen.queryByRole('menuitem', { name: 'Paused' })).not.toBeInTheDocument();
  });

  it('keeps the Sites choice when the first page contains only paused sites', async () => {
    mockSession(sessionUser());
    primeSites([{ ...site('s-1'), paused: true }]);
    renderComp(<Dashboard />);
    expect(await screen.findByRole('link', { name: 'Choose a site to open rank tracking' }))
      .toHaveAttribute('href', '/sites?open=keywords');
  });

});
