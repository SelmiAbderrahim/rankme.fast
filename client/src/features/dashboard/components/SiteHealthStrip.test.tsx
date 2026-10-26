import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { sitesReducer } from '@features/sites';
import * as sitesApi from '@features/sites/api';
import { workspaceInitialState, workspaceReducer } from '@features/workspace/store/slice';
import { MemoryRouter } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import { HealthRow } from './SiteHealthStrip';
import { PausedSitesPanel } from './PausedSitesPanel';
import type { SiteHealthResponse, SiteHealthRow } from '../types';

vi.mock('@features/sites/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/sites/api')>()), resumeSiteRequest: vi.fn(),
}));

const row: SiteHealthRow = {
  id: 'site-1', domain: 'example.com', displayName: 'Example',
  openFixNow: { state: 'value', count: 2, asOf: '2026-10-20T00:00:00.000Z' },
  lastAudit: { state: 'value', status: 'succeeded', finishedAt: '2026-10-20T00:00:00.000Z', asOf: '2026-10-20T00:00:00.000Z' },
  searchTrend: { state: 'unavailable', reason: 'no_data_yet' },
  rankMovement: { state: 'value', improved: 1, declined: 0, unchanged: 0, tracked: 3, compared: 1,
    notCompared: { failed: 1, skipped: 0, noPair: 1 }, asOf: '2026-10-20T00:00:00.000Z' },
};

beforeEach(() => initI18n({ initialLocale: 'en' }));

describe('dashboard health row', () => {
  it('makes the site and metric links easy to tap on phones', () => {
    render(<I18nextProvider i18n={i18n}><MemoryRouter><HealthRow row={row} /></MemoryRouter></I18nextProvider>);
    expect(screen.getAllByRole('link')).toHaveLength(5);
    for (const link of screen.getAllByRole('link')) expect(link).toHaveClass('max-md:min-h-11');
  });
  it('shows failed checks separately from compared rank movement', () => {
    render(<I18nextProvider i18n={i18n}><MemoryRouter><HealthRow row={row} /></MemoryRouter></I18nextProvider>);
    expect(screen.getByText(/1 check failed/)).toBeInTheDocument();
    expect(screen.getByText('Keywords compared: 1 of 3.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open keywords/i })).toHaveAttribute('href', '/sites/site-1?tab=keywords');
  });

  it('names stale sources with their stored dates', () => {
    render(<I18nextProvider i18n={i18n}><MemoryRouter><HealthRow row={{ ...row,
      searchTrend: { state: 'stale', clicks: 1, impressions: 5, previousClicks: null,
        previousImpressions: null, asOf: '2026-10-01', source: 'query' } }} />
    </MemoryRouter></I18nextProvider>);
    expect(screen.getByRole('group', { name: 'Out of date' })).toHaveTextContent('Search data as of');
    expect(screen.getByText(/No earlier period is stored to compare/)).toBeInTheDocument();
  });

  it('offers an owner a resume action for each paused site', () => {
    const health: SiteHealthResponse = { generatedAt: '2026-10-20T00:00:00.000Z', limit: 10,
      totalSites: 1, activeSites: 0, pausedSites: 1, hasMore: false, sites: [],
      pausedList: [{ id: 'site-1', domain: 'example.com', displayName: 'Example', pausedAt: null }] };
    const store = configureStore({ reducer: { sites: sitesReducer } });
    render(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter>
      <PausedSitesPanel health={health} />
    </MemoryRouter></I18nextProvider></Provider>);
    expect(screen.getByRole('button', { name: /Resume.*Example/ })).toBeInTheDocument();
    expect(screen.getByText('Paused sites do not run scheduled checks or audits.')).toBeInTheDocument();
  });

  it('resumes a paused site through the existing site action', async () => {
    const user = userEvent.setup();
    const health: SiteHealthResponse = { generatedAt: '2026-10-20T00:00:00.000Z', limit: 10,
      totalSites: 1, activeSites: 0, pausedSites: 1, hasMore: false, sites: [],
      pausedList: [{ id: 'site-1', domain: 'example.com', displayName: 'Example', pausedAt: null }] };
    vi.mocked(sitesApi.resumeSiteRequest).mockResolvedValueOnce({ site: {
      id: 'site-1', url: 'https://example.com', domain: 'example.com', displayName: 'Example', paused: false,
      pausedAt: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
    }, message: 'Resumed' });
    const store = configureStore({ reducer: { sites: sitesReducer } });
    render(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter>
      <PausedSitesPanel health={health} />
    </MemoryRouter></I18nextProvider></Provider>);
    await user.click(screen.getByRole('button', { name: /Resume.*Example/ }));
    expect(sitesApi.resumeSiteRequest).toHaveBeenCalledWith('site-1');
  });

  it('shows a member who can manage paused sites and the hidden remainder', () => {
    const health: SiteHealthResponse = { generatedAt: '2026-10-20T00:00:00.000Z', limit: 10,
      totalSites: 2, activeSites: 0, pausedSites: 2, hasMore: false, sites: [],
      pausedList: [{ id: 'site-1', domain: 'example.com', displayName: 'Example', pausedAt: '2026-10-20T00:00:00.000Z' }] };
    const store = configureStore({ reducer: { sites: sitesReducer, workspace: workspaceReducer },
      preloadedState: { workspace: { ...workspaceInitialState, activeWorkspaceId: 'other',
        workspaces: [{ accountId: 'other', label: 'Team', role: 'member' as const, isOwn: false }] } } });
    render(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter>
      <PausedSitesPanel health={health} />
    </MemoryRouter></I18nextProvider></Provider>);
    expect(screen.queryByRole('button', { name: /Resume.*Example/ })).not.toBeInTheDocument();
    expect(screen.getByText('Ask a workspace owner to resume a paused site.')).toBeInTheDocument();
    expect(screen.getByText(/1 more paused site is not shown/)).toBeInTheDocument();
  });
});
