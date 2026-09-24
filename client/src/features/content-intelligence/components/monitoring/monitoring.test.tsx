import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en/contentIntelligence.json';
import { initialState } from '../../store/slice';
import {
  isContentMonitorActive,
  isContentMonitorStatus,
  type ContentMonitor,
  type MonitorFeedEvent,
} from '../../types';

const hooks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));

const api = vi.hoisted(() => ({
  listMonitors: vi.fn(),
  createMonitor: vi.fn(),
  getMonitorFeed: vi.fn(),
  pauseMonitor: vi.fn(),
  resumeMonitor: vi.fn(),
  deleteMonitor: vi.fn(),
  getMonitorNotifications: vi.fn(),
  patchMonitorNotifications: vi.fn(),
  // competitor-content api used by the create form's profile loader.
  listCompetitors: vi.fn(),
  suggestCompetitors: vi.fn(),
  addCompetitor: vi.fn(),
  archiveCompetitor: vi.fn(),
  restoreCompetitor: vi.fn(),
  startCompetitorRun: vi.fn(),
  listCompetitorRuns: vi.fn(),
  getCompetitorRun: vi.fn(),
  cancelCompetitorRun: vi.fn(),
}));

vi.mock('@shared/hooks/redux', () => ({
  useAppDispatch: () => hooks.dispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(hooks.state),
}));

vi.mock('../../api', () => api);

import { monitorFeedTone, monitorStatusTone } from './status';
import { MonitorCreateForm } from './MonitorCreateForm';
import { MonitorList } from './MonitorList';
import { ChangeFeed } from './ChangeFeed';
import { MonitorNotificationsToggle } from './MonitorNotificationsToggle';
import { MonitoringPanel } from './MonitoringPanel';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: { en: { contentIntelligence: en } } });

// ---------------------------------------------------------------------------
// Factories + harness
// ---------------------------------------------------------------------------

function monitor(overrides: Partial<ContentMonitor> = {}): ContentMonitor {
  return {
    monitorId: 'm1',
    siteId: 's1',
    targetUrl: 'https://example.com/pricing',
    targetKind: 'owned',
    cadence: 'weekly',
    locale: 'en',
    status: 'active',
    hasBaseline: false,
    lastCheckAt: null,
    lastMaterialChangeAt: null,
    lastReconcileAt: null,
    error: null,
    createdAt: '2026-07-20T00:00:00Z',
    updatedAt: '2026-07-20T00:00:00Z',
    ...overrides,
  };
}

function feedEvent(overrides: Partial<MonitorFeedEvent> = {}): MonitorFeedEvent {
  return {
    eventKey: 'e1',
    kind: 'check_completed',
    checkId: 'c1',
    isoWeek: '2026-W29',
    recordedAt: '2026-07-20T00:00:00Z',
    diffText: null,
    ...overrides,
  };
}

function competitor(id: string, domain: string, status: 'active' | 'archived' = 'active') {
  return {
    id,
    origin: `https://${domain}`,
    registrableDomain: domain,
    source: 'manual' as const,
    status,
    createdAt: '2026-07-20T00:00:00Z',
  };
}

function setState(
  monOverrides: Partial<typeof initialState.monitoring> = {},
  ccOverrides: Partial<typeof initialState.competitorContent> = {},
) {
  hooks.state = {
    contentIntelligence: {
      ...initialState,
      siteId: 's1',
      monitoring: { ...initialState.monitoring, ...monOverrides },
      competitorContent: { ...initialState.competitorContent, ...ccOverrides },
    },
  };
}

function installThunkDispatch() {
  hooks.dispatch.mockImplementation((action: unknown) => {
    if (typeof action === 'function') {
      return action(hooks.dispatch, () => hooks.state, undefined);
    }
    return action;
  });
}

function LocationDisplay() {
  const loc = useLocation();
  return <span data-testid="loc">{loc.search}</span>;
}

function renderInRouter(node: React.ReactNode, path = '/sites/s1?tab=content&view=monitoring') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        {node}
        <LocationDisplay />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  hooks.dispatch.mockReset();
  for (const mock of Object.values(api)) mock.mockReset();
  api.listMonitors.mockResolvedValue({ monitors: [], activeLimit: 5, usedSlots: 0 });
  api.createMonitor.mockResolvedValue({ monitor: monitor({ monitorId: 'm9' }), duplicate: false });
  api.getMonitorFeed.mockResolvedValue({ monitor: monitor(), feed: [], nextCursor: null });
  api.pauseMonitor.mockResolvedValue({ monitor: monitor({ status: 'paused' }) });
  api.resumeMonitor.mockResolvedValue({ monitor: monitor({ status: 'active' }) });
  api.deleteMonitor.mockResolvedValue({ ok: true });
  api.getMonitorNotifications.mockResolvedValue({ preferences: { emailMonitorChange: true } });
  api.patchMonitorNotifications.mockResolvedValue({ preferences: { emailMonitorChange: false } });
  api.listCompetitors.mockResolvedValue({ competitors: [] });
  setState();
  installThunkDispatch();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// status.ts + type guards
// ---------------------------------------------------------------------------

describe('monitor status helpers + guards', () => {
  it('maps every status + feed kind to a tone', () => {
    expect(monitorStatusTone('active')).toBe('success');
    expect(monitorStatusTone('paused')).toBe('muted');
    expect(monitorStatusTone('cap_paused')).toBe('warning');
    expect(monitorStatusTone('error')).toBe('destructive');
    expect(monitorFeedTone('check_reserved')).toBe('info');
    expect(monitorFeedTone('check_completed')).toBe('success');
    expect(monitorFeedTone('change_detected')).toBe('warning');
    expect(monitorFeedTone('check_failed')).toBe('destructive');
    expect(monitorFeedTone('cap_paused')).toBe('warning');
    expect(monitorFeedTone('mystery')).toBe('muted');
  });

  it('guards status values and active state', () => {
    expect(isContentMonitorStatus('active')).toBe(true);
    expect(isContentMonitorStatus('nope')).toBe(false);
    expect(isContentMonitorActive('active')).toBe(true);
    expect(isContentMonitorActive('paused')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MonitoringPanel — gate + routing + poll
// ---------------------------------------------------------------------------

describe('MonitoringPanel', () => {
  it('renders the index (create + toggle + list) and loads monitors', async () => {
    setState({ monitors: [monitor()], usedSlots: 1, listLoaded: true });
    renderInRouter(<MonitoringPanel siteId="s1" />);
    expect(screen.getByTestId('monitoring-panel')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-create')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-notifications')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-list')).toBeInTheDocument();
    await waitFor(() => expect(api.listMonitors).toHaveBeenCalledWith('s1', 'all', expect.anything()));
  });

  it('applies a status filter from the URL and round-trips filter clicks', async () => {
    setState({ monitors: [monitor()], listLoaded: true });
    renderInRouter(
      <MonitoringPanel siteId="s1" />,
      '/sites/s1?tab=content&view=monitoring&monStatus=paused',
    );
    await waitFor(() =>
      expect(api.listMonitors).toHaveBeenCalledWith('s1', 'paused', expect.anything()),
    );
    await userEvent.click(screen.getByTestId('monitor-filter-error'));
    expect(screen.getByTestId('loc')).toHaveTextContent('monStatus=error');
    await userEvent.click(screen.getByTestId('monitor-filter-all'));
    expect(screen.getByTestId('loc')).not.toHaveTextContent('monStatus');
  });

  it('removes an invalid status filter', async () => {
    setState({ listLoaded: true });
    renderInRouter(
      <MonitoringPanel siteId="s1" />,
      '/sites/s1?tab=content&view=monitoring&monStatus=unknown',
    );
    await waitFor(() => expect(screen.getByTestId('loc')).not.toHaveTextContent('monStatus'));
  });

  it('opens a monitor feed via the row and navigates back', async () => {
    setState({ monitors: [monitor()], listLoaded: true, detail: { m1: monitor() }, feed: { m1: [] } });
    renderInRouter(<MonitoringPanel siteId="s1" />);
    await userEvent.click(screen.getByTestId('monitor-view-m1'));
    expect(screen.getByTestId('loc')).toHaveTextContent('monitor=m1');
    expect(screen.getByTestId('monitor-detail')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('monitor-detail-back'));
    expect(screen.getByTestId('loc')).not.toHaveTextContent('monitor=m1');
  });

  it('routes the create form to the competitors view', async () => {
    setState({});
    renderInRouter(<MonitoringPanel siteId="s1" />);
    await userEvent.click(screen.getByTestId('monitor-kind-competitor'));
    await userEvent.click(screen.getByTestId('monitor-manage-competitors'));
    expect(screen.getByTestId('loc')).toHaveTextContent('view=competitors');
  });

  it('polls the monitor list while an active monitor exists', async () => {
    vi.useFakeTimers();
    setState({ monitors: [monitor({ status: 'active' })], listLoaded: true });
    renderInRouter(<MonitoringPanel siteId="s1" />);
    await vi.advanceTimersByTimeAsync(8000);
    expect(api.listMonitors).toHaveBeenCalledTimes(2);
  });

  it('shows the detail loading skeleton, then a not-found back-only view', () => {
    setState({ detailLoading: { m2: true } });
    const loading = renderInRouter(
      <MonitoringPanel siteId="s1" />,
      '/sites/s1?tab=content&view=monitoring&monitor=m2',
    );
    expect(screen.getByTestId('monitor-detail-loading')).toBeInTheDocument();
    loading.unmount();

    setState({});
    renderInRouter(
      <MonitoringPanel siteId="s1" />,
      '/sites/s1?tab=content&view=monitoring&monitor=ghost',
    );
    expect(screen.getByTestId('monitor-detail-back')).toBeInTheDocument();
    expect(screen.queryByTestId('monitor-detail')).toBeNull();
  });

  it('shows the detail error state when the feed fails and no monitor is cached', () => {
    setState({ detailError: { m3: 'boom' } });
    renderInRouter(
      <MonitoringPanel siteId="s1" />,
      '/sites/s1?tab=content&view=monitoring&monitor=m3',
    );
    expect(screen.getByTestId('monitor-detail-error')).toHaveTextContent('boom');
  });

  it('renders the detail summary, monitor error, and change feed', async () => {
    vi.useFakeTimers();
    setState({
      detail: {
        m1: monitor({
          status: 'active',
          cadence: 'monthly',
          lastCheckAt: '2026-07-20T00:00:00Z',
          error: { category: 'cap_exhausted', messageKey: 'k' },
        }),
      },
      feed: { m1: [feedEvent()] },
      feedCursor: { m1: null },
    });
    renderInRouter(
      <MonitoringPanel siteId="s1" />,
      '/sites/s1?tab=content&view=monitoring&monitor=m1',
    );
    expect(screen.getByTestId('monitor-detail-summary')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-detail-error-info')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-change-feed')).toBeInTheDocument();
    // active monitor polls the feed.
    await vi.advanceTimersByTimeAsync(8000);
    expect(api.getMonitorFeed).toHaveBeenCalledTimes(2);
  });

  it('retries the monitor list from the error state', async () => {
    setState({ listError: 'network', listLoaded: true });
    renderInRouter(
      <MonitoringPanel siteId="s1" />,
      '/sites/s1?tab=content&view=monitoring&monStatus=paused',
    );
    api.listMonitors.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(api.listMonitors).toHaveBeenCalledWith('s1', 'paused', expect.anything());
  });

  it('loads more feed entries when the detail cursor is set', async () => {
    setState({
      detail: { m1: monitor({ status: 'paused' }) },
      feed: { m1: [feedEvent()] },
      feedCursor: { m1: 'more' },
    });
    renderInRouter(
      <MonitoringPanel siteId="s1" />,
      '/sites/s1?tab=content&view=monitoring&monitor=m1',
    );
    api.getMonitorFeed.mockClear();
    await userEvent.click(screen.getByTestId('monitor-feed-load-more'));
    await waitFor(() =>
      expect(api.getMonitorFeed).toHaveBeenCalledWith(
        expect.objectContaining({ monitorId: 'm1', cursor: 'more' }),
        expect.anything(),
      ),
    );
  });

  it('falls back for an unknown monitor error category', () => {
    setState({
      detail: { m1: monitor({ error: { category: 'weird' as never, messageKey: 'k' } }) },
      feed: { m1: [] },
    });
    renderInRouter(
      <MonitoringPanel siteId="s1" />,
      '/sites/s1?tab=content&view=monitoring&monitor=m1',
    );
    expect(screen.getByTestId('monitor-detail-error-info')).toHaveTextContent(
      'Something went wrong with this monitor.',
    );
  });
});

// ---------------------------------------------------------------------------
// MonitorCreateForm
// ---------------------------------------------------------------------------

describe('MonitorCreateForm', () => {
  it('renders the slot meter and starts an owned monitor', async () => {
    setState({ usedSlots: 2, activeLimit: 5 });
    const onCreated = vi.fn();
    renderInRouter(
      <MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} onCreated={onCreated} />,
    );
    expect(screen.getByTestId('monitor-slot-meter')).toHaveTextContent('2 of 5');
    await userEvent.type(screen.getByTestId('monitor-owned-url'), 'https://example.com/pricing');
    await userEvent.click(screen.getByTestId('monitor-submit'));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm monitoring' }));
    await waitFor(() =>
      expect(api.createMonitor).toHaveBeenCalledWith(
        expect.objectContaining({ targetUrl: 'https://example.com/pricing', targetKind: 'owned' }),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('m9'));
  });

  it('rejects an invalid owned URL with an inline error', async () => {
    renderInRouter(<MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} />);
    await userEvent.type(screen.getByTestId('monitor-owned-url'), 'not-a-url');
    await userEvent.click(screen.getByTestId('monitor-submit'));
    expect(screen.getByTestId('monitor-inline-error')).toHaveTextContent(
      'Enter a full address that starts with http or https.',
    );
    expect(api.createMonitor).not.toHaveBeenCalled();
  });

  it('shows the empty competitor state and routes to management', async () => {
    const onManage = vi.fn();
    renderInRouter(<MonitorCreateForm siteId="s1" onManageCompetitors={onManage} />);
    await userEvent.click(screen.getByTestId('monitor-kind-competitor'));
    expect(screen.getByTestId('monitor-no-competitors')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('monitor-manage-competitors'));
    expect(onManage).toHaveBeenCalled();
  });

  it('requires a competitor selection, prefills its origin, and submits', async () => {
    setState({}, { profiles: [competitor('c1', 'rival.com')] });
    const onCreated = vi.fn();
    renderInRouter(
      <MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} onCreated={onCreated} />,
    );
    await userEvent.click(screen.getByTestId('monitor-kind-competitor'));
    // Submitting before selecting a competitor surfaces the inline error.
    await userEvent.click(screen.getByTestId('monitor-submit'));
    expect(screen.getByTestId('monitor-inline-error')).toHaveTextContent(
      'Choose a confirmed competitor first.',
    );
    await userEvent.click(screen.getByTestId('monitor-competitor-c1'));
    expect(screen.getByTestId('monitor-competitor-url')).toHaveValue('https://rival.com');
    // Refine the prefilled URL through the input onChange handler.
    await userEvent.type(screen.getByTestId('monitor-competitor-url'), '/pricing');
    await userEvent.click(screen.getByTestId('monitor-submit'));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm monitoring' }));
    await waitFor(() =>
      expect(api.createMonitor).toHaveBeenCalledWith(
        expect.objectContaining({ targetKind: 'competitor', targetUrl: 'https://rival.com/pricing' }),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('m9'));
  });

  it('accepts a validated competitor deep-link prefill', async () => {
    setState({}, { profiles: [competitor('c1', 'rival.com')] });
    renderInRouter(
      <MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} />,
      '/sites/s1?prefillTargetKind=competitor&prefillCompetitorId=c1&prefillTargetUrl=https%3A%2F%2Frival.com%2Fnews',
    );

    await waitFor(() => expect(screen.getByTestId('monitor-kind-competitor')).toBeChecked());
    expect(screen.getByTestId('monitor-competitor-c1')).toBeChecked();
    expect(screen.getByTestId('monitor-competitor-url')).toHaveValue('https://rival.com/news');
    await userEvent.click(screen.getByTestId('monitor-submit'));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm monitoring' }));
    await waitFor(() => expect(api.createMonitor).toHaveBeenCalled());
  });

  it('filters archived competitors out of the picker', async () => {
    setState({}, {
      profiles: [competitor('c1', 'rival.com', 'archived')],
    });
    renderInRouter(<MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} />);
    await userEvent.click(screen.getByTestId('monitor-kind-competitor'));
    expect(screen.getByTestId('monitor-no-competitors')).toBeInTheDocument();
  });

  it('disables submit and shows a hint when every slot is used (fallback limit)', () => {
    setState({ usedSlots: 5, activeLimit: 0 });
    renderInRouter(<MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} />);
    expect(screen.getByTestId('monitor-slots-full')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-submit')).toBeDisabled();
    // Fallback to CONTENT_MONITOR_ACTIVE_LIMIT (5) when the list has not loaded.
    expect(screen.getByTestId('monitor-slot-meter')).toHaveTextContent('5 of 5');
  });

  it('renders the destructive server alert and clears it on field edit', async () => {
    setState({ submitError: 'Blocked' });
    renderInRouter(<MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} />);
    expect(screen.getByTestId('monitor-server-error')).toHaveTextContent('Blocked');
    expect(screen.getByTestId('monitor-server-error')).toHaveClass('text-destructive');
    await userEvent.type(screen.getByTestId('monitor-owned-url'), 'h');
    expect(hooks.dispatch).toHaveBeenCalled();
  });

  it('accepts an http owned URL and skips reset/onCreated when the create is rejected', async () => {
    api.createMonitor.mockRejectedValueOnce(new Error('nope'));
    const onCreated = vi.fn();
    renderInRouter(
      <MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} onCreated={onCreated} />,
    );
    await userEvent.type(screen.getByTestId('monitor-owned-url'), 'http://example.com/x');
    await userEvent.click(screen.getByTestId('monitor-submit'));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm monitoring' }));
    await waitFor(() => expect(api.createMonitor).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByTestId('monitor-owned-url')).toHaveValue('http://example.com/x');
  });

  it('guards the submit handler while submitting or when slots are full', () => {
    // Slots full → the guard returns before dispatching a create.
    setState({ usedSlots: 5, activeLimit: 5 });
    const full = renderInRouter(<MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} />);
    fireEvent.submit(screen.getByTestId('monitor-create').querySelector('form')!);
    expect(api.createMonitor).not.toHaveBeenCalled();
    full.unmount();

    // Already submitting → the guard also returns early.
    setState({ submitting: true });
    renderInRouter(<MonitorCreateForm siteId="s1" onManageCompetitors={vi.fn()} />);
    fireEvent.submit(screen.getByTestId('monitor-create').querySelector('form')!);
    expect(api.createMonitor).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// MonitorList
// ---------------------------------------------------------------------------

function renderList(
  monitors: ContentMonitor[],
  extra: Partial<Parameters<typeof MonitorList>[0]> = {},
) {
  const props = {
    siteId: 's1',
    monitors,
    loading: false,
    loaded: true,
    error: '',
    onOpen: vi.fn(),
    onRetry: vi.fn(),
    filter: 'all' as const,
    onFilter: vi.fn(),
    ...extra,
  };
  return { props, ...renderInRouter(<MonitorList {...props} />) };
}

describe('MonitorList', () => {
  it('renders the filter bar and reports clicks', async () => {
    const onFilter = vi.fn();
    renderList([], { onFilter });
    await userEvent.click(screen.getByTestId('monitor-filter-active'));
    expect(onFilter).toHaveBeenCalledWith('active');
  });

  it('shows loading, error/retry, and empty states', async () => {
    const first = renderList([], { loading: true, loaded: false });
    expect(first.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    first.unmount();

    const onRetry = vi.fn();
    const second = renderList([], { error: 'network', onRetry });
    expect(screen.getByTestId('monitor-list-error')).toHaveTextContent('network');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    second.unmount();

    renderList([]);
    expect(screen.getByTestId('monitor-list-empty')).toBeInTheDocument();
  });

  it('renders each status with a safe target link and the right action', async () => {
    const onOpen = vi.fn();
    const rows = [
      monitor({ monitorId: 'a', status: 'active', lastCheckAt: '2026-07-20T00:00:00Z', lastMaterialChangeAt: '2026-07-19T00:00:00Z' }),
      monitor({ monitorId: 'p', status: 'paused' }),
      monitor({ monitorId: 'c', status: 'cap_paused' }),
      monitor({ monitorId: 'e', status: 'error', targetKind: 'competitor' }),
    ];
    renderList(rows, { onOpen });
    // active → pause; the rest → resume.
    expect(screen.getByTestId('monitor-pause-a')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-resume-p')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-resume-c')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-resume-e')).toBeInTheDocument();
    // safe target link.
    expect(screen.getByTestId('monitor-target-a')).toHaveAttribute(
      'rel',
      'nofollow ugc noopener noreferrer',
    );
    await userEvent.click(screen.getByTestId('monitor-view-a'));
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('pauses, resumes, and deletes a monitor with a confirm dialog', async () => {
    renderList([monitor({ monitorId: 'a', status: 'active' })]);
    await userEvent.click(screen.getByTestId('monitor-pause-a'));
    expect(api.pauseMonitor).toHaveBeenCalledWith('s1', 'a', expect.anything());

    renderList([monitor({ monitorId: 'p', status: 'paused' })]);
    await userEvent.click(screen.getByTestId('monitor-resume-p'));
    expect(api.resumeMonitor).toHaveBeenCalledWith('s1', 'p', expect.anything());

    renderList([monitor({ monitorId: 'd', status: 'active' })]);
    await userEvent.click(screen.getByTestId('monitor-delete-d'));
    await userEvent.click(screen.getByTestId('monitor-delete-confirm-d'));
    await waitFor(() =>
      expect(api.deleteMonitor).toHaveBeenCalledWith('s1', 'd', expect.anything()),
    );
    // A successful delete reloads the list.
    await waitFor(() => expect(api.listMonitors).toHaveBeenCalledWith('s1', 'all', expect.anything()));
  });

  it('keeps the dialog open and does not reload when the delete fails', async () => {
    api.deleteMonitor.mockRejectedValueOnce(new Error('nope'));
    renderList([monitor({ monitorId: 'd', status: 'active' })]);
    await userEvent.click(screen.getByTestId('monitor-delete-d'));
    await userEvent.click(screen.getByTestId('monitor-delete-confirm-d'));
    await waitFor(() => expect(api.deleteMonitor).toHaveBeenCalled());
    // A failed delete must NOT trigger the follow-up list reload.
    expect(api.listMonitors).not.toHaveBeenCalled();
  });

  it('surfaces the mutate error banner', () => {
    setState({ mutateError: 'action failed' });
    renderList([monitor()]);
    expect(screen.getByTestId('monitor-mutate-error')).toHaveTextContent('action failed');
  });
});

// ---------------------------------------------------------------------------
// ChangeFeed
// ---------------------------------------------------------------------------

describe('ChangeFeed', () => {
  it('shows the empty state and a safe source link', () => {
    renderInRouter(
      <ChangeFeed monitor={monitor()} feed={[]} nextCursor={null} loading={false} onLoadMore={vi.fn()} />,
    );
    expect(screen.getByTestId('monitor-feed-empty')).toBeInTheDocument();
    expect(screen.getByTestId('monitor-feed-source-link')).toHaveAttribute(
      'rel',
      'nofollow ugc noopener noreferrer',
    );
  });

  it('neutralises an unsafe source URL', () => {
    renderInRouter(
      <ChangeFeed
        monitor={monitor({ targetUrl: 'javascript:alert(1)' })}
        feed={[]}
        nextCursor={null}
        loading={false}
        onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByTestId('monitor-feed-source-link')).toHaveAttribute('href', '#');
  });

  it('renders diff text as an inert text node (XSS-safe) and an unknown kind', () => {
    const events = [
      feedEvent({ eventKey: 'e1', kind: 'change_detected', diffText: '<script>alert(1)</script> price changed' }),
      feedEvent({ eventKey: 'e2', kind: 'mystery', isoWeek: null, diffText: null }),
    ];
    const { container } = renderInRouter(
      <ChangeFeed monitor={monitor()} feed={events} nextCursor={null} loading={false} onLoadMore={vi.fn()} />,
    );
    const diff = screen.getByTestId('monitor-feed-diff-e1');
    expect(diff).toHaveTextContent('<script>alert(1)</script> price changed');
    expect(container.querySelector('script')).toBeNull();
    // Unknown kind → fallback label, no diff block.
    expect(screen.getByTestId('monitor-feed-e2')).toHaveTextContent('Update');
    expect(screen.queryByTestId('monitor-feed-diff-e2')).toBeNull();
  });

  it('loads more when a cursor is present', async () => {
    const onLoadMore = vi.fn();
    renderInRouter(
      <ChangeFeed
        monitor={monitor()}
        feed={[feedEvent()]}
        nextCursor="cur"
        loading={false}
        onLoadMore={onLoadMore}
      />,
    );
    await userEvent.click(screen.getByTestId('monitor-feed-load-more'));
    expect(onLoadMore).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// MonitorNotificationsToggle
// ---------------------------------------------------------------------------

describe('MonitorNotificationsToggle', () => {
  it('shows the skeleton while the preference loads', () => {
    setState({ notificationLoading: true, notificationPref: null });
    renderInRouter(<MonitorNotificationsToggle />);
    expect(screen.getByTestId('monitor-notifications-skeleton')).toBeInTheDocument();
  });

  it('renders the switch and toggles the preference', async () => {
    setState({ notificationPref: true });
    renderInRouter(<MonitorNotificationsToggle />);
    const sw = screen.getByTestId('monitor-notifications-switch');
    expect(sw).toBeChecked();
    await userEvent.click(sw);
    expect(api.patchMonitorNotifications).toHaveBeenCalledWith(false, expect.anything());
  });

  it('disables the switch while saving and surfaces an error', () => {
    setState({ notificationPref: false, notificationSaving: true, notificationError: 'save boom' });
    renderInRouter(<MonitorNotificationsToggle />);
    expect(screen.getByTestId('monitor-notifications-error')).toHaveTextContent('save boom');
    expect(screen.getByTestId('monitor-notifications-switch')).toBeDisabled();
  });
});
