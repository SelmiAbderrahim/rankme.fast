import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { previewFixture, scanFixture, statusScanFixtures } from './__fixtures__/scans';
import { BrandRadarPage, BRAND_RADAR_POLL_INTERVAL_MS } from './components/BrandRadarPage';
import { brandRadarReducer } from './store/slice';
import { previewBrandRadarScanThunk } from './store/thunks';

const PANEL_SITE = '65f000000000000000000abc';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

let search = '';
const LocationProbe = () => {
  search = useLocation().search;
  return null;
};

const renderPage = (entry = `/sites/${PANEL_SITE}?tab=brand-radar`) => {
  search = '';
  const store = configureStore({
    reducer: { brandRadar: brandRadarReducer },
  });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[entry]}>
            <BrandRadarPage siteId={PANEL_SITE} />
            <LocationProbe />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

const listResponse = (items = [scanFixture()], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});

const brandMarkets = {
  surface: 'brand-radar',
  markets: [
    { countryCode: 'FR', locationCode: null, languageCodes: [] },
    { countryCode: 'US', locationCode: null, languageCodes: [] },
  ],
  fetchedAt: '2026-08-11T00:00:00.000Z',
  cached: false,
};

/** Route each mocked call by path so ordering never matters. */
const routeApi = (
  handlers: Partial<Record<'list' | 'preview' | 'create', () => unknown>>,
) => {
  mockedApiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/market-catalogs/brand-radar') {
      return Promise.resolve(brandMarkets) as never;
    }
    if (path.startsWith(`/sites/${PANEL_SITE}/brand-radar/preview`)) {
      return Promise.resolve(handlers.preview?.() ?? previewFixture()) as never;
    }
    if (path.startsWith(`/sites/${PANEL_SITE}/brand-radar/scans`) && init?.method === 'POST') {
      return Promise.resolve(
        handlers.create?.() ?? {
          scanId: 'created-1',
          status: 'queued',
          queryHash: 'f'.repeat(64),
          priorScanId: null,
          outputLocale: 'en',
          reservedUnits: 1,
        },
      ) as never;
    }
    if (path.startsWith(`/sites/${PANEL_SITE}/brand-radar/scans`)) {
      return Promise.resolve(handlers.list?.() ?? listResponse()) as never;
    }
    return Promise.resolve({}) as never;
  });
};

const gotoNewTab = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('tab', { name: 'New scan' }));
  return screen.findByLabelText('Brand query');
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BrandRadarPage — scan list', () => {
  it('loads the scan list on mount and reflects the view in the URL', async () => {
    routeApi({ list: () => listResponse(statusScanFixtures(['completed', 'failed'])) });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('brand-radar-row')).toHaveLength(2));

    await user.click(screen.getByRole('tab', { name: 'New scan' }));
    await waitFor(() => expect(new URLSearchParams(search).get('view')).toBe('new'));

    await user.click(screen.getByRole('tab', { name: 'Scans' }));
    await waitFor(() => expect(new URLSearchParams(search).has('view')).toBe(false));
  });

  it('renders the workspace without crashing before the slice is injected', () => {
    routeApi({});
    const store = configureStore({ reducer: { other: (state: null = null) => state } });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[`/sites/${PANEL_SITE}?tab=brand-radar`]}>
            <BrandRadarPage siteId={PANEL_SITE} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.getByRole('heading', { name: 'Brand Radar' })).toBeInTheDocument();
  });

  it('appends the next keyset page on "Load more"', async () => {
    let call = 0;
    routeApi({
      list: () => {
        call += 1;
        return call === 1
          ? listResponse([scanFixture({ id: 'first' })], 'cur1')
          : listResponse([scanFixture({ id: 'second' })], null);
      },
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('brand-radar-row')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByTestId('brand-radar-row')).toHaveLength(2));
    expect(mockedApiClient).toHaveBeenCalledWith(
      `/sites/${PANEL_SITE}/brand-radar/scans?cursor=cur1`,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('retries a failed list load', async () => {
    let call = 0;
    routeApi({
      list: () => {
        call += 1;
        if (call === 1) throw new ApiError('down', 500, { error: { message: 'Server said no' } });
        return listResponse();
      },
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server said no'));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByTestId('brand-radar-row')).toHaveLength(1));
  });

  it('sends the empty-state call to action to the new-scan tab', async () => {
    routeApi({ list: () => listResponse([]) });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Start a scan' }));
    await waitFor(() => expect(new URLSearchParams(search).get('view')).toBe('new'));
    expect(await screen.findByLabelText('Brand query')).toBeInTheDocument();
  });

  it('applies the ?status= filter over the loaded page', async () => {
    routeApi({ list: () => listResponse(statusScanFixtures(['completed', 'failed'])) });
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&status=failed`);
    await waitFor(() => expect(screen.getAllByTestId('brand-radar-row')).toHaveLength(1));
    expect(screen.getByTestId('brand-radar-row')).toHaveTextContent('query-failed');
  });

  it('normalizes an invalid ?status= away and shows every row', async () => {
    routeApi({ list: () => listResponse(statusScanFixtures(['completed', 'failed'])) });
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&status=melted`);
    await waitFor(() => expect(new URLSearchParams(search).has('status')).toBe(false));
    expect(screen.getAllByTestId('brand-radar-row')).toHaveLength(2);
  });
});

describe('BrandRadarPage — polling etiquette', () => {
  it('refetches while a row is unsettled and stops once everything is terminal', async () => {
    let call = 0;
    routeApi({
      list: () => {
        call += 1;
        return call === 1
          ? listResponse([scanFixture({ id: 'p', status: 'running' })])
          : listResponse([scanFixture({ id: 'p', status: 'completed' })]);
      },
    });
    // Fake timers BEFORE render so the interval this component schedules is
    // the faked one; `shouldAdvanceTime` keeps `waitFor` usable.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await waitFor(() =>
      expect(within(screen.getByTestId('brand-radar-row')).getByText('Running')).
        toBeInTheDocument(),
    );

    await vi.advanceTimersByTimeAsync(BRAND_RADAR_POLL_INTERVAL_MS);
    await waitFor(() =>
      expect(within(screen.getByTestId('brand-radar-row')).getByText('Completed')).
        toBeInTheDocument(),
    );
    const afterSettle = call;

    await vi.advanceTimersByTimeAsync(BRAND_RADAR_POLL_INTERVAL_MS * 3);
    expect(call).toBe(afterSettle);
  });

  it('skips the poll while the tab is hidden', async () => {
    let call = 0;
    routeApi({
      list: () => {
        call += 1;
        return listResponse([scanFixture({ id: 'p', status: 'queued' })]);
      },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await waitFor(() =>
      expect(within(screen.getByTestId('brand-radar-row')).getByText('Queued')).
        toBeInTheDocument(),
    );
    const before = call;

    const spy = vi
      .spyOn(document, 'visibilityState', 'get')
      .mockReturnValue('hidden' as DocumentVisibilityState);
    await vi.advanceTimersByTimeAsync(BRAND_RADAR_POLL_INTERVAL_MS * 2);
    expect(call).toBe(before);
    spy.mockRestore();

    // Same interval, visible tab → the refetch actually happens.
    await vi.advanceTimersByTimeAsync(BRAND_RADAR_POLL_INTERVAL_MS);
    expect(call).toBeGreaterThan(before);
  });
});

describe('BrandRadarPage — creation flow', () => {
  it('requires a preview before the scan can be run, and cancel spends nothing', async () => {
    routeApi({});
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);
    const query = await screen.findByLabelText('Brand query');
    expect(screen.queryByRole('button', { name: 'Run the scan' })).not.toBeInTheDocument();

    await user.type(query, 'RankMeFast');
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    await screen.findByTestId('brand-radar-preview');
    expect(screen.getByRole('button', { name: 'Run the scan' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByTestId('brand-radar-preview')).not.toBeInTheDocument(),
    );
    expect(
      mockedApiClient.mock.calls.filter(
        ([path, init]) =>
          path === `/sites/${PANEL_SITE}/brand-radar/scans` &&
          (init as { method?: string } | undefined)?.method === 'POST',
      ),
    ).toHaveLength(0);
  });

  it('submits once, prepends the optimistic row and returns to the scan list', async () => {
    let created = 0;
    routeApi({
      create: () => {
        created += 1;
        return {
          scanId: 'created-1',
          status: 'queued',
          queryHash: 'f'.repeat(64),
          priorScanId: null,
          outputLocale: 'en',
          reservedUnits: 1,
        };
      },
      list: () => listResponse([]),
    });
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);
    await user.type(await gotoNewTab(user), 'RankMeFast');
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    await screen.findByTestId('brand-radar-preview');

    const run = screen.getByRole('button', { name: 'Run the scan' });
    await user.click(run);
    await waitFor(() => expect(new URLSearchParams(search).has('view')).toBe(false));
    expect(created).toBe(1);

    const rows = await screen.findAllByTestId('brand-radar-row');
    expect(within(rows[0]!).getByText('RankMeFast')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Just submitted')).toBeInTheDocument();
  });

  it('disables the submit button while the request is in flight', async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    mockedApiClient.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.startsWith(`/sites/${PANEL_SITE}/brand-radar/preview`)) {
        return Promise.resolve(previewFixture()) as never;
      }
      if (path.startsWith(`/sites/${PANEL_SITE}/brand-radar/scans`) && init?.method === 'POST') {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        }) as never;
      }
      return Promise.resolve(listResponse([])) as never;
    });
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);
    await user.type(await screen.findByLabelText('Brand query'), 'RankMeFast');
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    await screen.findByTestId('brand-radar-preview');

    await user.click(screen.getByRole('button', { name: 'Run the scan' }));
    const busy = await screen.findByRole('button', { name: /Submitting/ });
    expect(busy).toBeDisabled();
    await user.click(busy);
    resolveCreate({
      scanId: 'created-1',
      status: 'queued',
      queryHash: 'f'.repeat(64),
      priorScanId: null,
      outputLocale: 'en',
      reservedUnits: 1,
    });
    await waitFor(() =>
      expect(
        mockedApiClient.mock.calls.filter(
          ([path, init]) =>
            path === `/sites/${PANEL_SITE}/brand-radar/scans` &&
            (init as { method?: string } | undefined)?.method === 'POST',
        ),
      ).toHaveLength(1),
    );
  });

  it('surfaces a create failure without losing the form', async () => {
    routeApi({
      create: () => {
        throw new ApiError('nope', 500, { error: { message: 'Queue unavailable' } });
      },
    });
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);
    await user.type(await screen.findByLabelText('Brand query'), 'RankMeFast');
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    await screen.findByTestId('brand-radar-preview');
    await user.click(screen.getByRole('button', { name: 'Run the scan' }));
    await waitFor(() =>
      expect(screen.getByText('Queue unavailable')).toBeInTheDocument(),
    );
  });

  it('surfaces a preview failure', async () => {
    routeApi({
      preview: () => {
        throw new ApiError('nope', 500, { error: { message: 'Pricing unavailable' } });
      },
    });
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);
    await user.type(await screen.findByLabelText('Brand query'), 'RankMeFast');
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    await waitFor(() => expect(screen.getByText('Pricing unavailable')).toBeInTheDocument());
  });
});

describe('BrandRadarPage — form validation mirrors createScanBody', () => {
  const setup = async () => {
    routeApi({});
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);
    const query = await screen.findByLabelText('Brand query');
    return { user, query };
  };

  it('refuses an empty brand query', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    expect(
      await screen.findByText('Enter a brand query of one to 200 characters.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('brand-radar-preview')).not.toBeInTheDocument();
  });

  it('refuses a 201-character brand query', async () => {
    const { user, query } = await setup();
    await user.click(query);
    await user.paste('x'.repeat(201));
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    expect(
      await screen.findByText('Enter a brand query of one to 200 characters.'),
    ).toBeInTheDocument();
  });

  it('refuses a malformed language code', async () => {
    const { user, query } = await setup();
    await user.type(query, 'RankMeFast');
    await user.type(screen.getByLabelText('Language (optional)'), 'french');
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    expect(
      await screen.findByText('Use a two-letter language code, such as en.'),
    ).toBeInTheDocument();
  });

  it('searches publisher countries by ISO code', async () => {
    const { user, query } = await setup();
    await user.type(query, 'RankMeFast');
    const country = await screen.findByLabelText('Publisher country (optional)');
    await waitFor(() => expect(country).toBeEnabled());
    await user.click(country);
    await user.type(screen.getByRole('textbox', { name: 'Search countries' }), 'FR');
    await user.click(await screen.findByRole('option', { name: /France/ }));
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    await screen.findByTestId('brand-radar-preview');
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${PANEL_SITE}/brand-radar/preview`, {
      method: 'POST',
      body: { brandQuery: 'RankMeFast', countryCode: 'FR' },
    });
  });

  it('sends the optional fields only when they were filled in', async () => {
    const { user, query } = await setup();
    await user.type(query, 'RankMeFast');
    await user.type(screen.getByLabelText('Language (optional)'), 'FR');
    const country = await screen.findByLabelText('Publisher country (optional)');
    await waitFor(() => expect(country).toBeEnabled());
    await user.click(country);
    await user.click(await screen.findByRole('option', { name: /United States/ }));
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    await screen.findByTestId('brand-radar-preview');
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${PANEL_SITE}/brand-radar/preview`, {
      method: 'POST',
      body: { brandQuery: 'RankMeFast', language: 'fr', countryCode: 'US' },
    });
  });
});

describe('BrandRadarPage — kill switch', () => {
  const refusedPreview = (status: number, message: string) => {
    routeApi({
      preview: () => {
        throw new ApiError(message, status, { error: { message } });
      },
    });
  };

  const triggerPreview = async () => {
    const user = userEvent.setup();
    const rendered = renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);
    await user.type(await screen.findByLabelText('Brand query'), 'RankMeFast');
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    return { user, ...rendered };
  };

  it('renders the product-unavailable banner and keeps stored reads on 503', async () => {
    refusedPreview(503, 'Brand Radar is unavailable right now.');
    await triggerPreview();
    const banner = await screen.findByTestId('brand-radar-unavailable');
    expect(banner).toHaveTextContent('Brand Radar is unavailable right now.');
    expect(screen.getByText('Scans you already ran stay readable.')).toBeInTheDocument();
    // The scan list is still fetched and rendered.
    expect(await screen.findByRole('tab', { name: 'Scans' })).toBeInTheDocument();
    expect(screen.getByLabelText('Brand query')).toBeDisabled();
  });

  it('keeps the form usable for a non-kill-switch refusal', async () => {
    refusedPreview(400, 'Invalid brand query.');
    await triggerPreview();
    expect(await screen.findByText('Invalid brand query.')).toBeInTheDocument();
    expect(screen.queryByTestId('brand-radar-unavailable')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Brand query')).toBeEnabled();
  });

  it('renders the create-time kill-switch sentence', async () => {
    routeApi({
      create: () => {
        throw new ApiError('Scans are paused.', 503, {
          error: { message: 'Scans are paused.' },
        });
      },
    });
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);
    await user.type(await screen.findByLabelText('Brand query'), 'RankMeFast');
    await user.click(screen.getByRole('button', { name: 'Preview cost' }));
    await screen.findByTestId('brand-radar-preview');
    await user.click(screen.getByRole('button', { name: 'Run the scan' }));

    // Preview error is empty, so the create sentence is the one rendered.
    const banner = await screen.findByTestId('brand-radar-unavailable');
    expect(banner).toHaveTextContent('Scans are paused.');
  });

  it('falls back to the localized description when the refusal carries no sentence', async () => {
    routeApi({});
    const { store } = renderPage();
    act(() => {
      store.dispatch({
        type: previewBrandRadarScanThunk.rejected.type,
        payload: { error: '', unavailable: true },
        meta: { arg: { siteId: PANEL_SITE, input: { brandQuery: 'x' } } },
      });
    });
    expect(await screen.findByTestId('brand-radar-unavailable')).toHaveTextContent(
      'New scans are switched off right now.',
    );
  });
});
