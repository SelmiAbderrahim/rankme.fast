import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { formatAbsoluteDate } from '@shared/lib/datetime';
import {
  googleReducer,
  SiteGoogleReadinessProvider,
  type SiteGoogleReadiness,
} from '@features/google';
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
/** The stored `2026-07-01` snapshot day, formatted as that calendar day in any zone. */
const julyFirst = (locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    Date.UTC(2026, 6, 1),
  );
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

const renderPage = (
  entry = `/sites/${SITE_ID}?tab=cannibalization`,
  readiness?: SiteGoogleReadiness,
) => {
  search = '';
  const store = configureStore({
    reducer: { cannibalization: cannibalizationReducer, google: googleReducer },
  });
  const page = <CannibalizationPage siteId={SITE_ID} />;
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[entry]}>
            {readiness ? (
              <SiteGoogleReadinessProvider siteId={SITE_ID} domain="example.test" readiness={readiness}>
                {page}
              </SiteGoogleReadinessProvider>
            ) : (
              page
            )}
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
  it('adds no page gutter of its own inside the site workspace', async () => {
    routeApi();
    renderPage();
    const page = await screen.findByTestId('cannibalization-page');
    for (const cls of ['p-6', 'p-4', 'sm:p-6', 'mx-auto', 'max-w-6xl']) {
      expect(page).not.toHaveClass(cls);
    }
  });

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
      julyFirst('en'),
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

  it('explains that new reports need Search Console when the property is not connected', async () => {
    routeApi({
      connection: () => ({
        configuration: { connection: null, gsc: { propertyUrl: null } },
      }),
    });
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`);
    expect(await screen.findByTestId('cannibalization-needs-gsc')).toHaveTextContent(
      'New reports need a usable Search Console property.',
    );
    expect(screen.queryByTestId('cannibalization-preview-button')).toBeNull();
  });

  it('explains that Search Console is needed instead of a bare empty list when nothing is connected', async () => {
    routeApi({
      connection: () => ({
        configuration: { connection: null, gsc: { propertyUrl: null } },
      }),
      list: () => ({ items: [] }),
    });
    renderPage();
    const notice = await screen.findByTestId('cannibalization-state-emptyNoGsc');
    expect(notice).toHaveTextContent('Reports are built from your stored Search Console data.');
    expect(within(notice).queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('cannibalization-state-empty')).toBeNull();
  });

  it('keeps the plain empty state, with a way to create a report, when Search Console is connected', async () => {
    routeApi({ list: () => ({ items: [] }) });
    renderPage();
    const notice = await screen.findByTestId('cannibalization-state-empty');
    expect(notice).toHaveTextContent('Nothing to show yet');
    await userEvent.click(screen.getByRole('button', { name: 'Create a report' }));
    expect(new URLSearchParams(search).get('view')).toBe('new');
    expect(screen.queryByTestId('cannibalization-state-emptyNoGsc')).toBeNull();
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

  it('says the filter hides every candidate and offers to show all', async () => {
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&report=${REPORT_ID}&confidence=low`);
    const notice = await screen.findByTestId('cannibalization-state-filtered');
    expect(notice).toHaveTextContent('No candidates at this confidence');
    await userEvent.click(screen.getByTestId('cannibalization-state-filtered-action'));
    expect(new URLSearchParams(search).get('confidence')).toBeNull();
    expect(await screen.findAllByRole('row')).not.toHaveLength(0);
  });

  it('says a report found no competing pages and offers a new report', async () => {
    routeApi({ report: () => detail([]) });
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&report=${REPORT_ID}`);
    const notice = await screen.findByTestId('cannibalization-state-noCandidates');
    expect(notice).toHaveTextContent('No competing pages found');
    await userEvent.click(screen.getByTestId('cannibalization-state-noCandidates-action'));
    expect(new URLSearchParams(search).get('view')).toBe('new');
  });
});

describe('CannibalizationPage — new report tab', () => {
  it('discloses that usage is not metered', async () => {
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`);
    await userEvent.click(await screen.findByTestId('cannibalization-preview-button'));
    expect(await screen.findByTestId('cannibalization-preview')).toHaveTextContent(
      "Usage limits aren't applied on this server.",
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
    // The filter belongs to an open report with candidates.
    await user.click(await screen.findByTestId(`cannibalization-open-${REPORT_ID}`));
    await screen.findByTestId('cannibalization-candidates');

    await user.click(screen.getByRole('combobox', { name: 'Confidence' }));
    await user.click(await screen.findByRole('option', { name: 'High' }));
    await waitFor(() => expect(search).toContain('confidence=high'));

    await user.click(screen.getByTestId('cannibalization-tab-new'));
    await waitFor(() => expect(search).toContain('view=new'));
  });

});

describe('confidence filter visibility', () => {
  it('is hidden while there is no report data to filter', async () => {
    routeApi({ list: () => ({ items: [] }) });
    renderPage();
    await screen.findByText('Nothing to show yet');
    expect(screen.queryByRole('combobox', { name: 'Confidence' })).not.toBeInTheDocument();
  });

  it('is hidden with a stored report list that has not been opened', async () => {
    routeApi();
    renderPage();
    await screen.findByTestId('cannibalization-report-list');
    expect(screen.queryByRole('combobox', { name: 'Confidence' })).not.toBeInTheDocument();
  });

  it('shows once an opened report has candidates', async () => {
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&report=${REPORT_ID}`);
    await screen.findByTestId('cannibalization-candidates');
    expect(screen.getByRole('combobox', { name: 'Confidence' })).toBeInTheDocument();
  });

  it('stays visible when an active filter matches nothing, so it can be cleared', async () => {
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&report=${REPORT_ID}&confidence=low`);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Confidence' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('cannibalization-candidates')).not.toBeInTheDocument();
  });

  it('stays visible for an active filter even when the report list is empty', async () => {
    routeApi({ list: () => ({ items: [] }) });
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&confidence=high`);
    await screen.findByText('Nothing to show yet');
    expect(screen.getByRole('combobox', { name: 'Confidence' })).toBeInTheDocument();
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

describe('localized snapshot dates', () => {
  it.each(['en', 'ar', 'de'] as const)(
    'shows the 2026-07-01 snapshot day and generation date for %s',
    async (locale) => {
      await changeLanguage(locale);
      const user = userEvent.setup();
      routeApi();
      renderPage();
      const row = await screen.findByTestId(`cannibalization-report-row-${REPORT_ID}`);
      expect(within(row).getByText(julyFirst(locale))).toBeInTheDocument();
      expect(within(row).getByText(formatAbsoluteDate('2026-07-02T10:00:00.000Z', locale))).toBeInTheDocument();
      expect(row.textContent).not.toContain('2026-07-01');
      await user.click(screen.getByTestId(`cannibalization-open-${REPORT_ID}`));
      const provenance = await screen.findByTestId('cannibalization-provenance');
      expect(provenance.textContent).toContain(julyFirst(locale));
      expect(provenance.textContent).not.toContain('2026-07-01');
      render(
        <I18nextProvider i18n={i18n}>
          <QueryDrillDown candidate={candidate()} />
        </I18nextProvider>,
      );
      const drill = screen.getByTestId('cannibalization-drilldown');
      expect(drill.textContent).toContain(julyFirst(locale));
      expect(drill.textContent).not.toContain('2026-07-01');
      await changeLanguage('en');
    },
  );
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

describe('CannibalizationPage — shared Google readiness', () => {
  const readiness = (status: SiteGoogleReadiness['gsc']['status']): SiteGoogleReadiness => ({
    gsc: { status, matching: false },
    ga4: { status: 'ok', matching: false },
  });

  it.each(['no_property', 'property_mismatch', 'not_connected', 'error'] as const)(
    'with %s the banner shows on the default Reports view, the New tab explains, and no empty state competes',
    async (status) => {
      routeApi({ list: () => ({ items: [] }), report: () => detail([]) });
      renderPage(`/sites/${SITE_ID}?tab=cannibalization`, readiness(status));
      const notice = await screen.findByTestId('google-readiness-gsc');
      expect(notice).toHaveAttribute('data-status', status);
      // The banner's one CTA is the empty state's action here.
      expect(within(notice).getAllByRole('link')).toHaveLength(1);
      await waitFor(() => expect(screen.queryByTestId('cannibalization-list-loading')).not.toBeInTheDocument());
      // The create-a-report empty state does not compete with the banner, but
      // the empty tab still says what is missing and why, with no link.
      expect(screen.queryByTestId('cannibalization-state-empty')).not.toBeInTheDocument();
      const noReports = screen.getByTestId('cannibalization-state-emptyNoGsc');
      expect(noReports).toHaveTextContent('Nothing to show yet');
      expect(noReports).toHaveTextContent('Reports are built from your stored Search Console data.');
      expect(within(noReports).queryByRole('link')).toBeNull();
      expect(within(noReports).queryByRole('button')).toBeNull();
      await userEvent.click(screen.getByTestId('cannibalization-tab-new'));
      expect(await screen.findByTestId('cannibalization-needs-gsc')).toHaveTextContent(
        'New reports need a usable Search Console property.',
      );
      expect(screen.queryByTestId('cannibalization-preview-button')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('google-readiness-gsc')).toHaveLength(1);
    },
  );

  it('a stored report with no candidates offers no new report while Search Console is unusable', async () => {
    routeApi({ report: () => detail([]) });
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&report=${REPORT_ID}`, readiness('no_property'));
    expect(await screen.findByTestId('cannibalization-state-noCandidates')).toBeInTheDocument();
    expect(screen.queryByTestId('cannibalization-state-noCandidates-action')).not.toBeInTheDocument();
    // an empty report cannot be exported or shared, and the page says so.
    expect(screen.getByRole('button', { name: /export or share/i })).toHaveAccessibleDescription('Nothing to export yet');
  });

  it.each([
    ['no_property', 'Choose a Search Console property', 'Select a Search Console property'],
    ['property_mismatch', "This property doesn't cover the site", 'Select a Search Console property'],
    ['not_connected', "Search Console isn't connected", 'Connect Google'],
  ] as const)('shows the same %s status and CTA as every page', async (status, title, cta) => {
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`, readiness(status));
    const notice = await screen.findByTestId('google-readiness-gsc');
    expect(notice).toHaveAttribute('data-status', status);
    expect(notice).toHaveTextContent(title);
    const link = notice.querySelector('a');
    expect(link).toHaveTextContent(cta);
    expect(link).toHaveAttribute('href', `/sites/${SITE_ID}?tab=google`);
    expect(screen.queryByTestId('cannibalization-state-disconnected')).not.toBeInTheDocument();
  });

  it('offers the report form once the shared readiness is ok', async () => {
    routeApi();
    renderPage(`/sites/${SITE_ID}?tab=cannibalization&view=new`, readiness('ok'));
    expect(await screen.findByTestId('cannibalization-preview-button')).toBeInTheDocument();
    expect(screen.queryByTestId('google-readiness-gsc')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cannibalization-state-disconnected')).not.toBeInTheDocument();
  });
});

