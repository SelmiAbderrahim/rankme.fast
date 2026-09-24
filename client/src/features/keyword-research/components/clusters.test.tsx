/**
 * Clusters view, cluster cards, and decision dialogs.
 * Same mocked-hooks harness as workspace.test.tsx, plus the mocked sites
 * public API (the only cross-feature import the dialogs make).
 */
import type React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@shared/i18n/locales/en/keywordResearch.json';
import { initialState } from '../store/slice';
import type {
  ClusterDecisionResponse,
  ClusterRun,
  KeywordResearchState,
} from '../types';

const hooks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
}));

const api = vi.hoisted(() => ({
  runClustersRequest: vi.fn(),
  fetchClusterRunsRequest: vi.fn(),
  fetchClusterRunRequest: vi.fn(),
  postClusterDecisionRequest: vi.fn(),
  fetchKeywordPreviewRequest: vi.fn(),
  fetchGapRequest: vi.fn(),
  fetchOverviewRequest: vi.fn(),
  fetchTrendsRequest: vi.fn(),
}));

const sitesMock = vi.hoisted(() => ({
  loadSites: vi.fn(() => ({ type: 'sites/loadSites/mock' })),
  selectSites: (state: Record<string, unknown>) =>
    (state.sites as { items: unknown[] } | undefined)?.items ?? [],
  selectSitesLoading: (state: Record<string, unknown>) =>
    (state.sites as { loading: boolean } | undefined)?.loading ?? false,
  selectSitesLoaded: (state: Record<string, unknown>) =>
    (state.sites as { loaded: boolean } | undefined)?.loaded ?? false,
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@shared/hooks/redux', () => ({
  useAppDispatch: () => hooks.dispatch,
  useAppSelector: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(hooks.state),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, ...api };
});

vi.mock('@features/sites', () => sitesMock);
vi.mock('sonner', () => ({ toast: toastMock }));

vi.mock('./KeywordResearchPanel', () => ({
  KeywordResearchPanel: () => <div data-testid="mock-research-panel" />,
  IntentBadge: () => null,
  keywordSlug: (k: string) => k.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
}));

import { AcceptClusterDialog, newIdempotencyKey } from './AcceptClusterDialog';
import { ClusterCard } from './ClusterCard';
import { ClustersView, collectCandidatePhrases } from './ClustersView';
import { DismissClusterDialog } from './DismissClusterDialog';
import { decideCluster } from '../store/thunks';

const i18n = i18next.createInstance();
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { keywordResearch: en } } });

const RUN_ID = 'a'.repeat(64);
const CLUSTER_ID = 'c'.repeat(64);
const SITE_ID = 'f'.repeat(24);

/**
 * React props / fiber helpers (signals.test.tsx precedent). The dialogs are
 * controlled with `open` always true, so Radix only ever fires
 * `onOpenChange(false)`; the truthy side and disabled-button guards are only
 * reachable by grabbing the handlers off the DOM node's React internals.
 */
function getReactProps(el: Element): Record<string, unknown> {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
  if (!key) return {};
  return (el as unknown as Record<string, Record<string, unknown>>)[key] ?? {};
}

type FiberNode = { memoizedProps?: Record<string, unknown>; return: FiberNode | null };
function getFiberOnOpenChangeHandlers(el: Element): Array<(open: boolean) => void> {
  const handlers: Array<(open: boolean) => void> = [];
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
  if (!fiberKey) return handlers;
  let node: FiberNode | null =
    (el as unknown as Record<string, FiberNode>)[fiberKey] ?? null;
  while (node) {
    const handler = node.memoizedProps?.onOpenChange;
    if (typeof handler === 'function') {
      handlers.push(handler as (open: boolean) => void);
    }
    node = node.return;
  }
  return handlers;
}

function clusterRun(overrides: Partial<ClusterRun> = {}): ClusterRun {
  return {
    runId: RUN_ID,
    market: { locationCode: 2840, languageCode: 'en' },
    memberRefs: [
      { keyword: 'seo audit', source: 'vendor_cache', observedAt: '2026-07-01T00:00:00.000Z' },
      { keyword: 'rank tracker', source: 'history', observedAt: '2026-07-02T00:00:00.000Z' },
    ],
    clusters: [
      {
        clusterId: CLUSTER_ID,
        label: 'Audit tooling',
        memberKeywords: ['seo audit', 'rank tracker', 'orphan keyword'],
        suggestedRoute: 'brief',
        confidence: 'high',
        summedSearchVolume: 1400,
      },
      {
        clusterId: 'd'.repeat(64),
        label: 'Tracking topics',
        memberKeywords: ['rank tracker'],
        suggestedRoute: 'seo',
        confidence: 'low',
        summedSearchVolume: 500,
      },
    ],
    aiProfile: { name: 'keyword-clusters', version: '1' },
    costMicros: 900,
    createdAt: '2026-07-19T00:00:00.000Z',
    cached: false,
    ...overrides,
  };
}

function setState(
  overrides: Partial<KeywordResearchState> = {},
  extra: Record<string, unknown> = {},
) {
  hooks.state = {
    keywordResearch: { ...initialState, ...overrides },
    sites: {
      items: [
        {
          id: SITE_ID,
          url: 'https://mysite.example',
          domain: 'mysite.example',
          displayName: 'My Site',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      loading: false,
      loaded: true,
    },
    ...extra,
  };
}

function installThunkDispatch() {
  hooks.dispatch.mockImplementation((action: unknown) => {
    if (typeof action === 'function') {
      return (action as (...a: unknown[]) => unknown)(
        hooks.dispatch,
        () => hooks.state,
        undefined,
      );
    }
    return action;
  });
}

const LocationProbe = () => {
  const location = useLocation();
  return <span data-testid="probe-location">{location.pathname + location.search}</span>;
};

function renderInRouter(node: React.ReactNode, path = '/keyword-research?tab=clusters') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {node}
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  hooks.dispatch.mockReset();
  installThunkDispatch();
  for (const mock of Object.values(api)) mock.mockReset();
  sitesMock.loadSites.mockClear();
  toastMock.success.mockClear();
  api.fetchClusterRunsRequest.mockResolvedValue({ runs: [], nextCursor: null });
  api.fetchClusterRunRequest.mockResolvedValue(clusterRun());
  api.runClustersRequest.mockResolvedValue(clusterRun());
  api.postClusterDecisionRequest.mockResolvedValue(decisionResponse());
  setState();
});

function decisionResponse(
  overrides: Partial<ClusterDecisionResponse> = {},
): ClusterDecisionResponse {
  return {
    id: 'dec-1',
    runId: RUN_ID,
    clusterId: CLUSTER_ID,
    kind: 'accepted',
    siteId: SITE_ID,
    recommendationId: `keyword-cluster:${'0'.repeat(32)}`,
    createdAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// collectCandidatePhrases
// ---------------------------------------------------------------------------

describe('collectCandidatePhrases', () => {
  it('dedupes across sources with metrics > ideas > history precedence', () => {
    const out = collectCandidatePhrases({
      metrics: [{ keyword: 'alpha' }, { keyword: 'beta' }],
      ideas: [{ keyword: 'Beta' }, { keyword: 'gamma' }],
      historyPhrases: ['gamma', 'delta', '', '  '],
    });
    expect(out).toEqual([
      { phrase: 'alpha', sourceKey: 'metrics' },
      { phrase: 'beta', sourceKey: 'metrics' },
      { phrase: 'gamma', sourceKey: 'ideas' },
      { phrase: 'delta', sourceKey: 'history' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// ClusterCard
// ---------------------------------------------------------------------------

describe('ClusterCard', () => {
  const run = clusterRun();
  const cluster = run.clusters[0]!;

  it('renders label, AI-interpretation route badge, confidence, volume, and expandable cited members', () => {
    renderInRouter(
      <ClusterCard
        run={run}
        cluster={cluster}
        decision={undefined}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Audit tooling')).toBeInTheDocument();
    expect(screen.getByTestId(`kw-cluster-route-${CLUSTER_ID}`)).toHaveTextContent(
      'Content brief',
    );
    expect(screen.getByTestId('kw-provenance-chip-ai_interpretation')).toBeInTheDocument();
    expect(screen.getByTestId(`kw-cluster-confidence-${CLUSTER_ID}`)).toHaveTextContent(
      /high/i,
    );
    expect(screen.getByTestId(`kw-cluster-volume-${CLUSTER_ID}`)).toHaveTextContent(
      '1,400',
    );
    // Members hidden until expanded.
    expect(screen.queryByTestId(`kw-cluster-members-${CLUSTER_ID}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`kw-cluster-members-toggle-${CLUSTER_ID}`));
    const members = screen.getByTestId(`kw-cluster-members-${CLUSTER_ID}`);
    expect(members).toBeInTheDocument();
    // Cited stored refs (keyword + source + observedAt); a member without a
    // ref renders the keyword alone (no fabricated citation).
    expect(
      screen.getByTestId(`kw-cluster-member-${CLUSTER_ID}-seo-audit`),
    ).toHaveTextContent(/stored provider row/i);
    expect(
      screen.getByTestId(`kw-cluster-member-${CLUSTER_ID}-rank-tracker`),
    ).toHaveTextContent(/research history/i);
    expect(
      screen.getByTestId(`kw-cluster-member-${CLUSTER_ID}-orphan-keyword`).textContent,
    ).not.toMatch(/stored provider row|research history/i);
    // Collapse again.
    fireEvent.click(screen.getByTestId(`kw-cluster-members-toggle-${CLUSTER_ID}`));
    expect(screen.queryByTestId(`kw-cluster-members-${CLUSTER_ID}`)).toBeNull();
  });

  it('renders the seo route badge for the second cluster', () => {
    renderInRouter(
      <ClusterCard
        run={run}
        cluster={run.clusters[1]!}
        decision={undefined}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId(`kw-cluster-route-${'d'.repeat(64)}`),
    ).toHaveTextContent('SEO fix');
  });

  it('fires accept/dismiss callbacks and hides them once decided', () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    const { unmount } = renderInRouter(
      <ClusterCard
        run={run}
        cluster={cluster}
        decision={undefined}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId(`kw-cluster-accept-${CLUSTER_ID}`));
    expect(onAccept).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(`kw-cluster-dismiss-${CLUSTER_ID}`));
    expect(onDismiss).toHaveBeenCalled();
    unmount();
    renderInRouter(
      <ClusterCard
        run={run}
        cluster={cluster}
        decision={{
          pending: false,
          result: decisionResponse(),
          error: '',
          conflict: false,
        }}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId(`kw-cluster-decision-${CLUSTER_ID}`)).toHaveTextContent(
      'Accepted',
    );
    expect(screen.queryByTestId(`kw-cluster-accept-${CLUSTER_ID}`)).toBeNull();
  });

  it('renders the dismissed chip and the 409 conflict banner', () => {
    renderInRouter(
      <ClusterCard
        run={run}
        cluster={cluster}
        decision={{
          pending: false,
          result: decisionResponse({ kind: 'dismissed', siteId: null, recommendationId: null }),
          error: 'conflict msg',
          conflict: true,
        }}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId(`kw-cluster-decision-${CLUSTER_ID}`)).toHaveTextContent(
      'Dismissed',
    );
    expect(screen.getByTestId(`kw-cluster-conflict-${CLUSTER_ID}`)).toHaveTextContent(
      /different decision/i,
    );
  });

  it('renders malicious labels and member keywords as inert text', () => {
    const payload = '<script>window.__pwned=1</script>';
    renderInRouter(
      <ClusterCard
        run={run}
        cluster={{ ...cluster, label: payload, memberKeywords: [payload] }}
        decision={undefined}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getAllByText(payload).length).toBeGreaterThan(0);
    expect(
      (window as unknown as Record<string, unknown>).__pwned,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

describe('newIdempotencyKey', () => {
  it('produces unique keys and falls back without crypto.randomUUID', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    const original = crypto.randomUUID;
    // @ts-expect-error — simulate an older runtime
    crypto.randomUUID = undefined;
    try {
      expect(newIdempotencyKey()).toMatch(/^ik-/);
    } finally {
      crypto.randomUUID = original;
    }
  });
});

describe('AcceptClusterDialog', () => {
  const run = clusterRun();
  const cluster = run.clusters[0]!;

  it('lists owned sites, requires a selection, then posts the decision with a reserved key', async () => {
    const onClose = vi.fn();
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={vi.fn()}
      />,
    );
    const confirm = screen.getByTestId('kw-accept-confirm');
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByTestId(`kw-accept-site-${SITE_ID}`));
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.postClusterDecisionRequest).toHaveBeenCalledWith(
        RUN_ID,
        CLUSTER_ID,
        expect.objectContaining({ kind: 'accepted', siteId: SITE_ID }),
      ),
    );
    const body = api.postClusterDecisionRequest.mock.calls[0]![2] as {
      idempotencyKey: string;
    };
    expect(body.idempotencyKey.length).toBeGreaterThan(0);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it('loads sites when not yet loaded and shows loading/empty states', () => {
    setState({}, {
      sites: { items: [], loading: false, loaded: false },
    });
    const first = renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    expect(sitesMock.loadSites).toHaveBeenCalledWith({ direction: 'initial' });
    expect(screen.getByTestId('kw-accept-sites-empty')).toBeInTheDocument();
    first.unmount();
    setState({}, { sites: { items: [], loading: true, loaded: false } });
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kw-accept-sites-loading')).toBeInTheDocument();
  });

  it('idempotent replay: an accepted terminal decision shows both deep links', () => {
    setState({
      clusters: {
        ...initialState.clusters,
        decisions: {
          [`${RUN_ID}:${CLUSTER_ID}`]: {
            pending: false,
            result: decisionResponse(),
            error: '',
            conflict: false,
          },
        },
      },
    });
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kw-accept-replay-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('kw-accept-confirm')).toBeNull();
    expect(screen.getByTestId('kw-accept-open-recommendation')).toBeInTheDocument();
    expect(screen.getByTestId('kw-accept-open-actions')).toBeInTheDocument();
  });

  it('deep links follow the shipped CI format (?tab=content&recommendation=) and the generic actions tab', () => {
    const onClose = vi.fn();
    setState({
      clusters: {
        ...initialState.clusters,
        decisions: {
          [`${RUN_ID}:${CLUSTER_ID}`]: {
            pending: false,
            result: decisionResponse(),
            error: '',
            conflict: false,
          },
        },
      },
    });
    const view = renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('kw-accept-open-recommendation'));
    expect(screen.getByTestId('probe-location').textContent).toBe(
      `/sites/${SITE_ID}?tab=content&recommendation=${encodeURIComponent(`keyword-cluster:${'0'.repeat(32)}`)}`,
    );
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('kw-accept-open-actions'));
    expect(screen.getByTestId('probe-location').textContent).toBe(
      `/sites/${SITE_ID}?tab=actions`,
    );
  });

  it('a 409 closes the dialog and notifies the parent to refetch', async () => {
    const onClose = vi.fn();
    const onConflict = vi.fn();
    // The thunk rejects with status 409 — simulate through the real thunk by
    // returning a rejected decision action from dispatch.
    hooks.dispatch.mockImplementation((action: unknown) => {
      if (typeof action === 'function') {
        return Promise.resolve(
          decideCluster.rejected(
            null,
            'req',
            {
              runId: RUN_ID,
              clusterId: CLUSTER_ID,
              kind: 'accepted',
              siteId: SITE_ID,
              idempotencyKey: 'k',
            },
            { error: 'conflict', status: 409, runId: RUN_ID, clusterId: CLUSTER_ID },
          ),
        );
      }
      return action;
    });
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={onConflict}
      />,
    );
    fireEvent.click(screen.getByTestId(`kw-accept-site-${SITE_ID}`));
    fireEvent.click(screen.getByTestId('kw-accept-confirm'));
    await waitFor(() => expect(onConflict).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('a non-409 rejection keeps the dialog open without conflict handling', async () => {
    const onClose = vi.fn();
    const onConflict = vi.fn();
    const { ApiError } = await import('@shared/api/client');
    api.postClusterDecisionRequest.mockRejectedValue(
      new ApiError('bad', 400, { error: { message: 'Choose the site.' } }),
    );
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={onConflict}
      />,
    );
    fireEvent.click(screen.getByTestId(`kw-accept-site-${SITE_ID}`));
    fireEvent.click(screen.getByTestId('kw-accept-confirm'));
    await waitFor(() => expect(api.postClusterDecisionRequest).toHaveBeenCalled());
    expect(onConflict).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('escape closes via onOpenChange(false); onOpenChange(true) keeps it open', () => {
    const onClose = vi.fn();
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId('kw-accept-dialog');
    const handlers = getFiberOnOpenChangeHandlers(dialog);
    expect(handlers.length).toBeGreaterThan(0);
    act(() => {
      for (const h of handlers) h(true);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('the confirm guard never posts without a selected site (defensive)', () => {
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    const confirm = screen.getByTestId('kw-accept-confirm');
    expect(confirm).toBeDisabled();
    const onClick = getReactProps(confirm).onClick as () => void;
    act(() => {
      void onClick();
    });
    expect(api.postClusterDecisionRequest).not.toHaveBeenCalled();
  });

  it('replay deep links stay inert when the stored decision lost its site', () => {
    setState({
      clusters: {
        ...initialState.clusters,
        decisions: {
          [`${RUN_ID}:${CLUSTER_ID}`]: {
            pending: false,
            result: decisionResponse({ siteId: null, recommendationId: null }),
            error: '',
            conflict: false,
          },
        },
      },
    });
    const onClose = vi.fn();
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('kw-accept-open-recommendation'));
    fireEvent.click(screen.getByTestId('kw-accept-open-actions'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe-location').textContent).toBe(
      '/keyword-research?tab=clusters',
    );
  });

  it('open recommendation stays inert when the decision has no recommendation id', () => {
    setState({
      clusters: {
        ...initialState.clusters,
        decisions: {
          [`${RUN_ID}:${CLUSTER_ID}`]: {
            pending: false,
            result: decisionResponse({ recommendationId: null }),
            error: '',
            conflict: false,
          },
        },
      },
    });
    const onClose = vi.fn();
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('kw-accept-open-recommendation'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe-location').textContent).toBe(
      '/keyword-research?tab=clusters',
    );
  });

  it('shows the per-decision error and supports closing via the cancel button', () => {
    const onClose = vi.fn();
    setState({
      clusters: {
        ...initialState.clusters,
        decisions: {
          [`${RUN_ID}:${CLUSTER_ID}`]: {
            pending: false,
            result: null,
            error: 'save failed',
            conflict: false,
          },
        },
      },
    });
    renderInRouter(
      <AcceptClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kw-accept-error')).toHaveTextContent('save failed');
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('DismissClusterDialog', () => {
  const run = clusterRun();
  const cluster = run.clusters[0]!;

  it('a non-409 rejection keeps the dialog open without conflict handling', async () => {
    const onClose = vi.fn();
    const onConflict = vi.fn();
    const { ApiError } = await import('@shared/api/client');
    api.postClusterDecisionRequest.mockRejectedValue(
      new ApiError('bad', 400, { error: { message: 'nope' } }),
    );
    renderInRouter(
      <DismissClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={onConflict}
      />,
    );
    fireEvent.click(screen.getByTestId('kw-dismiss-confirm'));
    await waitFor(() => expect(api.postClusterDecisionRequest).toHaveBeenCalled());
    expect(onConflict).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('escape closes via onOpenChange(false); onOpenChange(true) keeps it open', () => {
    const onClose = vi.fn();
    renderInRouter(
      <DismissClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={vi.fn()}
      />,
    );
    const dialog = screen.getByTestId('kw-dismiss-dialog');
    const handlers = getFiberOnOpenChangeHandlers(dialog);
    expect(handlers.length).toBeGreaterThan(0);
    act(() => {
      for (const h of handlers) h(true);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('states terminality, confirms the dismissal, and toasts', async () => {
    const onClose = vi.fn();
    api.postClusterDecisionRequest.mockResolvedValueOnce(
      decisionResponse({ kind: 'dismissed', siteId: null, recommendationId: null }),
    );
    renderInRouter(
      <DismissClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kw-dismiss-dialog')).toHaveTextContent(/final/i);
    fireEvent.click(screen.getByTestId('kw-dismiss-confirm'));
    await waitFor(() =>
      expect(api.postClusterDecisionRequest).toHaveBeenCalledWith(
        RUN_ID,
        CLUSTER_ID,
        expect.objectContaining({ kind: 'dismissed' }),
      ),
    );
    const body = api.postClusterDecisionRequest.mock.calls[0]![2] as Record<string, unknown>;
    expect(body.siteId).toBeUndefined();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('replay: an already-dismissed cluster disables the confirm', () => {
    setState({
      clusters: {
        ...initialState.clusters,
        decisions: {
          [`${RUN_ID}:${CLUSTER_ID}`]: {
            pending: false,
            result: decisionResponse({ kind: 'dismissed', siteId: null, recommendationId: null }),
            error: '',
            conflict: false,
          },
        },
      },
    });
    renderInRouter(
      <DismissClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kw-dismiss-replay-hint')).toBeInTheDocument();
    expect(screen.getByTestId('kw-dismiss-confirm')).toBeDisabled();
  });

  it('a 409 conflict closes and notifies the parent; errors render inline', async () => {
    const onClose = vi.fn();
    const onConflict = vi.fn();
    hooks.dispatch.mockImplementation((action: unknown) => {
      if (typeof action === 'function') {
        return Promise.resolve(
          decideCluster.rejected(
            null,
            'req',
            { runId: RUN_ID, clusterId: CLUSTER_ID, kind: 'dismissed', idempotencyKey: 'k' },
            { error: 'conflict', status: 409, runId: RUN_ID, clusterId: CLUSTER_ID },
          ),
        );
      }
      return action;
    });
    renderInRouter(
      <DismissClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={onClose}
        onConflict={onConflict}
      />,
    );
    fireEvent.click(screen.getByTestId('kw-dismiss-confirm'));
    await waitFor(() => expect(onConflict).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    // Inline error branch.
    setState({
      clusters: {
        ...initialState.clusters,
        decisions: {
          [`${RUN_ID}:${CLUSTER_ID}`]: {
            pending: false,
            result: null,
            error: 'nope',
            conflict: false,
          },
        },
      },
    });
    renderInRouter(
      <DismissClusterDialog
        runId={RUN_ID}
        cluster={cluster}
        onClose={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    expect(screen.getByTestId('kw-dismiss-error')).toHaveTextContent('nope');
  });
});

// ---------------------------------------------------------------------------
// ClustersView
// ---------------------------------------------------------------------------

function metricsRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    keyword: `stored phrase ${i}`,
    searchVolume: 10,
    difficulty: 10,
    cpc: null,
    monthlySearches: [],
    cached: true,
    fetchedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
  }));
}

describe('ClustersView', () => {
  it('shows the no-candidates state when nothing is stored', () => {
    renderInRouter(<ClustersView />);
    expect(screen.getByTestId('kw-clusters-no-candidates')).toBeInTheDocument();
    // Stored runs list loads on mount.
    expect(api.fetchClusterRunsRequest).toHaveBeenCalled();
  });

  it('enforces the 10-phrase minimum with a visible count and bounds error', () => {
    setState({ metrics: metricsRows(12) });
    renderInRouter(<ClustersView />);
    expect(screen.getByTestId('kw-clusters-count')).toHaveTextContent(
      '0 selected (10–200 required)',
    );
    fireEvent.click(screen.getByTestId('kw-clusters-candidate-stored-phrase-0'));
    expect(screen.getByTestId('kw-clusters-count')).toHaveTextContent('1 selected');
    expect(screen.getByTestId('kw-clusters-bounds-error')).toBeInTheDocument();
    expect(screen.getByTestId('kw-clusters-run')).toBeDisabled();
    // Unchecking returns to zero (toggle-off branch) and hides the error.
    fireEvent.click(screen.getByTestId('kw-clusters-candidate-stored-phrase-0'));
    expect(screen.queryByTestId('kw-clusters-bounds-error')).toBeNull();
  });

  it('discloses the exact spend and the free-rerun copy', () => {
    setState({ metrics: metricsRows(10) });
    renderInRouter(<ClustersView />);
    const disclosure = screen.getByTestId('kw-clusters-disclosure');
    expect(disclosure).toHaveTextContent(/one AI summary unit/i);
    expect(disclosure).toHaveTextContent(/free/i);
  });

  it('runs a clustering pass with the selected phrases and writes ?run= into the URL', async () => {
    setState({ metrics: metricsRows(10) });
    renderInRouter(<ClustersView />);
    for (let i = 0; i < 10; i += 1) {
      fireEvent.click(screen.getByTestId(`kw-clusters-candidate-stored-phrase-${i}`));
    }
    expect(screen.getByTestId('kw-clusters-run')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('kw-clusters-run'));
    await waitFor(() =>
      expect(api.runClustersRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          locationCode: 2840,
          languageCode: 'en',
          phrases: expect.arrayContaining(['stored phrase 0', 'stored phrase 9']),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('probe-location').textContent).toContain(
        `run=${RUN_ID}`,
      ),
    );
  });

  it('restores a stored run from the URL (?run=) for free on reload', async () => {
    renderInRouter(
      <ClustersView />,
      `/keyword-research?tab=clusters&run=${RUN_ID}`,
    );
    await waitFor(() =>
      expect(api.fetchClusterRunRequest).toHaveBeenCalledWith(RUN_ID),
    );
  });

  it('renders the run result with cluster cards, cached disclosure, and the decision filter', () => {
    setState({
      metrics: metricsRows(10),
      clusters: {
        ...initialState.clusters,
        run: clusterRun({ cached: true }),
        runsLoaded: true,
        decisions: {
          [`${RUN_ID}:${CLUSTER_ID}`]: {
            pending: false,
            result: decisionResponse(),
            error: '',
            conflict: false,
          },
        },
      },
    });
    const setQuerySpy = vi.fn();
    renderInRouter(<ClustersView />);
    void setQuerySpy;
    expect(screen.getByTestId('kw-clusters-result')).toBeInTheDocument();
    expect(screen.getByTestId('kw-clusters-cached')).toBeInTheDocument();
    expect(screen.getByTestId(`kw-cluster-card-${CLUSTER_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`kw-cluster-card-${'d'.repeat(64)}`)).toBeInTheDocument();
    // URL-backed decision filter narrows the cards.
    fireEvent.click(screen.getByTestId('kw-clusters-decision-filter-accepted'));
    expect(screen.getByTestId('probe-location').textContent).toContain(
      'decision=accepted',
    );
  });

  it('applies the decision filter from the URL (accepted keeps only decided cards)', () => {
    setState({
      clusters: {
        ...initialState.clusters,
        run: clusterRun(),
        runsLoaded: true,
        decisions: {
          [`${RUN_ID}:${CLUSTER_ID}`]: {
            pending: false,
            result: decisionResponse(),
            error: '',
            conflict: false,
          },
        },
      },
    });
    renderInRouter(
      <ClustersView />,
      '/keyword-research?tab=clusters&decision=accepted',
    );
    expect(screen.getByTestId(`kw-cluster-card-${CLUSTER_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`kw-cluster-card-${'d'.repeat(64)}`)).toBeNull();
  });

  it('maps the pending decision filter to the export registry vocabulary', () => {
    setState({
      clusters: {
        ...initialState.clusters,
        run: clusterRun(),
        runsLoaded: true,
      },
    });
    renderInRouter(
      <ClustersView />,
      '/keyword-research?tab=clusters&decision=pending',
    );
    expect(screen.getByTestId(`kw-cluster-card-${CLUSTER_ID}`)).toBeInTheDocument();
  });

  it('shows the no-filter-match state when the filter excludes every card', () => {
    setState({
      clusters: { ...initialState.clusters, run: clusterRun(), runsLoaded: true },
    });
    renderInRouter(
      <ClustersView />,
      '/keyword-research?tab=clusters&decision=dismissed',
    );
    expect(screen.getByTestId('kw-clusters-no-filter-match')).toBeInTheDocument();
  });

  it('renders the evidence-only outcome distinctly (never "no topics exist")', () => {
    setState({
      clusters: {
        ...initialState.clusters,
        run: clusterRun({ clusters: [] }),
        runsLoaded: true,
      },
    });
    renderInRouter(<ClustersView />);
    const state = screen.getByTestId('kw-clusters-evidence-only');
    expect(state).toHaveTextContent(/without clusters/i);
    expect(state).toHaveTextContent(/does not mean no topics exist/i);
  });

  it('renders running, generic error, and detail-error states', () => {
    setState({ clusters: { ...initialState.clusters, running: true, runsLoaded: true } });
    const a = renderInRouter(<ClustersView />);
    expect(screen.getByTestId('kw-clusters-running')).toBeInTheDocument();
    a.unmount();
    setState({
      clusters: {
        ...initialState.clusters,
        runError: 'boom',
        runsLoaded: true,
      },
    });
    const c = renderInRouter(<ClustersView />);
    expect(screen.getByTestId('kw-clusters-error')).toHaveTextContent('boom');
    c.unmount();
    setState({
      clusters: { ...initialState.clusters, detailError: 'nf', runsLoaded: true },
    });
    const d = renderInRouter(<ClustersView />);
    expect(screen.getByTestId('kw-clusters-detail-error')).toHaveTextContent('nf');
    d.unmount();
    setState({
      clusters: { ...initialState.clusters, detailLoading: true, runsLoaded: true },
    });
    renderInRouter(<ClustersView />);
    expect(screen.getByTestId('kw-clusters-detail-loading')).toBeInTheDocument();
  });

  it('lists stored runs with cursor paging and opens one via the URL', async () => {
    setState({
      clusters: {
        ...initialState.clusters,
        runs: [clusterRun(), clusterRun({ runId: 'b'.repeat(64) })],
        runsLoaded: true,
        runsCursor: 'cur-1',
      },
    });
    renderInRouter(<ClustersView />);
    expect(screen.getByTestId(`kw-clusters-run-row-${RUN_ID}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`kw-clusters-open-${'b'.repeat(64)}`));
    expect(screen.getByTestId('probe-location').textContent).toContain(
      `run=${'b'.repeat(64)}`,
    );
    fireEvent.click(screen.getByTestId('kw-clusters-load-more'));
    await waitFor(() =>
      expect(api.fetchClusterRunsRequest).toHaveBeenCalledWith({ cursor: 'cur-1' }),
    );
  });

  it('renders the runs empty + error + loading states', () => {
    setState({ clusters: { ...initialState.clusters, runsLoaded: true } });
    const a = renderInRouter(<ClustersView />);
    expect(screen.getByTestId('kw-clusters-runs-empty')).toBeInTheDocument();
    a.unmount();
    setState({
      clusters: { ...initialState.clusters, runsError: 'list boom', runsLoaded: true },
    });
    const b = renderInRouter(<ClustersView />);
    expect(screen.getByTestId('kw-clusters-runs-error')).toHaveTextContent('list boom');
    b.unmount();
    setState({ clusters: { ...initialState.clusters, runsLoading: true } });
    renderInRouter(<ClustersView />);
    expect(screen.getByTestId('kw-clusters-runs-loading')).toBeInTheDocument();
  });

  it('opens the accept and dismiss dialogs from a cluster card', async () => {
    setState({
      clusters: { ...initialState.clusters, run: clusterRun(), runsLoaded: true },
    });
    renderInRouter(<ClustersView />);
    fireEvent.click(screen.getByTestId(`kw-cluster-accept-${CLUSTER_ID}`));
    expect(await screen.findByTestId('kw-accept-dialog')).toBeInTheDocument();
    // Close it, then open dismiss.
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByTestId(`kw-cluster-dismiss-${CLUSTER_ID}`));
    expect(await screen.findByTestId('kw-dismiss-dialog')).toBeInTheDocument();
    // Cancelling the dismiss dialog closes it without posting a decision.
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('kw-dismiss-dialog')).toBeNull(),
    );
    expect(api.postClusterDecisionRequest).not.toHaveBeenCalled();
  });

  it('offers stored research-history phrases as cluster candidates', () => {
    setState({
      history: [
        {
          id: 'h1',
          kind: 'overview',
          phrases: ['history phrase one', 'history phrase two'],
          locationCode: 2840,
          languageCode: 'en',
          resultCount: 2,
          cached: true,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    });
    renderInRouter(<ClustersView />);
    expect(
      screen.getByTestId('kw-clusters-candidate-history-phrase-one'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('kw-clusters-candidate-history-phrase-two'),
    ).toBeInTheDocument();
  });

  it('a decision 409 refetches the stored run so the view shows the latest state', async () => {
    setState({
      clusters: { ...initialState.clusters, run: clusterRun(), runsLoaded: true },
    });
    const { ApiError } = await import('@shared/api/client');
    api.postClusterDecisionRequest.mockRejectedValue(
      new ApiError('conflict', 409, null),
    );
    renderInRouter(<ClustersView />);
    fireEvent.click(screen.getByTestId(`kw-cluster-accept-${CLUSTER_ID}`));
    fireEvent.click(await screen.findByTestId(`kw-accept-site-${SITE_ID}`));
    fireEvent.click(screen.getByTestId('kw-accept-confirm'));
    // The dialog notifies the parent; ClustersView refetches the stored run.
    await waitFor(() =>
      expect(api.fetchClusterRunRequest).toHaveBeenCalledWith(RUN_ID),
    );
  });

  it('a dismiss 409 also refetches the stored run', async () => {
    setState({
      clusters: { ...initialState.clusters, run: clusterRun(), runsLoaded: true },
    });
    const { ApiError } = await import('@shared/api/client');
    api.postClusterDecisionRequest.mockRejectedValue(
      new ApiError('conflict', 409, null),
    );
    renderInRouter(<ClustersView />);
    fireEvent.click(screen.getByTestId(`kw-cluster-dismiss-${CLUSTER_ID}`));
    fireEvent.click(await screen.findByTestId('kw-dismiss-confirm'));
    await waitFor(() =>
      expect(api.fetchClusterRunRequest).toHaveBeenCalledWith(RUN_ID),
    );
  });

  it('skips the URL-run refetch when the stored run is already loaded', () => {
    setState({
      clusters: { ...initialState.clusters, run: clusterRun(), runsLoaded: true },
    });
    renderInRouter(
      <ClustersView />,
      `/keyword-research?tab=clusters&run=${RUN_ID}`,
    );
    // The run in the URL is already the loaded run — reload is free, no read.
    expect(api.fetchClusterRunRequest).not.toHaveBeenCalled();
    expect(screen.getByTestId(`kw-cluster-accept-${CLUSTER_ID}`)).toBeInTheDocument();
  });

  it('the run guard never spends when the selection is out of bounds (defensive)', () => {
    setState({ metrics: metricsRows(12) });
    renderInRouter(<ClustersView />);
    fireEvent.click(screen.getByTestId('kw-clusters-candidate-stored-phrase-0'));
    const runBtn = screen.getByTestId('kw-clusters-run');
    expect(runBtn).toBeDisabled();
    const onClick = getReactProps(runBtn).onClick as () => void;
    act(() => {
      void onClick();
    });
    expect(api.runClustersRequest).not.toHaveBeenCalled();
  });

  it('caps the selection at 200 phrases — extra clicks neither add nor remove', { timeout: 30000 }, () => {
    setState({ metrics: metricsRows(201) });
    renderInRouter(<ClustersView />);
    const candidates = Array.from({ length: 200 }, (_, index) =>
      screen.getByTestId(`kw-clusters-candidate-stored-phrase-${index}`),
    );
    const firstCandidate = screen.getByTestId('kw-clusters-candidate-stored-phrase-0');
    const lastCandidate = screen.getByTestId('kw-clusters-candidate-stored-phrase-199');
    const overflowCandidate = screen.getByTestId('kw-clusters-candidate-stored-phrase-200');
    const toggle = (candidate: HTMLElement) =>
      getReactProps(candidate).onChange as () => void;
    // Queue the component's real functional state updates in one React batch.
    // Firing 200 separate DOM events forces 200 complete 201-row rerenders and
    // makes this bound check depend on host speed rather than behavior.
    act(() => {
      for (const candidate of candidates) toggle(candidate)();
    });
    expect(screen.getByTestId('kw-clusters-count')).toHaveTextContent('200 selected');
    expect(firstCandidate).toBeChecked();
    expect(lastCandidate).toBeChecked();
    // The 201st phrase is silently ignored — the ceiling is a hard bound.
    act(() => {
      toggle(overflowCandidate)();
    });
    expect(screen.getByTestId('kw-clusters-count')).toHaveTextContent('200 selected');
    expect(overflowCandidate).not.toBeChecked();
  });

  it('a failed clustering run never writes ?run= into the URL', async () => {
    setState({ metrics: metricsRows(10) });
    const { ApiError } = await import('@shared/api/client');
    api.runClustersRequest.mockRejectedValue(
      new ApiError('down', 503, { error: { message: 'down' } }),
    );
    renderInRouter(<ClustersView />);
    for (let i = 0; i < 10; i += 1) {
      fireEvent.click(screen.getByTestId(`kw-clusters-candidate-stored-phrase-${i}`));
    }
    fireEvent.click(screen.getByTestId('kw-clusters-run'));
    await waitFor(() => expect(api.runClustersRequest).toHaveBeenCalled());
    expect(screen.getByTestId('probe-location').textContent).toBe(
      '/keyword-research?tab=clusters',
    );
  });
});
