/**
 * Client engine picker, badges, filter, and the
 * pre-submit spend disclosure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from './api';
import { ranksReducer } from './store/slice';
import { AddKeywordForm } from './components/AddKeywordForm';
import { KeywordsTable } from './components/KeywordsTable';
import { KeywordsPanel } from './components/KeywordsPanel';
import { buildAddKeywordSchema, type AddKeywordFormValues } from './validation';
import type { AltEngineSpendPreview, Keyword, KeywordListPage, RanksState } from './types';

const marketCatalogMock = vi.hoisted(() => ({
  current: {
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
    ],
    loading: false,
    error: false,
  },
}));

vi.mock('@shared/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@shared/api/client')>();
  return { ...actual, apiClient: vi.fn() };
});

vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: () => marketCatalogMock.current,
}));

vi.mock('./api', () => ({
  fetchKeywordsRequest: vi.fn(),
  createKeywordRequest: vi.fn(),
  removeKeywordRequest: vi.fn(),
  updateCadenceRequest: vi.fn(),
  fetchKeywordHistoryRequest: vi.fn(),
  checkNowRequest: vi.fn(),
  fetchKeywordSuggestionsRequest: vi.fn(),
  previewAltEngineKeywordRequest: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mocked = vi.mocked(api);

const keyword = (id: string, overrides: Partial<Keyword> = {}): Keyword => ({
  id,
  siteId: 'site-1',
  phrase: `phrase-${id}`,
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  latestPosition: 3,
  previousPosition: 3,
  delta: 0,
  lastCheckedAt: '2026-01-02T00:00:00.000Z',
  aiOverviewPresent: null,
  aiCited: null,
  aiCitedUrl: null,
  lastFailedCheckAt: null,
  lastFailedReason: null,
  engine: 'google',
  engineTarget: null,
  observationMeta: null,
  ...overrides,
});

const previewFor = (): AltEngineSpendPreview => ({});

const listPage = (keywords: Keyword[]): KeywordListPage => ({
  keywords,
  nextCursor: null,
  cadence: 'weekly',
});

const baseState = (): RanksState => ranksReducer(undefined, { type: '@@init' });
const makeStore = (preloaded?: Partial<RanksState>) =>
  configureStore({
    reducer: { ranks: ranksReducer },
    ...(preloaded ? { preloadedState: { ranks: { ...baseState(), ...preloaded } } } : {}),
  });

const renderForm = (props: Partial<Parameters<typeof AddKeywordForm>[0]> = {}) =>
  render(
    <I18nextProvider i18n={i18n}>
      {/* Router context: the form renders the long-tail research <Link> as
          soon as a Google keyword phrase is typed. */}
      <MemoryRouter>
        <AddKeywordForm
          siteId="site-1"
          onSubmit={props.onSubmit ?? (async () => [])}
          submitting={false}
          addError=""
          {...props}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.resetAllMocks();
  marketCatalogMock.current = {
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
    ],
    loading: false,
    error: false,
  };
  mocked.previewAltEngineKeywordRequest.mockResolvedValue(previewFor());
});

describe('AddKeywordForm — engine picker', () => {
  it('normalizes a missing catalog location through US and first-market fallbacks', async () => {
    marketCatalogMock.current = {
      markets: [
        { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
        { countryCode: 'US', locationCode: 2841, languageCodes: ['en'] },
      ],
      loading: false,
      error: false,
    };
    const usFallback = renderForm();
    await waitFor(() => expect(screen.getByRole('combobox', { name: /location/i })).toHaveTextContent('United States'));
    usFallback.unmount();

    marketCatalogMock.current = {
      markets: [{ countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] }],
      loading: false,
      error: false,
    };
    renderForm();
    await waitFor(() => expect(screen.getByRole('combobox', { name: /location/i })).toHaveTextContent('France'));
    await waitFor(() => expect(screen.getByLabelText(/language/i)).toHaveValue('fr'));
  });

  it('does not invent catalog values while loading, failed, or empty', async () => {
    const user = userEvent.setup();
    const invalidMarket = { countryCode: 'US', locationCode: 2840, languageCodes: ['en'] };
    Reflect.set(invalidMarket, 'locationCode', null);
    marketCatalogMock.current = {
      markets: [invalidMarket],
      loading: true,
      error: false,
    };
    const loading = renderForm();
    expect(screen.getByRole('combobox', { name: /location/i })).toBeDisabled();
    loading.unmount();

    marketCatalogMock.current = {
      markets: [invalidMarket],
      loading: false,
      error: true,
    };
    const errored = renderForm();
    expect(screen.getByRole('alert')).toHaveTextContent('Countries could not be loaded. Try again.');
    expect(screen.getByRole('combobox', { name: /location/i })).toHaveAttribute('aria-invalid', 'true');
    errored.unmount();

    marketCatalogMock.current = {
      markets: [invalidMarket],
      loading: false,
      error: false,
    };
    const noLocation = renderForm();
    await user.click(screen.getByRole('combobox', { name: /location/i }));
    await user.click(screen.getByRole('option', { name: /United States/i }));
    noLocation.unmount();

    marketCatalogMock.current = {
      markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: [] }],
      loading: false,
      error: false,
    };
    renderForm();
    expect(screen.getByLabelText(/language/i)).toBeEmptyDOMElement();
  });

  it('safely renders an unknown provider language code', () => {
    marketCatalogMock.current = {
      markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: ['invalid_language'] }],
      loading: false,
      error: false,
    };
    renderForm();
    expect(within(screen.getByLabelText(/language/i)).getByRole('option')).toHaveTextContent(
      'invalid_language',
    );
  });

  it('defaults to Google and asks for no target or preview', async () => {
    renderForm();
    const google = screen.getByLabelText(/Google/);
    expect(google).toBeChecked();
    expect(screen.queryByTestId('keyword-engine-target')).toBeNull();
    expect(screen.queryByTestId('alt-engine-preview')).toBeNull();
    expect(mocked.previewAltEngineKeywordRequest).not.toHaveBeenCalled();
  });

  it('discloses the unit and unmetered usage when Bing is chosen', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByLabelText(/Bing/));

    const panel = await screen.findByTestId('alt-engine-preview');
    expect(mocked.previewAltEngineKeywordRequest).toHaveBeenCalledWith('site-1', 'bing');
    expect(
      await within(panel).findByText(
        'One check per week uses one Bing, YouTube, and Amazon check.',
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByTestId('alt-engine-preview-usage')).toHaveTextContent(
      'Plan usage limits are not metered in self-hosted mode.',
    );
    // Bing matches the site domain — no target field.
    expect(screen.queryByTestId('keyword-engine-target')).toBeNull();
  });

  it('asks for a channel handle on YouTube and an ASIN on Amazon', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText(/YouTube/));
    expect(await screen.findByTestId('keyword-engine-target')).toBeInTheDocument();
    expect(screen.getByLabelText('Channel handle')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Amazon/));
    expect(await screen.findByLabelText('Product ASIN')).toBeInTheDocument();
  });

  it('refuses to submit a YouTube keyword without a handle', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => []);
    renderForm({ onSubmit });

    await user.click(screen.getByLabelText(/YouTube/));
    await user.type(screen.getByLabelText(/Keyword/i), 'seo audit tutorial');
    await user.click(screen.getByRole('button', { name: /track/i }));

    expect(
      await screen.findByText('Tell us which channel or product to follow on this engine.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a malformed ASIN and names the expected shape', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => []);
    renderForm({ onSubmit });

    await user.click(screen.getByLabelText(/Amazon/));
    await user.type(screen.getByLabelText(/Keyword/i), 'seo audit book');
    await user.type(await screen.findByLabelText('Product ASIN'), 'TOOSHORT');
    await user.click(screen.getByRole('button', { name: /track/i }));

    expect(
      await screen.findByText('Enter a ten-character Amazon ASIN, for example B08N5WRWNW.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the engine and its target once both are valid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(values: AddKeywordFormValues[]) => Promise<string[]>>(async () => [
      'seo audit tutorial',
    ]);
    renderForm({ onSubmit });

    await user.click(screen.getByLabelText(/YouTube/));
    await user.type(screen.getByLabelText(/Keyword/i), 'seo audit tutorial');
    await user.type(await screen.findByLabelText('Channel handle'), '@acmechannel');
    await user.click(screen.getByRole('button', { name: /track/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        phrase: 'seo audit tutorial',
        engine: 'youtube',
        engineTarget: '@acmechannel',
      }),
    ]);
  });

  it('shows a failed preview inline without blocking the form', async () => {
    const user = userEvent.setup();
    mocked.previewAltEngineKeywordRequest.mockRejectedValue(new Error('boom'));
    renderForm();

    await user.click(screen.getByLabelText(/Bing/));
    expect(await screen.findByTestId('alt-engine-preview-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /track/i })).toBeEnabled();
  });

  it('ignores a stale preview that resolves after the engine changed', async () => {
    const user = userEvent.setup();
    let resolveFirst: (value: AltEngineSpendPreview) => void = () => {};
    let resolveSecond: (value: AltEngineSpendPreview) => void = () => {};
    mocked.previewAltEngineKeywordRequest
      .mockReturnValueOnce(
        new Promise<AltEngineSpendPreview>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise<AltEngineSpendPreview>((resolve) => {
          resolveSecond = resolve;
        }),
      );
    renderForm();

    await user.click(screen.getByLabelText(/Bing/));
    await user.click(screen.getByLabelText(/YouTube/));
    expect(await screen.findByText('Checking what this costs…')).toBeInTheDocument();

    // The abandoned Bing request lands first and must be discarded: the
    // YouTube preview is still loading.
    resolveFirst(previewFor());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('Checking what this costs…')).toBeInTheDocument();
    expect(screen.queryByTestId('alt-engine-preview-usage')).toBeNull();

    resolveSecond(previewFor());
    expect(await screen.findByTestId('alt-engine-preview-usage')).toBeInTheDocument();
  });

  it('ignores a stale preview that REJECTS after the engine changed', async () => {
    const user = userEvent.setup();
    let rejectFirst: (reason: unknown) => void = () => {};
    let resolveSecond: (value: AltEngineSpendPreview) => void = () => {};
    mocked.previewAltEngineKeywordRequest
      .mockReturnValueOnce(
        new Promise<AltEngineSpendPreview>((_resolve, reject) => {
          rejectFirst = reject;
        }),
      )
      .mockReturnValueOnce(
        new Promise<AltEngineSpendPreview>((resolve) => {
          resolveSecond = resolve;
        }),
      );
    renderForm();

    await user.click(screen.getByLabelText(/Bing/));
    await user.click(screen.getByLabelText(/YouTube/));
    expect(await screen.findByText('Checking what this costs…')).toBeInTheDocument();

    rejectFirst(new Error('abandoned'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('Checking what this costs…')).toBeInTheDocument();
    expect(screen.queryByTestId('alt-engine-preview-error')).toBeNull();

    resolveSecond(previewFor());
    expect(await screen.findByTestId('alt-engine-preview-usage')).toBeInTheDocument();
    expect(screen.queryByTestId('alt-engine-preview-error')).toBeNull();
  });

  it('drops the preview again when the picker returns to Google', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByLabelText(/Bing/));
    await screen.findByTestId('alt-engine-preview');
    await user.click(screen.getByLabelText(/Google/));
    await waitFor(() => expect(screen.queryByTestId('alt-engine-preview')).toBeNull());
  });

  it('drops a hidden Amazon target before submitting a Google keyword', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(values: AddKeywordFormValues[]) => Promise<string[]>>(async () => [
      'google only phrase',
    ]);
    renderForm({ onSubmit });

    await user.click(screen.getByLabelText(/Amazon/));
    await user.type(await screen.findByLabelText('Product ASIN'), 'B0TRACKED1');
    await user.click(screen.getByLabelText(/Google/));
    await user.type(screen.getByLabelText(/Keyword/i), 'google only phrase');
    await user.click(screen.getByRole('button', { name: /track/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        phrase: 'google only phrase',
        engine: 'google',
        engineTarget: undefined,
      }),
    ]);
  });
});

describe('buildAddKeywordSchema — engine/target pairing', () => {
  it('refuses a target on an engine that matches the site domain', () => {
    const schema = buildAddKeywordSchema(i18n.getFixedT('en', 'ranks'));
    const parsed = schema.safeParse({
      phrase: 'seo audit tool',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      engine: 'bing',
      engineTarget: 'acmechannel',
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('Google and Bing follow your own site');
  });

  it('names the YouTube handle shape when the token is malformed', () => {
    const schema = buildAddKeywordSchema(i18n.getFixedT('en', 'ranks'));
    const parsed = schema.safeParse({
      phrase: 'seo audit tutorial',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      engine: 'youtube',
      engineTarget: 'no',
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('YouTube channel handle');
  });

  it('accepts a domain-matched engine with no target at all', () => {
    const schema = buildAddKeywordSchema(i18n.getFixedT('en', 'ranks'));
    expect(
      schema.safeParse({
        phrase: 'seo audit tool',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        engine: 'bing',
      }).success,
    ).toBe(true);
  });
});

describe('previewAltEngineKeywordRequest', () => {
  it('POSTs the chosen engine to the preview endpoint', async () => {
    const actual = await vi.importActual<typeof import('./api')>('./api');
    const client = await import('@shared/api/client');
    const apiClientMock = vi.mocked(client.apiClient);
    apiClientMock.mockResolvedValue(previewFor() as never);

    await actual.previewAltEngineKeywordRequest('site-1', 'amazon');

    expect(apiClientMock).toHaveBeenCalledWith('/sites/site-1/keywords/preview', {
      method: 'POST',
      body: { engine: 'amazon' },
    });
  });
});

describe('KeywordsTable — engine provenance', () => {
  const renderTable = (keywords: Keyword[]) =>
    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={keywords}
          removingId={null}
          selectedId={null}
          onSelect={() => {}}
          onRemove={() => {}}
        />
      </I18nextProvider>,
    );

  it('badges non-Google rows and leaves Google rows unchanged', () => {
    renderTable([
      keyword('g1'),
      keyword('b1', { engine: 'bing' }),
      keyword('y1', { engine: 'youtube', engineTarget: 'acmechannel' }),
    ]);
    expect(screen.queryByTestId('keyword-engine-g1')).toBeNull();
    expect(screen.getAllByTestId('keyword-engine-b1')[0]).toHaveTextContent('Bing');
    expect(screen.getAllByTestId('keyword-engine-y1')[0]).toHaveTextContent('YouTube');
    expect(screen.getAllByText('acmechannel').length).toBeGreaterThan(0);
  });

  it('labels every Amazon row as a provider-index observation', () => {
    renderTable([
      keyword('a1', {
        engine: 'amazon',
        engineTarget: 'B0TRACKED1',
        observationMeta: {
          sourceKind: 'provider_observation',
          sourceLabel: 'dataforseo',
          observedAt: '2026-01-02T00:00:00.000Z',
          freshUntil: null,
          freshness: 'fresh',
          market: null,
          sampleCount: 100,
          coverageNoteKey: 'observations.coverage.providerIndexRanking',
        },
      }),
    ]);
    const note = screen.getAllByTestId('keyword-amazon-note-a1')[0]!;
    expect(note).toHaveTextContent(
      'Position within the results our data provider returned, not a live shelf position.',
    );
    expect(note).toHaveAttribute('data-observation-source', 'dataforseo');
    expect(note).toHaveAttribute('data-observed-at', '2026-01-02T00:00:00.000Z');
  });

  it('keeps the Amazon disclosure when optional observation metadata is absent', () => {
    renderTable([
      keyword('a-without-meta', {
        engine: 'amazon',
        engineTarget: 'B0TRACKED2',
        observationMeta: null,
      }),
    ]);

    const note = screen.getAllByTestId('keyword-amazon-note-a-without-meta')[0]!;
    expect(note).toHaveTextContent(
      'Position within the results our data provider returned, not a live shelf position.',
    );
    expect(note).not.toHaveAttribute('data-observation-source');
    expect(note).not.toHaveAttribute('data-observed-at');
  });

  it('renders a hostile phrase and target as inert text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    renderTable([keyword('x1', { phrase: hostile, engine: 'youtube', engineTarget: hostile })]);
    expect(screen.getAllByText(hostile).length).toBeGreaterThan(0);
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('KeywordsPanel — URL-backed engine filter', () => {
  const renderPanel = (
    keywords: Keyword[],
    initialEntry = '/site',
    engineKeywords: Keyword[] = keywords,
  ) => {
    mocked.fetchKeywordsRequest.mockImplementation((_siteId, _cursor, init) =>
      Promise.resolve(
        listPage(
          init?.engine ? engineKeywords.filter((row) => row.engine === init.engine) : keywords,
        ),
      ),
    );
    mocked.fetchKeywordHistoryRequest.mockResolvedValue({
      keywordId: keywords[0]?.id ?? 'none',
      series: [],
    });
    return render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <KeywordsPanel siteId="site-1" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
  };

  it('stays available when the current page only contains Google rows', async () => {
    renderPanel([keyword('g1')]);
    await waitFor(() =>
      expect(screen.getAllByTestId(/keyword-(row|card)-g1/).length).toBeGreaterThan(0),
    );
    expect(screen.getByTestId('engine-filter')).toBeInTheDocument();
  });

  it('requests the selected engine from the full stored result set', async () => {
    renderPanel([keyword('g1')], '/site?engine=bing', [keyword('b1', { engine: 'bing' })]);
    await screen.findByTestId('engine-filter');
    await waitFor(() => expect(screen.queryAllByTestId('keyword-row-g1')).toHaveLength(0));
    expect(screen.getAllByTestId(/keyword-(row|card)-b1/).length).toBeGreaterThan(0);
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledWith(
      'site-1',
      undefined,
      expect.objectContaining({ engine: 'bing', signal: expect.any(AbortSignal) }),
    );
  });

  it('falls back to every engine when the URL names an unknown one', async () => {
    renderPanel([keyword('g1'), keyword('b1', { engine: 'bing' })], '/site?engine=askjeeves');
    await screen.findByTestId('engine-filter');
    expect(screen.getAllByTestId(/keyword-(row|card)-g1/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId(/keyword-(row|card)-b1/).length).toBeGreaterThan(0);
  });

  it('writes the chosen engine back to the URL and clears it again', async () => {
    const user = userEvent.setup();
    renderPanel([keyword('g1'), keyword('b1', { engine: 'bing' })]);
    const select = within(await screen.findByTestId('engine-filter')).getByRole('combobox');

    await user.selectOptions(select, 'bing');
    await waitFor(() => expect(screen.queryAllByTestId('keyword-row-g1')).toHaveLength(0));

    await user.selectOptions(select, 'all');
    await waitFor(() =>
      expect(screen.getAllByTestId(/keyword-(row|card)-g1/).length).toBeGreaterThan(0),
    );
  });
});
