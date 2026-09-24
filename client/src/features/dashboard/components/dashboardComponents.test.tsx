import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('@features/sites/api', () => ({
  fetchSitesRequest: vi.fn(),
  createSiteRequest: vi.fn(),
  deleteSiteRequest: vi.fn(),
}));
vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: vi.fn(),
}));

const mockedSites = vi.mocked(sitesApi);

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
});

const makeStore = () =>
  configureStore({
    reducer: {
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
    await waitFor(() => expect(screen.getByRole('link', { name: 'Ranks' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Sites' })).toHaveAttribute('href', '/sites');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('link', { name: 'Ranks' })).toHaveAttribute(
      'href',
      '/sites/s-1?tab=keywords',
    );
    expect(screen.getByRole('link', { name: 'Keyword research' })).toHaveAttribute(
      'href',
      '/keyword-research',
    );
    expect(screen.getByRole('link', { name: 'Backlinks' })).toHaveAttribute(
      'href',
      '/sites/s-1?tab=backlinks',
    );
    expect(screen.getByRole('link', { name: 'Competitors' })).toHaveAttribute(
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
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sites' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Keyword research' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ranks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Backlinks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Competitors' })).not.toBeInTheDocument();
  });

  it('shows a loading skeleton while the first site fetch is in flight', () => {
    mockSession(sessionUser({}));
    mockedSites.fetchSitesRequest.mockReturnValue(new Promise(() => {}));
    renderComp(<Dashboard />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
