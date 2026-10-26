import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetTypedTrafficDomainsForTests } from './components/SnapshotRequestForm';
import type { ComponentProps } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { SiteMarketProvider, type MarketCatalogEntry } from '@shared/markets';
import { chooseOption } from '@/test/radixSelect';
import { SnapshotRequestForm, SpendPreviewCard } from './components/SnapshotRequestForm';
import { trafficSnapshotsReducer } from './store/slice';
import type { TrafficSpendPreview } from './types';

const catalog = vi.hoisted(() => ({
  current: { markets: [] as MarketCatalogEntry[], loading: false, error: false },
}));

vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: () => catalog.current,
}));

const MARKETS: MarketCatalogEntry[] = [
  { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
  { countryCode: 'DE', locationCode: 2276, languageCodes: ['de', 'en'] },
  { countryCode: 'JP', locationCode: 2392, languageCodes: ['ja'] },
  { countryCode: 'AQ', locationCode: null, languageCodes: ['en'] },
];

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const preview = (overrides: Partial<TrafficSpendPreview> = {}): TrafficSpendPreview => ({
  breakdown: [
    {
      operationKey: 'traffic:example.com',
      metric: 'traffic_snapshots',
      productUnits: 1,
      cachedStatus: 'cached',
    },
  ],
  ...overrides,
});

const renderForm = (
  siteId: string | null = '0123456789abcdef01234567',
  siteMarket?: { locationCode: number; languageCode: string; device: 'desktop' | 'mobile'; source?: 'cctld' },
) => {
  const store = configureStore({ reducer: { trafficSnapshots: trafficSnapshotsReducer } });
  const form = <SnapshotRequestForm siteId={siteId ?? undefined} />;
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            {siteMarket ? <SiteMarketProvider market={siteMarket}>{form}</SiteMarketProvider> : form}
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

beforeEach(async () => {
  __resetTypedTrafficDomainsForTests();
  catalog.current = { markets: MARKETS, loading: false, error: false };
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

describe('SnapshotRequestForm', () => {
  it('mirrors domain zod validation, previews, shows cache status, then confirms', async () => {
    mockedApiClient.mockImplementation(async (path) => {
      if (String(path).endsWith('/preview')) return preview();
      return {
        runId: '0123456789abcdef01234567',
        status: 'queued',
        targetDomain: 'example.com',
        reservedUnits: 1,
        cached: true,
      };
    });
    renderForm();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Domain' });

    await user.type(input, 'ftp://example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    expect(await screen.findByText('Enter a valid public domain, such as example.com.')).toBeVisible();

    // Help stays described before the error.
    expect(input).toHaveAttribute('aria-describedby', 'traffic-domain-help traffic-domain-error');

    await user.clear(input);
    // A pasted URL is normalized to its hostname instead of being rejected.
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    await user.type(input, 'https://WWW.Example.com/some/path?x=1');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    const card = await screen.findByTestId('traffic-preview');
    expect(input).toHaveValue('example.com');
    expect(mockedApiClient).toHaveBeenCalledWith('/competitors/traffic-snapshots/preview', {
      method: 'POST',
      body: { domains: ['example.com'], locationCode: 2840, languageCode: 'en' },
    });
    // The preview and its actions are brought into view and focused.
    await waitFor(() => expect(screen.getByTestId('traffic-preview-region')).toHaveFocus());
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    scroll.mockRestore();
    expect(within(card).getByText('example.com: Cached')).toBeVisible();
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(within(card).getByText('Domain').nextSibling).toHaveTextContent('example.com');
    // Confirm / Cancel live in the card footer, not detached beneath it.
    expect(within(card).getByRole('button', { name: 'Confirm snapshot' })).toBeVisible();
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Confirm snapshot' }));
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenLastCalledWith(
        '/competitors/traffic-snapshots',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            targetDomain: 'example.com',
            siteId: '0123456789abcdef01234567',
          }),
        }),
      ),
    );
  });

  it('cancels a preview locally without starting a paid snapshot', async () => {
    mockedApiClient.mockResolvedValueOnce(preview());
    const { store } = renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('traffic-preview')).not.toBeInTheDocument();
    expect(store.getState().trafficSnapshots.preview).toBeNull();
    expect(mockedApiClient).toHaveBeenCalledTimes(1);
  });

  it('renders the localized kill-switch locked preview failure', async () => {
    mockedApiClient.mockRejectedValueOnce(
      new ApiError('locked', 503, { error: { message: 'Traffic Insights is paused.' } }),
    );
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    expect(await screen.findByText('Traffic Insights is paused.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Domain' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm snapshot' })).toBeDisabled();
  });

  it('surfaces request-time and unknown preview failures', async () => {
    mockedApiClient
      .mockResolvedValueOnce(preview())
      .mockRejectedValueOnce(
        new ApiError('bad request', 400, { error: { message: 'Request rejected.' } }),
      );
    const first = renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm snapshot' }));
    expect(await screen.findByText('Request rejected.')).toBeVisible();
    first.unmount();

    mockedApiClient.mockRejectedValueOnce(new Error('offline'));
    renderForm();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    expect(await screen.findByText('Could not prepare the spend preview.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm snapshot' })).toBeDisabled();
  });

  it('uses the shared button loading state while preview and request are pending', async () => {
    let resolvePreview!: (value: TrafficSpendPreview) => void;
    mockedApiClient.mockReturnValueOnce(
      new Promise<TrafficSpendPreview>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    expect(screen.getByRole('button', { name: 'Preparing preview…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    resolvePreview(preview());
    expect(await screen.findByRole('button', { name: 'Confirm snapshot' })).toBeEnabled();
  });

  it('adopts a late site-domain default but never overwrites user input', async () => {
    mockedApiClient.mockResolvedValue(preview());
    const store = configureStore({ reducer: { trafficSnapshots: trafficSnapshotsReducer } });
    const ui = (initialDomain?: string) => (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <SnapshotRequestForm initialDomain={initialDomain} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>
    );
    const view = render(ui());
    const input = screen.getByRole('textbox', { name: 'Domain' });
    expect(input).toHaveValue('');

    // The sites slice resolved after mount — adopt its domain as the default.
    view.rerender(ui('pulsy.org'));
    expect(input).toHaveValue('pulsy.org');

    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, 'other.example');
    view.rerender(ui('changed.example'));
    expect(input).toHaveValue('other.example');
  });

  it('submits without a site id from a siteless mount', async () => {
    mockedApiClient
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce({
        runId: '0123456789abcdef01234567',
        status: 'queued',
        targetDomain: 'example.com',
        reservedUnits: 1,
        cached: false,
      });
    renderForm(null);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm snapshot' }));
    await waitFor(() => {
      const body = mockedApiClient.mock.calls[1]?.[1]?.body as Record<string, unknown>;
      expect(body).not.toHaveProperty('siteId');
    });
  });
});

describe('SpendPreviewCard', () => {
  const renderCard = (
    value: TrafficSpendPreview | null,
    loading: boolean,
    extra: Partial<ComponentProps<typeof SpendPreviewCard>> = {},
  ) =>
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SpendPreviewCard preview={value} loading={loading} {...extra} />
        </MemoryRouter>
      </I18nextProvider>,
    );

  it('covers loading, empty, fresh badge, and no-breakdown states', () => {
    const loading = renderCard(null, true);
    expect(screen.getByTestId('traffic-preview-loading')).toBeVisible();
    loading.unmount();
    expect(renderCard(null, false).container).toBeEmptyDOMElement();

    const fresh = renderCard(
      preview({
        breakdown: [
          {
            operationKey: 'traffic:fresh.example',
            metric: 'traffic_snapshots',
            productUnits: 1,
            cachedStatus: 'fresh_required',
          },
        ],
      }),
      false,
    );
    expect(screen.getByText('fresh.example: Fresh lookup')).toBeVisible();
    fresh.unmount();

    renderCard({}, false);
    expect(screen.getByTestId('traffic-preview')).toHaveTextContent(
      "This request uses the configured traffic-data provider.",
    );
  });

  it('says the allowance is not metered when the server sends no numbers', () => {
    renderCard({}, false);
    const card = screen.getByTestId('traffic-preview');
    expect(within(card).getByText('Allowance impact')).toBeVisible();
    expect(within(card).getByTestId('traffic-preview-impact')).toHaveTextContent(
      'Not metered on this server',
    );
    expect(within(card).queryByText('Market')).not.toBeInTheDocument();
    expect(within(card).queryByText('Base allowance remaining')).not.toBeInTheDocument();
    expect(within(card).queryByText('Domain')).not.toBeInTheDocument();
  });

  it('shows the snapshot count, remaining allowance, market and domain when provided', () => {
    renderCard(
      preview({ productUnits: 2, remainingBaseUnits: 1234, remainingPackUnits: 0 }),
      false,
      { market: { locationCode: 2840, languageCode: 'en' } },
    );
    const card = screen.getByTestId('traffic-preview');
    expect(within(card).getByTestId('traffic-preview-impact')).toHaveTextContent(
      '2 traffic snapshots',
    );
    expect(within(card).getByText('Base allowance remaining').nextSibling).toHaveTextContent('1,234');
    expect(within(card).getByText('Pack allowance remaining').nextSibling).toHaveTextContent('0');
    expect(within(card).getByText('United States · English')).toBeVisible();
    expect(within(card).queryByText('Not metered on this server')).not.toBeInTheDocument();
  });

  it('shows a language code that has no display name as it is', () => {
    renderCard(preview(), false, { market: { locationCode: 2276, languageCode: '1x' } });
    expect(screen.getByTestId('traffic-preview-market')).toHaveTextContent('Germany · 1x');
  });

  it('falls back to the breakdown length, then one snapshot, for the count', () => {
    const first = renderCard(preview({ remainingBaseUnits: 5 }), false);
    expect(screen.getByTestId('traffic-preview-impact')).toHaveTextContent('1 traffic snapshot');
    first.unmount();
    renderCard({ remainingPackUnits: 5 }, false);
    expect(screen.getByTestId('traffic-preview-impact')).toHaveTextContent('1 traffic snapshot');
  });

  it('renders the domain and puts actions in the card footer', () => {
    renderCard(preview(), false);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    cleanup();
    render(
      <I18nextProvider i18n={i18n}>
        <SpendPreviewCard
          preview={preview()}
          loading={false}
          domain="example.com"
          actions={<button type="button">Go</button>}
        />
      </I18nextProvider>,
    );
    const card = screen.getByTestId('traffic-preview');
    expect(within(card).getByText('Domain').nextSibling).toHaveTextContent('example.com');
    const footer = card.querySelector('[data-slot="card-footer"]') as HTMLElement;
    expect(within(footer).getByRole('button', { name: 'Go' })).toBeVisible();
  });
});

describe('SnapshotRequestForm typed domain', () => {
  const ui = (initialDomain?: string) => {
    const store = configureStore({ reducer: { trafficSnapshots: trafficSnapshotsReducer } });
    return (
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <SnapshotRequestForm siteId="site-34" initialDomain={initialDomain} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>
    );
  };

  it('keeps what the user typed when the form remounts before the site domain loads', async () => {
    const first = render(ui());
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Domain' }), 'https://www.example.com/path?x=1');
    // The panel swaps to a skeleton and back while the slice re-keys; the
    // late site-domain default must not replace the typed value.
    first.unmount();
    render(ui('episodebrief.com'));
    expect(screen.getByRole('textbox', { name: 'Domain' })).toHaveValue('https://www.example.com/path?x=1');
  });

  it('prefills an untouched site with its domain, and adopts a late default', () => {
    const view = render(ui());
    expect(screen.getByRole('textbox', { name: 'Domain' })).toHaveValue('');
    view.rerender(ui('episodebrief.com'));
    expect(screen.getByRole('textbox', { name: 'Domain' })).toHaveValue('episodebrief.com');
  });
});

describe('SnapshotRequestForm market', () => {
  it('previews and requests the selected country and language', async () => {
    mockedApiClient.mockImplementation(async (path) => {
      if (String(path).endsWith('/preview')) return preview();
      return { runId: '0123456789abcdef01234567', status: 'queued', targetDomain: 'example.com', reservedUnits: 1, cached: false };
    });
    const { store } = renderForm();
    const user = userEvent.setup();
    const country = screen.getByTestId('traffic-market-country');
    const language = screen.getByRole('combobox', { name: 'Language' });
    expect(country).toHaveTextContent('United States');
    expect(language).toHaveTextContent('English');

    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await screen.findByTestId('traffic-preview');

    // Changing the market drops the preview: cache status is per market.
    await user.click(country);
    await user.click(await screen.findByRole('option', { name: /Germany/ }));
    expect(country).toHaveTextContent('Germany');
    expect(language).toHaveTextContent('English');
    expect(store.getState().trafficSnapshots.preview).toBeNull();
    await chooseOption(user, language, 'German');

    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await screen.findByTestId('traffic-preview');
    expect(screen.getByTestId('traffic-preview-market')).toHaveTextContent('Germany · German');
    expect(mockedApiClient).toHaveBeenLastCalledWith('/competitors/traffic-snapshots/preview', {
      method: 'POST',
      body: { domains: ['example.com'], locationCode: 2276, languageCode: 'de' },
    });
    await user.click(screen.getByRole('button', { name: 'Confirm snapshot' }));
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenLastCalledWith(
        '/competitors/traffic-snapshots',
        expect.objectContaining({ body: expect.objectContaining({ locationCode: 2276, languageCode: 'de' }) }),
      ),
    );

    // A market without the current language falls back to its first one.
    await user.click(country);
    await user.click(await screen.findByRole('option', { name: /Japan/ }));
    expect(language).toHaveTextContent('Japanese');
    // Otherwise English is preferred when the new market offers it.
    await user.click(country);
    await user.click(await screen.findByRole('option', { name: /United States/ }));
    expect(language).toHaveTextContent('English');
    // Location-less catalog entries cannot be requested and are ignored.
    await user.click(country);
    await user.click(await screen.findByRole('option', { name: /Antarctica/ }));
    expect(country).toHaveTextContent('United States');
  });

  it('keeps the default market usable while the catalog loads or fails', () => {
    catalog.current = { markets: [], loading: true, error: false };
    const loading = renderForm();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English');
    loading.unmount();

    catalog.current = { markets: [], loading: false, error: true };
    renderForm();
    expect(screen.getByTestId('traffic-market-country')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('common:market.loadError'));
  });

  it("requests the snapshot in the site's default market, not United States", async () => {
    const user = userEvent.setup();
    renderForm(undefined, { locationCode: 2276, languageCode: 'de', device: 'desktop' });
    expect(screen.getByTestId('traffic-market-country')).toHaveTextContent('Germany');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('German');
    await user.type(screen.getByRole('textbox', { name: 'Domain' }), 'example.com');
    await user.click(screen.getByRole('button', { name: 'Preview snapshot' }));
    await waitFor(() =>
      expect(mockedApiClient).toHaveBeenCalledWith('/competitors/traffic-snapshots/preview', {
        method: 'POST',
        body: { domains: ['example.com'], locationCode: 2276, languageCode: 'de' },
      }),
    );
  });

  it("shows where the site's market came from while the picker holds it", () => {
    renderForm(undefined, { locationCode: 2276, languageCode: 'de', device: 'desktop', source: 'cctld' });
    expect(screen.getByTestId('traffic-market-provenance')).toHaveTextContent(
      "Defaulted from your site's country (\u2068Germany\u2069).",
    );
  });

  it('snaps a language the live market does not offer, keeping the current one when none are listed', () => {
    catalog.current = { markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: ['es'] }], loading: false, error: false };
    const spanishOnly = renderForm();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('Spanish');
    spanishOnly.unmount();

    catalog.current = { markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: [] }], loading: false, error: false };
    renderForm();
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('English');
  });

  it('falls back to the raw code when a language has no display name', async () => {
    catalog.current = { markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: ['en', '1x'] }], loading: false, error: false };
    renderForm();
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Language' }));
    expect(await screen.findByRole('option', { name: '1x' })).toBeInTheDocument();
  });
});
