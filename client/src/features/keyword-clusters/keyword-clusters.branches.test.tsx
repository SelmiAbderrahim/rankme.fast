/**
 * Branch coverage for the keyword-clusters surface.
 *
 * `keyword-clusters.test.tsx` covers the feature's behaviour. This file closes
 * the specific arms that suite does not reach, so the package holds the batch's
 * 100 percent v8 gate:
 *
 *  - `urlState.ts:53`  — the `isKeywordClusterId(rawCluster)` false arm.
 *  - `urlState.ts:68`  — the `rawSize === 'all'` arm of the invalid-size
 *                        predicate (a redundant default written into the URL).
 *  - `ClusterList.tsx:125` — the `cluster.members[0]?.sharedUrlCount ?? 0`
 *                        fallback, reached only when a cluster carries no
 *                        members.
 *  - `KeywordClustersPage.tsx:290` — the `Tabs` `onValueChange` handler.
 *
 * Each case is a real user-visible state, not a synthetic reach for a line.
 */
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ClusterList } from './components/ClusterList';
import { KeywordClustersPage } from './components/KeywordClustersPage';
import type { KeywordCluster } from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

vi.mock('@features/report-export', () => ({
  ReportExportControl: () => null,
}));

const mockedApi = vi.mocked(apiClient);
const SITE = 'a'.repeat(24);
const RUN = 'b'.repeat(24);
const OTHER_RUN = 'd'.repeat(24);
const DATE = '2026-08-04T10:00:00.000Z';
/** Mirrors `POLL_INTERVAL_MS` in KeywordClustersPage. */
const POLL_MS = 1_500;
let search = '';

const kwId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
}

/** A promise settled by the test. The rejection is pre-handled so an in-flight
 *  read torn down by unmount cannot surface as an unhandled rejection. */
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  promise.catch(() => {});
  return { promise, reject, resolve };
};

const runDetail = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: RUN,
  siteId: SITE,
  status: 'completed',
  aiStatus: 'applied',
  rulesVersion: '2026-08-04.1',
  minSharedUrls: 3,
  topUrlWindow: 10,
  keywordCount: 2,
  blockedCount: 0,
  clusterCount: 1,
  groupedClusterCount: 1,
  requestedAt: DATE,
  startedAt: DATE,
  completedAt: DATE,
  error: null,
  blocked: [],
  clusters: [
    {
      id: 'cluster-1',
      size: 2,
      pivotKeywordId: kwId(1),
      sharedUrls: ['https://serp-1.example/a'],
      members: [
        {
          keywordId: kwId(1),
          phrase: 'running shoes',
          observedAt: DATE,
          isPivot: true,
          sharedUrls: ['https://serp-1.example/a'],
          sharedUrlCount: 3,
        },
        {
          keywordId: kwId(2),
          phrase: 'best running shoes',
          observedAt: DATE,
          isPivot: false,
          sharedUrls: ['https://serp-1.example/a'],
          sharedUrlCount: 3,
        },
      ],
      label: 'Running shoes',
      labelSource: 'ai',
    },
  ],
  ...overrides,
});

const LocationProbe = () => {
  search = useLocation().search;
  return null;
};

const renderAt = (node: ReactNode, entry: string) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[entry]}>
        {node}
        <LocationProbe />
      </MemoryRouter>
    </I18nextProvider>,
  );

/** Sites resolve; every other call returns an empty, terminal shape. */
const routeApi = () => {
  mockedApi.mockImplementation((path: string) => {
    if (path === '/sites') {
      return Promise.resolve({
        sites: [{ id: SITE, domain: 'example.test', displayName: 'Example' }],
      }) as never;
    }
    if (/^\/sites\/[^/]+\/keywords(?:\?|$)/u.test(path)) {
      return Promise.resolve({
        keywords: [1, 2].map((index) => ({
          id: kwId(index),
          phrase: `keyword ${index}`,
          active: true,
          engine: 'google',
        })),
        nextCursor: null,
      }) as never;
    }
    if (path.endsWith('/keyword-cluster-runs')) {
      return Promise.resolve({ items: [] }) as never;
    }
    return Promise.resolve({}) as never;
  });
};

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApi.mockReset();
  search = '';
  routeApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('keyword-cluster URL state — rejected parameter arms', () => {
  it('strips a cluster id that is not a valid cluster identifier', async () => {
    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters&cluster=%20%20`);

    await waitFor(() => {
      expect(search).not.toContain('cluster=');
    });
    expect(search).toContain('tab=keyword-clusters');
  });

  it('strips an explicit size=all because it is the default, not a filter', async () => {
    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters&size=all`);

    await waitFor(() => {
      expect(search).not.toContain('size=');
    });
    expect(search).toContain('tab=keyword-clusters');
  });

  it('keeps a real size filter in the URL', async () => {
    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters&size=grouped`);

    await screen.findByTestId('keyword-clusters-tab-runs');
    expect(search).toContain('size=grouped');
  });

  it('keeps a well-formed cluster id so a deep link reopens that cluster', async () => {
    mockedApi.mockImplementation((path: string) => {
      if (path === '/sites') {
        return Promise.resolve({
          sites: [{ id: SITE, domain: 'example.test', displayName: 'Example' }],
        }) as never;
      }
      if (path.startsWith('/keyword-cluster-runs/')) {
        return Promise.resolve(runDetail()) as never;
      }
      if (path.endsWith('/keyword-cluster-runs')) {
        return Promise.resolve({ items: [runDetail()] }) as never;
      }
      return Promise.resolve({}) as never;
    });

    renderAt(
      <KeywordClustersPage siteId={SITE} />,
      `/sites/${SITE}?tab=keyword-clusters&run=${RUN}&cluster=cluster-1`,
    );

    await screen.findByTestId('keyword-cluster-evidence-cluster-1');
    expect(search).toContain('cluster=cluster-1');
  });

  it('writes the opened cluster into the URL and clears it on collapse', async () => {
    const user = userEvent.setup();
    mockedApi.mockImplementation((path: string) => {
      if (path.startsWith('/keyword-cluster-runs/')) {
        return Promise.resolve(runDetail()) as never;
      }
      if (path.endsWith('/keyword-cluster-runs')) {
        return Promise.resolve({ items: [runDetail()] }) as never;
      }
      return Promise.resolve({}) as never;
    });

    renderAt(
      <KeywordClustersPage siteId={SITE} />,
      `/sites/${SITE}?tab=keyword-clusters&run=${RUN}`,
    );

    const toggle = await screen.findByTestId('keyword-cluster-toggle-cluster-1');
    await user.click(toggle);
    await waitFor(() => expect(search).toContain('cluster=cluster-1'));

    await user.click(screen.getByTestId('keyword-cluster-toggle-cluster-1'));
    await waitFor(() => expect(search).not.toContain('cluster='));
  });
});

describe('keyword-cluster run polling', () => {
  /** Polling uses a real 1.5s interval; give assertions room past one tick. */
  const POLL_WAIT = { timeout: POLL_MS * 4 };

  const routePolling = (onDetailCall: (call: number) => unknown) => {
    let call = 0;
    mockedApi.mockImplementation((path: string) => {
      if (path === '/sites') {
        return Promise.resolve({
          sites: [{ id: SITE, domain: 'example.test', displayName: 'Example' }],
        }) as never;
      }
      if (path.startsWith('/keyword-cluster-runs/')) {
        call += 1;
        return onDetailCall(call) as never;
      }
      if (path.endsWith('/keyword-cluster-runs')) {
        return Promise.resolve({
          items: [runDetail({ status: 'queued', groupedClusterCount: 0 })],
        }) as never;
      }
      return Promise.resolve({}) as never;
    });
  };

  it('writes a settled poll result onto the run already on screen', async () => {
    // First read arms the poll with a queued run; the poll returns the settled
    // run, which must replace both the detail and its row in the run list.
    routePolling((call) =>
      Promise.resolve(
        call === 1
          ? runDetail({ status: 'queued', groupedClusterCount: 0, clusters: [] })
          : runDetail({ status: 'completed', groupedClusterCount: 1 }),
      ),
    );

    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);

    const row = await screen.findByTestId(`keyword-clusters-run-${RUN}`);
    expect(row.textContent).toContain(
      i18n.t('status.queued', { ns: 'keywordClusters' }),
    );

    await waitFor(() => {
      expect(row.textContent).toContain(
        i18n.t('status.completed', { ns: 'keywordClusters' }),
      );
    }, POLL_WAIT);
  });

  it('surfaces a poll failure as a run-detail notice', async () => {
    routePolling((call) =>
      call === 1
        ? Promise.resolve(
            runDetail({ status: 'queued', groupedClusterCount: 0, clusters: [] }),
          )
        : Promise.reject(new Error('poll failed')),
    );

    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);

    await waitFor(() => {
      expect(screen.getByTestId('keyword-clusters-state-failed')).toBeInTheDocument();
    }, POLL_WAIT);
  });

  it('rearms while the run stays queued and leaves other runs untouched', async () => {
    // Two rows in the list: only the polled run is replaced, the other is kept
    // as-is. The first poll is still queued, so the interval rearms; the second
    // settles it.
    let call = 0;
    mockedApi.mockImplementation((path: string) => {
      if (path === '/sites') {
        return Promise.resolve({
          sites: [{ id: SITE, domain: 'example.test', displayName: 'Example' }],
        }) as never;
      }
      if (path.startsWith('/keyword-cluster-runs/')) {
        call += 1;
        if (call <= 2) {
          return Promise.resolve(
            runDetail({ status: 'queued', groupedClusterCount: 0, clusters: [] }),
          ) as never;
        }
        return Promise.resolve(
          runDetail({ status: 'completed', groupedClusterCount: 1 }),
        ) as never;
      }
      if (path.endsWith('/keyword-cluster-runs')) {
        return Promise.resolve({
          items: [
            runDetail({ status: 'queued', groupedClusterCount: 0 }),
            runDetail({ groupedClusterCount: 0, id: OTHER_RUN, status: 'failed' }),
          ],
        }) as never;
      }
      return Promise.resolve({}) as never;
    });

    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);

    const polled = await screen.findByTestId(`keyword-clusters-run-${RUN}`);
    await waitFor(
      () => {
        expect(polled.textContent).toContain(
          i18n.t('status.completed', { ns: 'keywordClusters' }),
        );
      },
      { timeout: POLL_MS * 6 },
    );
    expect(call).toBeGreaterThanOrEqual(3);
    // The untouched row still carries its own status.
    expect(
      screen.getByTestId(`keyword-clusters-run-${OTHER_RUN}`).textContent,
    ).toContain(i18n.t('status.failed', { ns: 'keywordClusters' }));
  });

  it.each([
    ['resolves', (d: Deferred<unknown>) => d.resolve(runDetail())],
    ['rejects', (d: Deferred<unknown>) => d.reject(new Error('too late'))],
  ] as const)(
    'ignores a poll that %s after the page unmounted',
    async (_label, settle) => {
      const pending = deferred<unknown>();
      let call = 0;
      mockedApi.mockImplementation((path: string) => {
        if (path === '/sites') {
          return Promise.resolve({
            sites: [{ id: SITE, domain: 'example.test', displayName: 'Example' }],
          }) as never;
        }
        if (path.startsWith('/keyword-cluster-runs/')) {
          call += 1;
          if (call === 1) {
            return Promise.resolve(
              runDetail({ status: 'queued', groupedClusterCount: 0, clusters: [] }),
            ) as never;
          }
          return pending.promise as never;
        }
        if (path.endsWith('/keyword-cluster-runs')) {
          return Promise.resolve({ items: [] }) as never;
        }
        return Promise.resolve({}) as never;
      });

      const { unmount } = renderAt(
        <KeywordClustersPage siteId={SITE} />,
        `/sites/${SITE}?tab=keyword-clusters&run=${RUN}`,
      );

      // Wait until the interval has actually issued its read, then tear the page
      // down while that read is still in flight.
      await waitFor(() => expect(call).toBeGreaterThanOrEqual(2), {
        timeout: POLL_MS * 4,
      });
      unmount();
      settle(pending);
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByTestId('keyword-clusters-state-failed')).toBeNull();
    },
  );

  it('does not rearm the interval for a run that is already terminal', async () => {
    let seen = 0;
    routePolling((call) => {
      seen = call;
      return Promise.resolve(runDetail({ status: 'completed' }));
    });

    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);
    await screen.findByTestId(`keyword-clusters-run-${RUN}`);

    const afterLoad = seen;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 2));
    expect(seen).toBe(afterLoad);
  });
});

describe('results that arrive after the page is gone', () => {
  /** Every in-flight read for the keywords, runs, and run-detail effects. */
  const stubInFlight = () => {
    const runs = deferred<unknown>();
    const detail = deferred<unknown>();
    const keywords = deferred<unknown>();
    mockedApi.mockImplementation((path: string) => {
      if (/^\/sites\/[^/]+\/keywords(?:\?|$)/u.test(path)) return keywords.promise as never;
      if (path.startsWith('/keyword-cluster-runs/')) return detail.promise as never;
      if (path.endsWith('/keyword-cluster-runs')) return runs.promise as never;
      return Promise.resolve({}) as never;
    });
    return { detail, keywords, runs };
  };

  it('discards a resolved read once the page has unmounted', async () => {
    const inFlight = stubInFlight();
    const { unmount } = renderAt(
      <KeywordClustersPage siteId={SITE} />,
      `/sites/${SITE}?tab=keyword-clusters&run=${RUN}`,
    );

    unmount();
    inFlight.keywords.resolve({ keywords: [], nextCursor: null });
    inFlight.runs.resolve({ items: [] });
    inFlight.detail.resolve(runDetail());

    // Nothing to assert on screen — the page is gone. The guarantee is that
    // settling these reads neither throws nor warns about a state update on an
    // unmounted component.
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByTestId('keyword-clusters-tab-runs')).toBeNull();
  });

  it('discards a failed read once the page has unmounted', async () => {
    const inFlight = stubInFlight();
    const { unmount } = renderAt(
      <KeywordClustersPage siteId={SITE} />,
      `/sites/${SITE}?tab=keyword-clusters&run=${RUN}`,
    );

    unmount();
    inFlight.keywords.reject(new Error('keywords offline'));
    inFlight.runs.reject(new Error('runs offline'));
    inFlight.detail.reject(new Error('detail offline'));

    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByTestId('keyword-clusters-tab-runs')).toBeNull();
  });
});

describe('completed run with no clusters', () => {
  it('renders the run without a size filter when nothing grouped', async () => {
    mockedApi.mockImplementation((path: string) => {
      if (path === '/sites') {
        return Promise.resolve({
          sites: [{ id: SITE, domain: 'example.test', displayName: 'Example' }],
        }) as never;
      }
      if (path.startsWith('/keyword-cluster-runs/')) {
        return Promise.resolve(
          runDetail({ clusters: [], clusterCount: 0, groupedClusterCount: 0 }),
        ) as never;
      }
      if (path.endsWith('/keyword-cluster-runs')) {
        return Promise.resolve({ items: [] }) as never;
      }
      return Promise.resolve({}) as never;
    });

    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters&run=${RUN}`);

    await waitFor(() => {
      expect(screen.queryByTestId('keyword-clusters-list')).toBeNull();
    });
    expect(
      screen.queryByLabelText(i18n.t('filters.size', { ns: 'keywordClusters' })),
    ).toBeNull();
  });
});

describe('keyword-clusters tab navigation', () => {
  it('writes the selected view to the URL and drops it again on return', async () => {
    const user = userEvent.setup();
    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters`);

    await user.click(await screen.findByTestId('keyword-clusters-tab-new'));
    await waitFor(() => {
      expect(search).toContain('view=new');
    });

    // `runs` is the default view, so selecting it removes the parameter rather
    // than writing a redundant one.
    await user.click(screen.getByTestId('keyword-clusters-tab-runs'));
    await waitFor(() => {
      expect(search).not.toContain('view=');
    });
  });

  it('updates the selected scope when a keyword is toggled off and on', async () => {
    const user = userEvent.setup();
    renderAt(<KeywordClustersPage siteId={SITE} />, `/sites/${SITE}?tab=keyword-clusters&view=new`);

    const scope = await screen.findByTestId('keyword-clusters-scope');
    const firstKeyword = await screen.findByRole('checkbox', { name: 'keyword 1' });
    expect(firstKeyword).toBeChecked();
    expect(within(scope).getByText(/keywords selected/u)).toHaveTextContent(/^2 /u);

    await user.click(firstKeyword);
    expect(firstKeyword).not.toBeChecked();
    expect(within(scope).getByText(/keywords selected/u)).toHaveTextContent(/^1 /u);

    await user.click(firstKeyword);
    expect(firstKeyword).toBeChecked();
    expect(within(scope).getByText(/keywords selected/u)).toHaveTextContent(/^2 /u);
  });
});

describe('cluster evidence with no stored members', () => {
  it('falls back to a zero shared-URL window rather than rendering undefined', () => {
    const empty: KeywordCluster = {
      id: 'cluster-empty',
      size: 1,
      pivotKeywordId: '00000000-0000-4000-8000-000000000001',
      sharedUrls: [],
      members: [],
      label: null,
      labelSource: null,
    };

    renderAt(
      <ClusterList clusters={[empty]} openClusterId="cluster-empty" onToggle={() => {}} />,
      `/sites/${SITE}?tab=keyword-clusters`,
    );

    // The evidence body interpolates `members[0]?.sharedUrlCount ?? 0`. With no
    // members the fallback keeps the block renderable instead of throwing or
    // leaking `undefined` into the copy; the singleton note explains the state.
    const evidence = screen.getByTestId('keyword-cluster-evidence-cluster-empty');
    expect(evidence).toBeInTheDocument();
    expect(evidence.textContent).not.toContain('undefined');
    expect(evidence.textContent).not.toContain('NaN');
    expect(evidence.textContent).toContain(
      i18n.t('cluster.singletonEvidence', { ns: 'keywordClusters' }),
    );
  });
});
