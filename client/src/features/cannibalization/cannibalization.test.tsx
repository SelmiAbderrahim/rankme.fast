import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { CannibalizationPage } from './components/CannibalizationPage';
import { QueryDrillDown } from './components/QueryDrillDown';
import { StateNotice } from './components/StateNotice';
import { cannibalizationReducer } from './store/slice';
import {
  selectCannibalizationDetail,
  selectCannibalizationGscConnected,
  selectCannibalizationReports,
  selectCannibalizationSitesError,
} from './store/selectors';
import { toCannibalizationGate } from './gate';
import { initialCannibalizationState, type CannibalizationCandidate } from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const SITE_ID = 'a'.repeat(24);
const REPORT_ID = 'b'.repeat(24);

const candidate = (
  overrides: Partial<CannibalizationCandidate> = {},
): CannibalizationCandidate => ({
  id: 'cannibal-0',
  query: 'seo audit tool',
  confidence: 'high',
  sourceKind: 'first_party',
  windowDays: 28,
  snapshotDate: '2026-07-01',
  totalClicks: 180,
  totalImpressions: 5400,
  primaryUrl: 'https://example.test/seo-audit',
  primaryReason: 'most_clicks',
  pages: [
    {
      url: 'https://example.test/seo-audit',
      clicks: 120,
      impressions: 3000,
      position: 4.1,
      clickShare: 120 / 180,
      impressionShare: 3000 / 5400,
      isPrimary: true,
    },
    {
      url: 'https://example.test/blog/seo-audit-guide',
      clicks: 60,
      impressions: 2400,
      position: 9.3,
      clickShare: 60 / 180,
      impressionShare: 2400 / 5400,
      isPrimary: false,
    },
  ],
  ...overrides,
});

const summary = () => ({
  id: REPORT_ID,
  siteId: SITE_ID,
  windowDays: 28,
  snapshotDate: '2026-07-01',
  generatedAt: '2026-07-02T10:00:00.000Z',
  queriesAnalyzed: 2,
  candidateCount: 1,
  pagesInvolved: 2,
});

const detail = (candidates = [candidate()]) => ({
  ...summary(),
  candidateCount: candidates.length,
  candidates,
});

let search = '';
const LocationProbe = () => {
  search = useLocation().search;
  return null;
};

const renderPage = (entry = `/sites/${SITE_ID}?tab=cannibalization`) => {
  search = '';
  const store = configureStore({ reducer: { cannibalization: cannibalizationReducer } });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[entry]}>
            <CannibalizationPage siteId={SITE_ID} />
            <LocationProbe />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

interface Handlers {
  connection?: () => unknown;
  list?: () => unknown;
  preview?: () => unknown;
  generate?: () => unknown;
  report?: () => unknown;
}

/** Route each mocked call by path so ordering never matters. */
const routeApi = (handlers: Handlers = {}) => {
  mockedApiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === `/sites/${SITE_ID}/google/configuration`) {
      return Promise.resolve(
        handlers.connection?.() ?? {
          configuration: {
            connection: {
              status: 'connected',
              scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
            },
            gsc: { propertyUrl: 'sc-domain:example.test' },
          },
        },
      ) as never;
    }
    if (path.startsWith('/sites/') && path.includes('/cannibalization-reports/preview')) {
      return Promise.resolve(
        handlers.preview?.() ?? {},
      ) as never;
    }
    if (
      path.startsWith('/sites/') &&
      path.includes('/cannibalization-reports') &&
      init?.method === 'POST'
    ) {
      return Promise.resolve(handlers.generate?.() ?? detail()) as never;
    }
    if (path.startsWith('/sites/') && path.includes('/cannibalization-reports')) {
      return Promise.resolve(handlers.list?.() ?? { items: [summary()] }) as never;
    }
    if (path.startsWith('/cannibalization-reports/')) {
      return Promise.resolve(handlers.report?.() ?? detail()) as never;
    }
    throw new Error(`unexpected path ${path}`);
  });
};

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CannibalizationPage — reports tab', () => {
  it('loads sites and the stored report list', async () => {
    routeApi();
    renderPage();
    expect(await screen.findByTestId('cannibalization-report-list')).toBeInTheDocument();
    expect(
      screen.getByTestId(`cannibalization-report-row-${REPORT_ID}`),
    ).toBeInTheDocument();
  });

  it('opens a stored report, filters by confidence and drills into one query', async () => {
    const user = userEvent.setup();
    routeApi({
      report: () =>
        detail([candidate(), candidate({ id: 'cannibal-1', query: 'rank tracker', confidence: 'medium' })]),
    });
    renderPage();
    await user.click(await screen.findByTestId(`cannibalization-open-${REPORT_ID}`));

    expect(await screen.findByTestId('cannibalization-candidates')).toBeInTheDocument();
    expect(screen.getByTestId('cannibalization-candidate-cannibal-0')).toBeInTheDocument();
    expect(screen.getByTestId('cannibalization-candidate-cannibal-1')).toBeInTheDocument();
    expect(screen.getByTestId('cannibalization-provenance').textContent).toContain(
      '2026-07-01',
    );

    await user.click(screen.getByTestId('cannibalization-inspect-cannibal-0'));
    expect(await screen.findByTestId('cannibalization-drilldown')).toBeInTheDocument();
    expect(screen.getByTestId('cannibalization-drilldown-query').textContent).toBe(
      'seo audit tool',
    );
    expect(
      screen.getByTestId('cannibalization-drilldown-recommendation').textContent,
    ).toContain('https://example.test/seo-audit');
    expect(search).toContain('query=cannibal-0');
  });

  it('renders the empty state when the site has no stored reports', async () => {
    routeApi({ list: () => ({ items: [] }) });
    renderPage();
    expect(await screen.findByTestId('cannibalization-state-empty')).toBeInTheDocument();
  });

  it('renders the waiting-for-sync state from a 409', async () => {
    routeApi({
      list: () => {
        throw new ApiError('conflict', 409, {
          error: { message: 'No rows yet — they arrive with the next sync.' },
        });
      },
    });
    renderPage();
    const notice = await screen.findByTestId('cannibalization-state-awaitingSync');
    expect(notice.textContent).toContain('next sync');
  });

  it('renders a non-sync list refusal such as the kill switch', async () => {
    routeApi({
      list: () => {
        throw new ApiError('off', 503, {
          error: { message: 'Cannibalization reports are temporarily unavailable.' },
        });
      },
    });
    renderPage();
    expect(
      await screen.findByTestId('cannibalization-state-disabled'),
    ).toBeInTheDocument();
  });

  it('renders the Search Console connection state only when a site exists but GSC does not', async () => {
    routeApi({
      connection: () => ({
        configuration: { connection: null, gsc: { propertyUrl: null } },
      }),
    });
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`);
    const notice = await screen.findByTestId('cannibalization-state-disconnected');
    expect(notice).toHaveTextContent('Connect Search Console');
    expect(screen.getByRole('link', { name: 'Connect Search Console' })).toHaveAttribute(
      'href',
      `/sites/${SITE_ID}?tab=google`,
    );
  });

  it('renders the detail refusal when a stored report is gone', async () => {
    const user = userEvent.setup();
    routeApi({
      report: () => {
        throw new ApiError('gone', 404, { error: { message: 'Report not found.' } });
      },
    });
    renderPage();
    await user.click(await screen.findByTestId(`cannibalization-open-${REPORT_ID}`));
    expect(
      await screen.findByTestId('cannibalization-state-notFound'),
    ).toBeInTheDocument();
  });

  it('shows the empty state when a confidence filter matches nothing', async () => {
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&report=${REPORT_ID}&confidence=low`);
    expect(await screen.findByTestId('cannibalization-state-empty')).toBeInTheDocument();
  });
});

describe('CannibalizationPage — new report tab', () => {
  it('discloses that usage is not metered', async () => {
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`);
    await userEvent.click(await screen.findByTestId('cannibalization-preview-button'));
    expect(await screen.findByTestId('cannibalization-preview')).toHaveTextContent(
      'Plan usage limits are not metered in self-hosted mode.',
    );
  });

  it('previews the unit, then generates and opens the fresh report', async () => {
    const user = userEvent.setup();
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`);

    await user.click(await screen.findByTestId('cannibalization-preview-button'));
    expect(await screen.findByTestId('cannibalization-preview')).toBeInTheDocument();

    await user.click(screen.getByTestId('cannibalization-generate-button'));
    await waitFor(() => expect(search).toContain(`report=${REPORT_ID}`));
    expect(await screen.findByTestId('cannibalization-candidates')).toBeInTheDocument();
  });

  it('switches the window through the URL', async () => {
    const user = userEvent.setup();
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`);
    await user.click(await screen.findByLabelText('7 days'));
    await waitFor(() => expect(search).toContain('window=7'));
  });

  it('renders the server refusal from a failed generate', async () => {
    const user = userEvent.setup();
    routeApi({
      generate: () => {
        throw new ApiError('failed', 500, {
          error: { message: 'The report could not be generated.' },
        });
      },
    });
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`);
    await user.click(await screen.findByTestId('cannibalization-preview-button'));
    await user.click(await screen.findByTestId('cannibalization-generate-button'));
    expect(await screen.findByTestId('cannibalization-state-failed')).toHaveTextContent(
      'The report could not be generated.',
    );
  });

  it('renders the kill-switch refusal from a 503 on preview', async () => {
    const user = userEvent.setup();
    routeApi({
      preview: () => {
        throw new ApiError('off', 503, {
          error: { message: 'Cannibalization reports are temporarily unavailable.' },
        });
      },
    });
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`);
    await user.click(await screen.findByTestId('cannibalization-preview-button'));
    expect(
      await screen.findByTestId('cannibalization-state-disabled'),
    ).toBeInTheDocument();
  });
});

describe('URL-backed controls', () => {
  it('writes the confidence filter and the view into the URL', async () => {
    const user = userEvent.setup();
    routeApi();
    renderPage();
    await screen.findByTestId('cannibalization-report-list');

    await user.click(screen.getByRole('combobox', { name: 'Confidence' }));
    await user.click(await screen.findByRole('option', { name: 'High' }));
    await waitFor(() => expect(search).toContain('confidence=high'));

    await user.click(screen.getByTestId('cannibalization-tab-new'));
    await waitFor(() => expect(search).toContain('view=new'));
  });

});

describe('URL state normalization', () => {
  it('drops invalid params back out of the address bar', async () => {
    routeApi();
    renderPage(
      `/sites/${SITE_ID}?tab=cannibalization&view=bogus&window=13&confidence=nope&report=xx&query=zz`,
    );
    await waitFor(() => {
      expect(search).not.toContain('view=');
      expect(search).not.toContain('window=');
      expect(search).not.toContain('confidence=');
      expect(search).not.toContain('report=');
      expect(search).not.toContain('query=');
    });
  });

  it('spells a default value as an absent param', async () => {
    routeApi();
    renderPage(
      `/sites/${SITE_ID}?tab=cannibalization&window=28&confidence=all&view=reports`,
    );
    await waitFor(() => {
      expect(search).not.toContain('window=');
      expect(search).not.toContain('confidence=');
    });
  });
});

describe('hostile content stays inert', () => {
  it('renders a script-shaped query as text and neutralizes an unsafe page href', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <QueryDrillDown
            candidate={candidate({
              query: '<script>alert(1)</script>',
              primaryUrl: 'javascript:alert(1)',
              pages: [
                {
                  url: 'javascript:alert(1)',
                  clicks: 1,
                  impressions: 2,
                  position: 3,
                  clickShare: 0.5,
                  impressionShare: 0.5,
                  isPrimary: true,
                },
                {
                  url: 'https://example.test/safe',
                  clicks: 1,
                  impressions: 2,
                  position: 4,
                  clickShare: 0.5,
                  impressionShare: 0.5,
                  isPrimary: false,
                },
              ],
            })}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByTestId('cannibalization-drilldown-query').textContent).toBe(
      '<script>alert(1)</script>',
    );
    expect(document.querySelector('script')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links[0]?.getAttribute('href')).toBe('#');
    expect(links[0]?.getAttribute('rel')).toBe('nofollow ugc noopener noreferrer');
    expect(links[1]?.getAttribute('href')).toBe('https://example.test/safe');
  });
});

describe('Arabic RTL', () => {
  it('renders the localized title under the Arabic dictionary', async () => {
    await changeLanguage('ar');
    routeApi();
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'تنافس الكلمات المفتاحية' }),
    ).toBeInTheDocument();
    await changeLanguage('en');
  });
});

describe('prerequisite load failure', () => {
  it('records the localized fallback when the GSC link cannot be read', async () => {
    const { store } = (() => {
      routeApi({
        connection: () => {
          throw new ApiError('down', 500, {});
        },
      });
      return renderPage();
    })();
    await waitFor(() =>
      expect(selectCannibalizationSitesError(store.getState() as never)).not.toBe(''),
    );
  });
});

describe('gate mapping + selectors', () => {
  it('falls back to the generic failure for a non-API error', () => {
    expect(toCannibalizationGate(new Error('boom'), 'fallback')).toEqual({
      kind: 'failed',
      message: 'fallback',
    });
  });

  it('falls back when the API error body carries no message', () => {
    expect(toCannibalizationGate(new ApiError('x', 429, {}), 'fallback')).toEqual({
      kind: 'rateLimited',
      message: 'fallback',
    });
  });

  it('maps an unmapped status onto the catch-all', () => {
    expect(
      toCannibalizationGate(new ApiError('x', 500, { error: { message: 'nope' } }), 'f'),
    ).toEqual({ kind: 'failed', message: 'nope' });
  });

  it('selectors fall back to the initial state before the slice is injected', () => {
    const bare = { other: 1 } as never;
    expect(selectCannibalizationReports(bare)).toEqual(initialCannibalizationState.reports);
    expect(selectCannibalizationDetail(bare)).toBeNull();
    expect(selectCannibalizationGscConnected(bare)).toBeNull();
    expect(selectCannibalizationSitesError(bare)).toBe('');
  });
});

describe('StateNotice', () => {
  it('renders its own copy when the server supplied none', async () => {
    await changeLanguage('en');
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StateNotice kind="failed" />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByTestId('cannibalization-state-failed').textContent).toContain(
      'Something went wrong',
    );
  });
});
