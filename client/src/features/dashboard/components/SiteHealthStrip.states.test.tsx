import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { configureStore, type Middleware } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { resumeSite, sitesReducer } from '@features/sites';
import * as sitesApi from '@features/sites/api';
import { workspaceInitialState, workspaceReducer } from '@features/workspace/store/slice';
import { i18n, initI18n } from '@shared/i18n';
import { fetchSiteHealthRequest } from '../api';
import { dashboardReducer } from '../store/slice';
import type { SiteHealthResponse, SiteHealthRow } from '../types';
import { HealthRow, SiteHealthStrip } from './SiteHealthStrip';
import { PausedSitesPanel } from './PausedSitesPanel';

vi.mock('../api', () => ({ fetchSiteHealthRequest: vi.fn() }));
vi.mock('@features/sites/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/sites/api')>()), resumeSiteRequest: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const AT = '2026-10-20T00:00:00.000Z';
const row: SiteHealthRow = {
  id: 'site-1', domain: 'example.com', displayName: 'Example',
  openFixNow: { state: 'value', count: 2, asOf: AT },
  lastAudit: { state: 'value', status: 'succeeded', finishedAt: AT, asOf: AT },
  searchTrend: { state: 'value', clicks: 10, impressions: 100, previousClicks: 5, previousImpressions: 50, asOf: AT, source: 'date' },
  rankMovement: { state: 'value', improved: 1, declined: 1, unchanged: 1, tracked: 3, compared: 3,
    notCompared: { failed: 0, skipped: 0, noPair: 0 }, asOf: AT },
};
const health = (over: Partial<SiteHealthResponse> = {}): SiteHealthResponse => ({
  generatedAt: AT, limit: 10, totalSites: 1, activeSites: 1, pausedSites: 0, hasMore: false,
  sites: [row], pausedList: [], ...over,
});

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
});

const renderRow = (value: SiteHealthRow) => render(
  <I18nextProvider i18n={i18n}><MemoryRouter><HealthRow row={value} /></MemoryRouter></I18nextProvider>);

describe('HealthRow metric states', () => {
  it('shows deltas for both periods and hides a delta when both periods are zero', () => {
    const { unmount } = renderRow(row);
    expect(screen.getAllByText(/./).length).toBeGreaterThan(0);
    expect(screen.queryByRole('group', { name: 'Out of date' })).not.toBeInTheDocument();
    unmount();
    renderRow({ ...row, searchTrend: { ...row.searchTrend, clicks: 0, impressions: 0, previousClicks: 0, previousImpressions: 0 } as SiteHealthRow['searchTrend'] });
    expect(screen.queryByText(i18n.t('dashboard.health.search.clicksDelta', { ns: 'common' }))).not.toBeInTheDocument();
  });

  it('reports a metric that is unavailable for each source', () => {
    renderRow({
      ...row, displayName: '',
      openFixNow: { state: 'unavailable', reason: 'no_audit' },
      lastAudit: { state: 'unavailable', reason: 'no_audit' },
      searchTrend: { state: 'unavailable', reason: 'not_connected' },
      rankMovement: { state: 'unavailable', reason: 'no_keywords', tracked: 0 },
    });
    expect(screen.getByText(i18n.t('dashboard.health.lastAudit.never', { ns: 'common' }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('dashboard.health.rank.unavailable.no_keywords', { ns: 'common' }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('dashboard.health.fixNow.unavailable.no_audit', { ns: 'common' }))).toBeInTheDocument();
  });

  it('marks stale sources and a failed audit, and lists every rank check that was not compared', () => {
    renderRow({
      ...row,
      openFixNow: { state: 'stale', count: 1, asOf: '2026-09-01T00:00:00.000Z' },
      lastAudit: { state: 'stale', status: 'failed', finishedAt: '2026-09-01T00:00:00.000Z', asOf: '2026-09-01T00:00:00.000Z' },
      searchTrend: { state: 'stale', clicks: 3, impressions: 9, previousClicks: 3, previousImpressions: 9, asOf: '2026-09-01T00:00:00.000Z', source: 'date' },
      rankMovement: { state: 'stale', improved: 0, declined: 0, unchanged: 1, tracked: 4, compared: 1,
        notCompared: { failed: 1, skipped: 1, noPair: 1 }, asOf: '2026-09-01T00:00:00.000Z' },
    });
    const group = screen.getByRole('group', { name: 'Out of date' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByText(i18n.t('dashboard.health.stale', { ns: 'common' })).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(i18n.t('dashboard.health.lastAudit.status.failed', { ns: 'common' }))).toBeInTheDocument();
  });

  it('names the audit as stale when only the open-issue count is stale', () => {
    renderRow({ ...row, openFixNow: { state: 'stale', count: 4, asOf: '2026-09-01T00:00:00.000Z' } });
    expect(screen.getByRole('group', { name: 'Out of date' })).toBeInTheDocument();
  });

  it('names a stale audit even when only the audit result is stale', () => {
    renderRow({ ...row, lastAudit: { state: 'stale', status: 'succeeded', finishedAt: AT, asOf: AT } });
    expect(screen.getByRole('group', { name: 'Out of date' })).toBeInTheDocument();
  });
});

describe('SiteHealthStrip', () => {
  const renderStrip = () => {
    const store = configureStore({ reducer: { dashboard: dashboardReducer, sites: sitesReducer, workspace: workspaceReducer },
      preloadedState: { workspace: { ...workspaceInitialState } } });
    render(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter><SiteHealthStrip /></MemoryRouter></I18nextProvider></Provider>);
    return store;
  };

  it('shows a loading placeholder, then the rows and the hidden-sites note', async () => {
    vi.mocked(fetchSiteHealthRequest).mockResolvedValue(health({ hasMore: true, totalSites: 12, activeSites: 12 }));
    renderStrip();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByTestId('site-health-row-site-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See all/i })).toHaveAttribute('href', '/sites');
  });

  it('shows the empty state for an account without sites and the all-paused note', async () => {
    vi.mocked(fetchSiteHealthRequest).mockResolvedValue(health({ totalSites: 0, activeSites: 0, sites: [] }));
    const { unmount } = render(<span />);
    unmount();
    renderStrip();
    expect(await screen.findByText(i18n.t('dashboard.health.empty.cta', { ns: 'common' }))).toBeInTheDocument();
  });

  it('explains when every site is paused and shows the paused panel', async () => {
    vi.mocked(fetchSiteHealthRequest).mockResolvedValue(health({
      totalSites: 1, activeSites: 0, sites: [], pausedSites: 1,
      pausedList: [{ id: 'site-9', domain: 'paused.example', displayName: 'Paused', pausedAt: AT }],
    }));
    renderStrip();
    expect(await screen.findByText(i18n.t('dashboard.health.allPaused', { ns: 'common' }))).toBeInTheDocument();
    expect(screen.getByTestId('paused-sites-panel')).toBeInTheDocument();
  });

  it('shows a failed read with a retry that forces another read', async () => {
    vi.mocked(fetchSiteHealthRequest).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(health());
    renderStrip();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: i18n.t('retry', { ns: 'common' }) }));
    expect(await screen.findByTestId('site-health-row-site-1')).toBeInTheDocument();
    expect(fetchSiteHealthRequest).toHaveBeenCalledTimes(2);
  });
});

describe('PausedSitesPanel resume', () => {
  const owner = { workspace: { ...workspaceInitialState, activeWorkspaceId: 'own',
    workspaces: [{ accountId: 'own', label: 'Own', role: 'owner' as const, isOwn: true }] } };
  const paused = (pausedAt: string | null) => health({ totalSites: 1, activeSites: 0, sites: [], pausedSites: 1,
    pausedList: [{ id: 'site-1', domain: 'example.com', displayName: 'Example', pausedAt }] });
  const mount = (value: SiteHealthResponse) => {
    const store = configureStore({ reducer: { sites: sitesReducer, workspace: workspaceReducer }, preloadedState: owner });
    render(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter><PausedSitesPanel health={value} /></MemoryRouter></I18nextProvider></Provider>);
  };

  it('announces a resumed site and a failed resume, and omits the pause date when unknown', async () => {
    vi.mocked(sitesApi.resumeSiteRequest).mockRejectedValueOnce(new Error('offline'));
    mount(paused(null));
    await userEvent.click(screen.getByRole('button', { name: /Resume.*Example/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/since/i)).not.toBeInTheDocument();
  });

  it('falls back to a generic message when the resume fails without a reason', async () => {
    let armed = false;
    const answerWithBareRejection: Middleware = () => (next) => (action) => {
      if (armed && typeof action === 'function') {
        armed = false;
        return Promise.resolve(resumeSite.rejected(new Error('stopped'), 'request-1', 'site-1'));
      }
      return next(action);
    };
    const store = configureStore({
      reducer: { sites: sitesReducer, workspace: workspaceReducer },
      preloadedState: owner,
      middleware: (getDefault) => getDefault().prepend(answerWithBareRejection) as never,
    });
    render(<Provider store={store}><I18nextProvider i18n={i18n}><MemoryRouter>
      <PausedSitesPanel health={paused(AT)} />
    </MemoryRouter></I18nextProvider></Provider>);
    armed = true;
    await userEvent.click(screen.getByRole('button', { name: /Resume.*Example/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      i18n.t('dashboard.health.paused.resumeFailed', { ns: 'common' })));
  });
});
