import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { i18n, initI18n, changeLanguage } from '@shared/i18n';
import { sitesReducer } from '@features/sites';
import { AppBreadcrumbs } from './AppBreadcrumbs';

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

  it('falls back to the site id when the site record is not loaded', () => {
    renderAt('/sites/site-1', false);
    expect(screen.getByRole('link', { name: 'site-1' })).toHaveAttribute('href', '/sites/site-1');
  });

  it('renders nothing on pages without a defined trail', () => {
    const { container } = renderAt('/dashboard');
    expect(container.querySelector('[data-slot="breadcrumb"]')).toBeNull();
  });

  it('renders the localized trail in Arabic (RTL)', async () => {
    await changeLanguage('ar');
    renderAt('/sites/site-1');
    expect(screen.getByRole('link', { name: 'المواقع' })).toHaveAttribute('href', '/sites');
    await changeLanguage('en');
  });
});
