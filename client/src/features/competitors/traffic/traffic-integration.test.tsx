import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as competitorsApi from '../api';
import { CompetitorsPanel } from '../components/CompetitorsPanel';
import { competitorsReducer } from '../store/slice';
import { competitorsRoutes } from '../routes';

vi.mock('../api', () => ({
  fetchCompetitors: vi.fn(),
  fetchIntersection: vi.fn(),
  refreshCompetitors: vi.fn(),
  fetchTechStack: vi.fn(),
}));

vi.mock('./components/TrafficInsightsPanel', () => ({
  TrafficInsightsPanel: ({ siteId }: { siteId?: string }) => (
    <div data-testid="shared-traffic-panel" data-site={siteId}>
      shared traffic panel
    </div>
  ),
}));

const mockedApi = vi.mocked(competitorsApi);

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="workspace-search">{location.search}</output>;
};

const renderWorkspace = (entry: string) => {
  const store = configureStore({ reducer: { competitors: competitorsReducer } });
  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[entry]}>
          <CompetitorsPanel siteId="site-1" />
          <LocationProbe />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApi.fetchCompetitors.mockReset();
  mockedApi.fetchCompetitors.mockResolvedValue({
    target: 'example.com',
    fetchedAt: '2026-07-23T12:00:00.000Z',
    source: 'domain',
    competitors: [],
  });
});

describe('Competitors traffic integration', () => {
  it('mounts the shared TrafficInsightsPanel in a URL-backed sub-tab', async () => {
    renderWorkspace(
      '/sites/site-1?tab=competitors&view=traffic&ids=111111111111111111111111,222222222222222222222222',
    );

    const panel = await screen.findByTestId('shared-traffic-panel');
    expect(panel).toHaveAttribute('data-site', 'site-1');
    expect(screen.getByTestId('workspace-search')).toHaveTextContent('tab=competitors');
    expect(screen.getByTestId('workspace-search')).toHaveTextContent('view=traffic');
    expect(screen.getByTestId('workspace-search')).toHaveTextContent('ids=');
  });

  it('switches sub-tabs with the keyboard while preserving compare URL state', async () => {
    renderWorkspace(
      '/sites/site-1?tab=competitors&view=traffic&ids=111111111111111111111111,222222222222222222222222',
    );
    const user = userEvent.setup();
    const overview = await screen.findByRole('tab', { name: 'Competitors' });
    overview.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('workspace-search')).not.toHaveTextContent('view=traffic'),
    );
    expect(screen.getByTestId('workspace-search')).toHaveTextContent('ids=');

    const traffic = screen.getByRole('tab', { name: 'Traffic Insights' });
    traffic.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('workspace-search')).toHaveTextContent('view=traffic'),
    );
    expect(await screen.findByTestId('shared-traffic-panel')).toBeVisible();
  });

  it('keeps the legacy competitors route pointed at the unified workspace host', async () => {
    render(
      <MemoryRouter initialEntries={['/sites/site-1/competitors']}>
        <Routes>
          <Route path="sites/:siteId/competitors" element={competitorsRoutes[0]?.element} />
          <Route path="sites/:siteId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('workspace-search')).toHaveTextContent('tab=competitors'),
    );
  });
});
