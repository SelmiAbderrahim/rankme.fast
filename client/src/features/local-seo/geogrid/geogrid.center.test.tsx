/**
 * The geogrid centre picker: the stored Local SEO business location, a place
 * search through the existing business lookup (nothing saved), and typed
 * coordinates as the advanced option.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { SiteLifecycleProvider } from '@shared/site/capabilities';
import { GeogridPanel } from './components/GeogridPanel';
import { geogridReducer, setGeogridFormField } from './store/slice';
import { isolateText } from '@shared/lib/bidi';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const SITE_ID = 'a'.repeat(24);
const KEYWORD_ID = '22222222-2222-4222-8222-222222222222';
const LAST_SCAN = {
  id: '11111111-1111-4111-8111-111111111111',
  keywordId: KEYWORD_ID,
  keyword: 'dentist austin',
  status: 'completed',
  centerLat: 10.5,
  centerLng: 20.5,
  spacingMeters: 1_000,
  gridSize: 3,
  zoom: 17,
  cellCount: 9,
  observedCount: 9,
  failedCount: 0,
  createdAt: '2026-08-02T09:00:00.000Z',
  completedAt: '2026-08-02T09:05:00.000Z',
};

const business = (overrides: Record<string, unknown> = {}) => ({
  selected: {
    placeId: 'ChIJclinic',
    cid: null,
    name: 'Main Street Clinic',
    address: '1 Main St, Austin',
    phone: null,
    domain: null,
    category: 'Dentist',
    latitude: 30.2672,
    longitude: -97.7431,
    locationCode: 2840,
    languageCode: 'en',
    selectedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  },
  candidates: [],
  query: null,
  candidatesExpireAt: null,
});

const NO_BUSINESS = { selected: null, candidates: [], query: null, candidatesExpireAt: null };

const GEOGRID_PREVIEW = {
  cellCount: 9,
  preview: { deploymentMode: 'community', capacityEnforced: false },
};

interface Wire {
  business?: () => Promise<unknown>;
  scans?: unknown[];
  places?: () => Promise<unknown>;
}

const wire = (handlers: Wire = {}) => {
  mockedApiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.endsWith('/local-seo/business')) {
      return (handlers.business ? handlers.business() : Promise.resolve(NO_BUSINESS)) as never;
    }
    if (path.endsWith('/local-seo/places/search')) {
      return (handlers.places ? handlers.places() : Promise.resolve({ query: 'x', places: [] })) as never;
    }
    if (path.includes('/geogrid/preview')) return Promise.resolve(GEOGRID_PREVIEW) as never;
    if (path.includes('/geogrid/scans') && init?.method !== 'POST') {
      return Promise.resolve({ scans: handlers.scans ?? [] }) as never;
    }
    if (path.includes('/keywords')) {
      return Promise.resolve({ keywords: [{ id: KEYWORD_ID, phrase: 'dentist austin' }] }) as never;
    }
    throw new Error(`unexpected ${path}`);
  });
};

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const renderPanel = (options: { paused?: boolean } = {}) => {
  const store = configureStore({ reducer: { geogrid: geogridReducer } });
  const view = render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/sites/${SITE_ID}?tab=geogrid`]}>
          <SiteLifecycleProvider paused={options.paused ?? false}>
            <GeogridPanel siteId={SITE_ID} />
          </SiteLifecycleProvider>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return { store, ...view };
};

const geogridPreviewBody = () => {
  const call = mockedApiClient.mock.calls.find(([path]) => String(path).includes('/geogrid/preview'));
  return (call?.[1] as { body?: { centerLat: number; centerLng: number } } | undefined)?.body;
};

const modeRadio = (mode: 'business' | 'place' | 'coordinates') =>
  screen.getByTestId(`geogrid-center-mode-${mode}`);

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geogrid centre: stored business', () => {
  it('starts from the saved business location and scans around it', async () => {
    wire({ business: () => Promise.resolve(business()) });
    renderPanel();
    const user = userEvent.setup();
    expect(await screen.findByTestId('geogrid-center-business')).toHaveTextContent('Main Street Clinic');
    expect(screen.getByTestId('geogrid-center-business')).toHaveTextContent('1 Main St, Austin');
    expect(modeRadio('business')).toBeChecked();
    expect(await screen.findByTestId('geogrid-center-current')).toHaveTextContent(
      'The grid will be centered on 30.26720, -97.74310',
    );
    // Raw coordinates are not in the way unless asked for.
    expect(screen.queryByTestId('geogrid-lat')).not.toBeInTheDocument();
    await screen.findByRole('option', { name: 'dentist austin' });
    await user.selectOptions(screen.getByTestId('geogrid-keyword'), KEYWORD_ID);
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    await screen.findByTestId('geogrid-preview-card');
    expect(geogridPreviewBody()).toMatchObject({ centerLat: 30.2672, centerLng: -97.7431 });
    expect(mockedApiClient.mock.calls.some(([path]) => String(path).includes('/places/search'))).toBe(false);
  });

  it('never overwrites a centre that is already set', async () => {
    const pending = deferred<unknown>();
    wire({ business: () => pending.promise });
    const { store } = renderPanel();
    await screen.findByTestId('geogrid-center');
    act(() => {
      store.dispatch(setGeogridFormField({ field: 'centerLat', value: '1.5' }));
      store.dispatch(setGeogridFormField({ field: 'centerLng', value: '2.5' }));
    });
    await act(async () => pending.resolve(business()));
    expect(await screen.findByTestId('geogrid-center-business')).toBeInTheDocument();
    expect(screen.getByTestId('geogrid-center-current')).toHaveTextContent('1.50000, 2.50000');
  });

  it('picking "My business" while it loads fills the centre once it arrives', async () => {
    const pending = deferred<unknown>();
    wire({ business: () => pending.promise });
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-place-query');
    await user.click(modeRadio('business'));
    expect(screen.getByText('Loading your business…')).toBeInTheDocument();
    await act(async () => pending.resolve(business()));
    expect(await screen.findByTestId('geogrid-center-current')).toHaveTextContent('30.26720, -97.74310');
  });

  it('ignores a business answer that arrives after the panel is gone', async () => {
    const ok = deferred<unknown>();
    wire({ business: () => ok.promise });
    const first = renderPanel();
    await screen.findByTestId('geogrid-center');
    first.unmount();
    await act(async () => ok.resolve(business()));

    let fail: (reason: unknown) => void = () => undefined;
    wire({ business: () => new Promise((_resolve, reject) => { fail = reject; }) });
    const second = renderPanel();
    await screen.findByTestId('geogrid-center');
    second.unmount();
    await act(async () => fail(new ApiError('late', 500, null)));
    expect(screen.queryByTestId('geogrid-center')).not.toBeInTheDocument();
  });

  it('shows no centre for a value that is not a number', async () => {
    wire({ business: () => Promise.resolve(business({ latitude: null, longitude: null })) });
    const { store } = renderPanel();
    await screen.findByTestId('geogrid-place-query');
    act(() => {
      store.dispatch(setGeogridFormField({ field: 'centerLat', value: 'north' }));
      store.dispatch(setGeogridFormField({ field: 'centerLng', value: '2' }));
    });
    expect(screen.queryByTestId('geogrid-center-current')).not.toBeInTheDocument();
  });

  it('switching back to the business refills its location', async () => {
    wire({ business: () => Promise.resolve(business()), scans: [LAST_SCAN] });
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-center-business');
    await user.click(modeRadio('coordinates'));
    await user.click(await screen.findByTestId('geogrid-use-last-center'));
    expect(screen.getByTestId('geogrid-lat')).toHaveValue(10.5);
    await user.click(modeRadio('business'));
    expect(screen.getByTestId('geogrid-center-current')).toHaveTextContent('30.26720, -97.74310');
  });

  it('says when the business has no map location and falls back to the last scan', async () => {
    wire({ business: () => Promise.resolve(business({ latitude: null, longitude: null, address: null })), scans: [LAST_SCAN] });
    renderPanel();
    const user = userEvent.setup();
    // No usable business location, an earlier scan exists: coordinates first.
    expect(await screen.findByTestId('geogrid-use-last-center')).toBeInTheDocument();
    expect(modeRadio('coordinates')).toBeChecked();
    await user.click(modeRadio('business'));
    const card = screen.getByTestId('geogrid-center-business');
    expect(card).toHaveTextContent('No address listed');
    expect(card).toHaveTextContent('This business has no map location in its listing.');
    expect(screen.queryByTestId('geogrid-center-current')).not.toBeInTheDocument();
  });

  it('links to Local SEO setup when no business is chosen yet', async () => {
    wire();
    renderPanel();
    const user = userEvent.setup();
    // Nothing stored and no earlier scan: the place search comes first.
    expect(await screen.findByTestId('geogrid-place-query')).toBeInTheDocument();
    await user.click(modeRadio('business'));
    const none = await screen.findByTestId('geogrid-center-business-none');
    expect(none).toHaveTextContent('This site has no business set up yet.');
    expect(within(none).getByRole('link', { name: 'Set up your business' })).toHaveAttribute(
      'href',
      `/sites/${SITE_ID}?tab=local-seo&view=setup`,
    );
  });

  it('keeps working when the business cannot be loaded', async () => {
    wire({ business: () => Promise.reject(new ApiError('nope', 402, null)) });
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-place-query');
    await user.click(modeRadio('business'));
    expect(await screen.findByRole('status')).toHaveTextContent('Could not load your business.');
  });

  it('asks for a centre when none is set outside coordinate mode', async () => {
    wire();
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-place-query');
    await screen.findByRole('option', { name: 'dentist austin' });
    await user.selectOptions(screen.getByTestId('geogrid-keyword'), KEYWORD_ID);
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    expect(await screen.findByTestId('geogrid-center-required')).toHaveTextContent('Choose a center for the grid.');
    expect(geogridPreviewBody()).toBeUndefined();
  });
});

describe('geogrid centre: place search', () => {
  const PLACES = {
    query: 'Main St',
    places: [
      {
        placeId: 'ChIJmain',
        cid: null,
        name: 'Main Street Clinic',
        address: '1 Main St, Austin',
        phone: null,
        domain: null,
        category: null,
        latitude: 30.1,
        longitude: -97.1,
      },
      {
        placeId: null,
        cid: null,
        name: 'Main Street Park',
        address: null,
        phone: null,
        domain: null,
        category: null,
        latitude: 30.2,
        longitude: -97.2,
      },
    ],
  };

  it('searches once on Enter, and the chosen place becomes the centre', async () => {
    wire({ places: () => Promise.resolve(PLACES) });
    renderPanel();
    const user = userEvent.setup();
    const query = await screen.findByTestId('geogrid-place-query');
    await user.type(query, 'Main St');
    // Enter searches; it never submits the grid form.
    await user.keyboard('{Enter}');
    expect(geogridPreviewBody()).toBeUndefined();
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${SITE_ID}/local-seo/places/search`, {
      method: 'POST',
      body: { query: 'Main St' },
    });
    const results = await screen.findByTestId('geogrid-place-results');
    expect(screen.getByText(`2 places for “${isolateText('Main St')}”. Pick the center:`)).toBeInTheDocument();
    expect(screen.getByTestId('geogrid-place-result-1')).toHaveTextContent('No address listed');
    expect(screen.getByTestId('geogrid-place-result-1')).toHaveTextContent('30.20000, -97.20000');
    await user.click(within(results).getAllByRole('radio')[1]!);
    expect(screen.getByTestId('geogrid-center-current')).toHaveTextContent('30.20000, -97.20000');
    await screen.findByRole('option', { name: 'dentist austin' });
    await user.selectOptions(screen.getByTestId('geogrid-keyword'), KEYWORD_ID);
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    await screen.findByTestId('geogrid-preview-card');
    expect(geogridPreviewBody()).toMatchObject({ centerLat: 30.2, centerLng: -97.2 });
  });

  it('searches from the button too, and keeps the results while a place is chosen', async () => {
    wire({ places: () => Promise.resolve(PLACES) });
    renderPanel();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('geogrid-place-query'), 'Main St');
    await user.click(screen.getByTestId('geogrid-place-search'));
    const results = await screen.findByTestId('geogrid-place-results');
    await user.click(within(results).getAllByRole('radio')[0]!);
    expect(modeRadio('place')).toBeChecked();
    expect(screen.getByTestId('geogrid-center-current')).toHaveTextContent('30.10000, -97.10000');
  });

  it('rejects a query that is too short or too long before any lookup', async () => {
    wire();
    renderPanel();
    const user = userEvent.setup();
    const query = await screen.findByTestId('geogrid-place-query');
    await user.type(query, 'a');
    await user.click(screen.getByTestId('geogrid-place-search'));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter between 2 and 200 characters.');
    expect(query).toHaveAttribute('aria-invalid', 'true');
    expect(query).toHaveFocus();
    await user.type(query, 'b');
    expect(query).not.toHaveAttribute('aria-invalid');
    query.removeAttribute('maxlength');
    await user.clear(query);
    await user.click(query);
    await user.paste('x'.repeat(201));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter between 2 and 200 characters.');
    expect(mockedApiClient.mock.calls.some(([path]) => String(path).includes('/places/search'))).toBe(false);
  });

  it('other keys in the place field do nothing special', async () => {
    wire();
    renderPanel();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('geogrid-place-query'), 'Ma{Tab}');
    expect(mockedApiClient.mock.calls.some(([path]) => String(path).includes('/places/search'))).toBe(false);
  });

  it('says so when nothing with a map location matched', async () => {
    wire({ places: () => Promise.resolve({ query: 'Nowhere', places: [] }) });
    renderPanel();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('geogrid-place-query'), 'Nowhere');
    await user.click(screen.getByTestId('geogrid-place-search'));
    expect(await screen.findByTestId('geogrid-place-no-results')).toHaveTextContent(
      `No places with a map location found for “${isolateText('Nowhere')}”.`,
    );
  });

  it('shows the server message when the search is refused', async () => {
    wire({
      places: () => Promise.reject(new ApiError('down', 503, { error: { message: 'Listings are unavailable.' } })),
    });
    renderPanel();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('geogrid-place-query'), 'Main St');
    await user.click(screen.getByTestId('geogrid-place-search'));
    expect(await screen.findByTestId('geogrid-place-error')).toHaveTextContent('Listings are unavailable.');
  });

  it('a paused site cannot search, by button or by Enter, and says why', async () => {
    wire();
    renderPanel({ paused: true });
    const user = userEvent.setup();
    const query = await screen.findByTestId('geogrid-place-query');
    const button = screen.getByTestId('geogrid-place-search');
    expect(button).toBeDisabled();
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(query.getAttribute('aria-describedby')).toContain(button.getAttribute('aria-describedby')!);
    await user.type(query, 'Main St{Enter}');
    expect(mockedApiClient.mock.calls.some(([path]) => String(path).includes('/places/search'))).toBe(false);
  });

  it('reads in Arabic', async () => {
    await changeLanguage('ar');
    wire();
    renderPanel();
    expect(await screen.findByText('البحث عن مكان')).toBeInTheDocument();
    expect(screen.getByText('مركز الشبكة')).toBeInTheDocument();
  });
});
