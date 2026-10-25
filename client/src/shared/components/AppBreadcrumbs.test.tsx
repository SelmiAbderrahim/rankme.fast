import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { i18n, initI18n, changeLanguage } from '@shared/i18n';
import { sitesReducer } from '@features/sites';
import { ApiError } from '@shared/api/client';
import { AppBreadcrumbs } from './AppBreadcrumbs';

const fetchSiteRequest = vi.hoisted(() => vi.fn());
vi.mock('@features/sites/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/sites/api')>()),
  fetchSiteRequest,
}));

const site = {
  id: 'site-1',
  url: 'https://example.com',
  domain: 'example.com',
  displayName: 'Example',
  paused: false,
  pausedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const makeStore = (withSite = true) =>
  configureStore({
    reducer: { sites: sitesReducer },
    preloadedState: {
      sites: {
        ...sitesReducer(undefined, { type: '@@init' }),
        loaded: true,
        items: withSite ? [site] : [],
      },
    },
  });

const renderAt = (entry: string, withSite = true) =>
  render(
    <Provider store={makeStore(withSite)}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[entry]}>
          <AppBreadcrumbs />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

beforeEach(async () => {
  fetchSiteRequest.mockReset();
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('AppBreadcrumbs', () => {
  it('builds the workspace trail Dashboard → Sites → site → active tab', () => {
    renderAt('/sites/site-1?tab=backlinks');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Sites' })).toHaveAttribute('href', '/sites');
    expect(screen.getByRole('link', { name: 'Example' })).toHaveAttribute('href', '/sites/site-1');
    expect(screen.getByText('Backlinks')).toBeInTheDocument();
  });

  it('defaults the tab crumb to Overview when there is no ?tab=', () => {
    renderAt('/sites/site-1');
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('labels the standalone report path as the Report crumb', () => {
    renderAt('/sites/site-1/report');
    expect(screen.getByText('Report')).toBeInTheDocument();
  });

  it('maps the ai-visibility tab to its display label (tabLabelKey branch)', () => {
    renderAt('/sites/site-1?tab=ai-visibility');
    expect(screen.getByText('AI Visibility')).toBeInTheDocument();
  });

  it('maps the local-seo tab to its display label (tabLabelKey branch)', () => {
    renderAt('/sites/site-1?tab=local-seo');
    expect(screen.getByText('Local SEO')).toBeInTheDocument();
  });

  it('uses the Pages namespace for the Pages workspace crumb', () => {
    renderAt('/sites/site-1?tab=pages');
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.queryByText('workspace.tabs.pages')).not.toBeInTheDocument();
  });

  it.each([
    ['client-reports', 'Client reports'],
    ['traffic', 'Traffic Insights'],
  ])('uses the owning namespace for the %s workspace crumb', (tab, label) => {
    renderAt(`/sites/site-1?tab=${tab}`);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('labels the Link Intelligence workspace with its own tab vocabulary', () => {
    renderAt('/sites/site-1/backlinks?tab=history');
    expect(screen.getByRole('link', { name: 'Backlinks' })).toHaveAttribute(
      'href',
      '/sites/site-1?tab=backlinks',
    );
    expect(screen.getByText('History')).toBeInTheDocument();
  });

  it('defaults the Link Intelligence crumb to Overview without a ?tab=', () => {
    renderAt('/sites/site-1/backlinks');
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('falls back to Overview when the Link Intelligence ?tab= is not a known view', () => {
    renderAt('/sites/site-1/backlinks?tab=not-a-view');
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('reads a site that is not on the loaded page of the list and never shows its raw id', async () => {
    fetchSiteRequest.mockResolvedValue({ site: { ...site, id: 'site-9', displayName: 'Later page' } });
    renderAt('/sites/site-9', false);
    expect(await screen.findByRole('link', { name: 'Later page' })).toHaveAttribute('href', '/sites/site-9');
    expect(screen.queryByText('site-9')).not.toBeInTheDocument();
  });

  it('shows a neutral loading crumb, not the id, while the site is being read', async () => {
    fetchSiteRequest.mockReturnValue(new Promise(() => undefined));
    renderAt('/sites/site-9', false);
    expect(await screen.findByRole('status')).toHaveTextContent('Loading site…');
    expect(screen.queryByText('site-9')).not.toBeInTheDocument();
  });

  it('names an unknown site as the current page and adds no tab crumb', async () => {
    fetchSiteRequest.mockRejectedValue(new ApiError('Not found', 404, null));
    renderAt('/sites/site-9?tab=backlinks', false);
    expect(await screen.findByText('Unknown site')).toBeInTheDocument();
    expect(screen.queryByText('Backlinks')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchSiteRequest).toHaveBeenCalledTimes(1));
  });

  it('treats a failed read like an unknown site rather than showing the id', async () => {
    fetchSiteRequest.mockRejectedValue(new TypeError('offline'));
    renderAt('/sites/site-9', false);
    expect(await screen.findByText('Unknown site')).toBeInTheDocument();
  });

  it('adds one level for an explicit nested view and links the tab back to its default', () => {
    renderAt('/sites/site-1?tab=competitors&view=traffic');
    expect(screen.getByRole('link', { name: 'Competitors' })).toHaveAttribute(
      'href',
      '/sites/site-1?tab=competitors',
    );
    expect(screen.getByText('Traffic')).toBeInTheDocument();
  });

  it('reads a tab at its default view at the same depth as every other tab', () => {
    renderAt('/sites/site-1?tab=competitors&view=overview');
    expect(screen.getByText('Competitors').closest('[aria-current="page"]')).not.toBeNull();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
  });

  it.each([
    ['/sites', ['Sites']],
    ['/assistant', ['AI Assistant']],
    ['/keyword-research', ['Keyword research']],
    ['/keyword-research/history/', ['Keyword research', 'Research history']],
    ['/keyword-research/live-trends', ['Keyword research', 'Live search interest']],
    ['/dashboard/alerts', ['Alerts']],
    ['/exports', ['Exports and shares']],
    ['/settings/profile', ['Profile']],
    ['/settings/team', ['Team']],
    ['/settings/notifications', ['Notifications']],
    ['/settings/security', ['Security']],
  ])('shows Dashboard › … on %s', (path, labels) => {
    renderAt(path);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    for (const label of labels) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('shows the Dashboard as its own only, current crumb', () => {
    renderAt('/dashboard');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByText('Dashboard').closest('[aria-current="page"]')).not.toBeNull();
    expect(document.querySelector('a[href]')).toBeNull();
  });

  it('renders nothing on pages without a defined trail', () => {
    const { container } = renderAt('/team/invitations/extra');
    expect(container.querySelector('[data-slot="breadcrumb"]')).toBeNull();
  });

  it('renders the localized trail in Arabic (RTL)', async () => {
    await changeLanguage('ar');
    renderAt('/sites/site-1');
    expect(screen.getByRole('link', { name: 'المواقع' })).toHaveAttribute('href', '/sites');
    await changeLanguage('en');
  });
});
