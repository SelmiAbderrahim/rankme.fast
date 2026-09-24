/**
 * Geogrid client suite.
 *
 * Covers the form bounds, the preview→confirm disclosure, every honest state,
 * the heat grid including not-in-pack and failed cells, and the mandatory
 * accessible table fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { GeogridPanel } from './components/GeogridPanel';
import { GeogridCellTable } from './components/GeogridCellTable';
import { GeogridScanHistory } from './components/GeogridScanHistory';
import { GeogridOutcomeBanner } from './components/GeogridStatePanels';
import { geogridReducer, setGeogridFormField, setGeogridSiteId } from './store/slice';
import { toGeogridGate, geogridServerMessage } from './gate';
import { bucketForCell, cellsByIndex, formatCoordinate } from './heatScale';
import { parseCellIndex } from './urlState';
import { validateGeogridForm } from './validation';
import {
  initialGeogridState,
  isGeogridSize,
  type GeogridCell,
  type GeogridScanDetail,
  type GeogridScanSummary,
} from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const SITE_ID = 'a'.repeat(24);
const SCAN_ID = '11111111-1111-4111-8111-111111111111';
const KEYWORD_ID = '22222222-2222-4222-8222-222222222222';
const CAPTURED_AT = '2026-08-02T09:00:00.000Z';

const cell = (overrides: Partial<GeogridCell> & { pointIndex: number }): GeogridCell =>
  ({
    lat: 30.276,
    lng: -97.753,
    state: 'observed',
    position: 2,
    totalPackSize: 5,
    capturedAt: CAPTURED_AT,
    ...overrides,
  }) as GeogridCell;

const summary = (overrides: Partial<GeogridScanSummary> = {}): GeogridScanSummary => ({
  id: SCAN_ID,
  keywordId: KEYWORD_ID,
  keyword: 'dentist austin',
  status: 'completed',
  centerLat: 30.2672,
  centerLng: -97.7431,
  spacingMeters: 1_000,
  gridSize: 3,
  zoom: 17,
  totalCells: 9,
  observedCells: 9,
  notInPackCells: 0,
  failedCells: 0,
  createdAt: CAPTURED_AT,
  finishedAt: CAPTURED_AT,
  failureReason: null,
  ...overrides,
});

const detail = (overrides: Partial<GeogridScanDetail> = {}): GeogridScanDetail => ({
  ...summary(),
  cells: [
    cell({ pointIndex: 0, position: 1 }),
    cell({ pointIndex: 1, position: 5 }),
    cell({ pointIndex: 2, position: 12 }),
    cell({ pointIndex: 3, state: 'not_in_pack', position: null } as never),
    { pointIndex: 4, lat: 30.267, lng: -97.743, state: 'failed' },
  ],
  status: 'completed_partial',
  observedCells: 3,
  notInPackCells: 1,
  failedCells: 1,
  ...overrides,
});

interface Handlers {
  scans?: () => unknown;
  scan?: () => unknown;
  preview?: () => unknown;
  create?: () => unknown;
  keywords?: () => unknown;
}

const wireApi = (handlers: Handlers = {}) => {
  mockedApiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.includes('/geogrid/preview')) {
      return Promise.resolve(
        handlers.preview?.() ?? { cellCount: 9, preview: {} },
      ) as never;
    }
    if (path.includes(`/geogrid/scans/${SCAN_ID}`)) {
      return Promise.resolve(handlers.scan?.() ?? detail()) as never;
    }
    if (path.includes('/geogrid/scans') && init?.method === 'POST') {
      return Promise.resolve(
        handlers.create?.() ?? { scanId: SCAN_ID, status: 'queued', cellCount: 9 },
      ) as never;
    }
    if (path.includes('/geogrid/scans')) {
      return Promise.resolve(handlers.scans?.() ?? { scans: [summary()] }) as never;
    }
    if (path.includes('/keywords')) {
      return Promise.resolve(
        handlers.keywords?.() ?? { keywords: [{ id: KEYWORD_ID, phrase: 'dentist austin' }] },
      ) as never;
    }
    throw new Error(`unexpected path ${path}`);
  });
};

let search = '';
const LocationProbe = () => {
  search = useLocation().search;
  return null;
};

const renderPanel = (entry = `/sites/${SITE_ID}?tab=geogrid`) => {
  search = '';
  const store = configureStore({ reducer: { geogrid: geogridReducer } });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[entry]}>
            <GeogridPanel siteId={SITE_ID} />
            <LocationProbe />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

const httpError = (status: number, message?: string) =>
  new ApiError('failed', status, message ? { error: { message } } : undefined);

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geogrid pure helpers', () => {
  it('recognises the three offered grid sizes', () => {
    expect(isGeogridSize(3)).toBe(true);
    expect(isGeogridSize(7)).toBe(true);
    expect(isGeogridSize(9)).toBe(false);
    expect(isGeogridSize('3')).toBe(false);
  });

  it('buckets a cell by its position and state', () => {
    expect(bucketForCell(cell({ pointIndex: 0, position: 1 }))).toBe('top');
    expect(bucketForCell(cell({ pointIndex: 0, position: 3 }))).toBe('top');
    expect(bucketForCell(cell({ pointIndex: 0, position: 4 }))).toBe('mid');
    expect(bucketForCell(cell({ pointIndex: 0, position: 7 }))).toBe('mid');
    expect(bucketForCell(cell({ pointIndex: 0, position: 8 }))).toBe('low');
    expect(
      bucketForCell(cell({ pointIndex: 0, state: 'not_in_pack', position: null } as never)),
    ).toBe('notInPack');
    expect(
      bucketForCell({ pointIndex: 0, lat: 1, lng: 2, state: 'failed' }),
    ).toBe('failed');
  });

  it('lays cells out by pointIndex and leaves unsettled slots undefined', () => {
    const slots = cellsByIndex([cell({ pointIndex: 2 })], 4);
    expect(slots).toHaveLength(4);
    expect(slots[2]).toMatchObject({ pointIndex: 2 });
    expect(slots[0]).toBeUndefined();
  });

  it('formats a coordinate pair', () => {
    expect(formatCoordinate(30.1, -97.2)).toBe('30.1, -97.2');
  });

  it('parses the ?cell= index and rejects nonsense', () => {
    expect(parseCellIndex('0')).toBe(0);
    expect(parseCellIndex('12')).toBe(12);
    expect(parseCellIndex(null)).toBeNull();
    expect(parseCellIndex('')).toBeNull();
    expect(parseCellIndex('-1')).toBeNull();
    expect(parseCellIndex('1.5')).toBeNull();
    expect(parseCellIndex('nope')).toBeNull();
  });

  it('maps every refusal status onto a named gate carrying the server message', () => {
    expect(toGeogridGate(httpError(400, 'bad grid'), 'fallback')).toEqual({
      kind: 'invalid',
      message: 'bad grid',
    });
    expect(toGeogridGate(httpError(503), 'fallback')).toEqual({
      kind: 'killSwitch',
      message: 'fallback',
    });
    expect(toGeogridGate(httpError(404), 'f').kind).toBe('notFound');
    expect(toGeogridGate(httpError(429), 'f').kind).toBe('rateLimited');
    expect(toGeogridGate(httpError(418), 'f').kind).toBe('failed');
    expect(toGeogridGate(new Error('boom'), 'f')).toEqual({ kind: 'failed', message: 'f' });
    expect(geogridServerMessage(new Error('boom'))).toBe('');
    expect(geogridServerMessage(new ApiError('x', 500, { error: { message: 7 } }))).toBe('');
  });

  it('validates every bound the server enforces', () => {
    const base = {
      keywordId: KEYWORD_ID,
      centerLat: '30.2672',
      centerLng: '-97.7431',
      spacingMeters: 1_000,
      gridSize: 3 as const,
      zoom: 17,
    };
    expect(validateGeogridForm(base).definition).toMatchObject({ gridSize: 3 });
    expect(validateGeogridForm({ ...base, keywordId: '' }).errors).toContain('keywordId');
    expect(validateGeogridForm({ ...base, centerLat: '' }).errors).toContain('centerLat');
    expect(validateGeogridForm({ ...base, centerLat: 'abc' }).errors).toContain('centerLat');
    expect(validateGeogridForm({ ...base, centerLat: '89' }).errors).toContain('centerLat');
    expect(validateGeogridForm({ ...base, centerLng: '181' }).errors).toContain('centerLng');
    expect(validateGeogridForm({ ...base, spacingMeters: 50 }).errors).toContain(
      'spacingMeters',
    );
    expect(validateGeogridForm({ ...base, spacingMeters: 20_000 }).errors).toContain(
      'spacingMeters',
    );
    expect(validateGeogridForm({ ...base, spacingMeters: 150 }).errors).toContain(
      'spacingMeters',
    );
    expect(validateGeogridForm({ ...base, zoom: 2 }).errors).toContain('zoom');
    expect(validateGeogridForm({ ...base, zoom: 22 }).errors).toContain('zoom');
    expect(validateGeogridForm({ ...base, zoom: 17.5 }).errors).toContain('zoom');
    // A well-formed shape whose keyword id is not a uuid still fails the mirror.
    expect(validateGeogridForm({ ...base, keywordId: 'not-a-uuid' })).toEqual({
      definition: null,
      errors: ['keywordId'],
    });
  });

});

describe('geogrid slice', () => {
  it('drops stored reads when the site changes and keeps them when it does not', () => {
    const store = configureStore({ reducer: { geogrid: geogridReducer } });
    store.dispatch(setGeogridSiteId(SITE_ID));
    store.dispatch(setGeogridFormField({ field: 'centerLat', value: '30' }));
    expect(store.getState().geogrid.form.centerLat).toBe('30');
    store.dispatch(setGeogridSiteId(SITE_ID));
    expect(store.getState().geogrid.form.centerLat).toBe('30');
    store.dispatch(setGeogridSiteId('b'.repeat(24)));
    expect(store.getState().geogrid.form.centerLat).toBe(
      initialGeogridState.form.centerLat,
    );
  });
});

describe('geogrid panel — states', () => {
  it('renders the empty history and the no-scan-selected state', async () => {
    wireApi({ scans: () => ({ scans: [] }) });
    renderPanel();
    expect(await screen.findByTestId('geogrid-history-empty')).toBeInTheDocument();
    expect(screen.getByTestId('geogrid-empty')).toBeInTheDocument();
  });

  it('surfaces a rate-limit refusal with the server message', async () => {
    wireApi({ preview: () => Promise.reject(httpError(429, 'Slow down.')) });
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-form');
    await screen.findByRole('option', { name: 'dentist austin' });
    await user.selectOptions(screen.getByTestId('geogrid-keyword'), KEYWORD_ID);
    await user.type(screen.getByTestId('geogrid-lat'), '30.2672');
    await user.type(screen.getByTestId('geogrid-lng'), '-97.7431');
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    expect(await screen.findByTestId('geogrid-gate-rateLimited')).toHaveTextContent(
      'Slow down.',
    );
  });

  it('surfaces the kill switch without inventing copy', async () => {
    wireApi({ preview: () => Promise.reject(httpError(503, 'Geogrid scans are paused.')) });
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-form');
    await screen.findByRole('option', { name: 'dentist austin' });
    await user.selectOptions(screen.getByTestId('geogrid-keyword'), KEYWORD_ID);
    await user.type(screen.getByTestId('geogrid-lat'), '30.2672');
    await user.type(screen.getByTestId('geogrid-lng'), '-97.7431');
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    expect(await screen.findByTestId('geogrid-gate-killSwitch')).toHaveTextContent(
      'Geogrid scans are paused.',
    );
  });

  it('shows a failed history load as a gate', async () => {
    wireApi({ scans: () => Promise.reject(httpError(500)) });
    renderPanel();
    expect(await screen.findByTestId('geogrid-gate-failed')).toBeInTheDocument();
  });

  it('shows a failed detail load as a gate', async () => {
    wireApi({ scan: () => Promise.reject(httpError(404, 'Geogrid scan not found.')) });
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}`);
    expect(await screen.findByTestId('geogrid-gate-notFound')).toBeInTheDocument();
  });

  it('keeps an empty keyword picker when the keyword read fails', async () => {
    wireApi({ keywords: () => Promise.reject(httpError(500)) });
    renderPanel();
    await screen.findByTestId('geogrid-form');
    await waitFor(() =>
      expect(within(screen.getByTestId('geogrid-keyword')).getAllByRole('option')).toHaveLength(
        1,
      ),
    );
  });
});

describe('geogrid panel — form bounds', () => {
  it('blocks submit and names each out-of-range field', async () => {
    wireApi();
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-form');
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    expect(await screen.findByText('Choose a tracked keyword first.')).toBeInTheDocument();
    expect(
      screen.getByText('Latitude must be between -85 and 85.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Longitude must be between -180 and 180.')).toBeInTheDocument();
    // No preview request left the client.
    expect(
      mockedApiClient.mock.calls.some(([path]) => String(path).includes('/geogrid/preview')),
    ).toBe(false);
  });

  it('rejects an out-of-range spacing typed into the custom field', async () => {
    wireApi();
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-form');
    await screen.findByRole('option', { name: 'dentist austin' });
    await user.selectOptions(screen.getByTestId('geogrid-keyword'), KEYWORD_ID);
    await user.type(screen.getByTestId('geogrid-lat'), '30.2672');
    await user.type(screen.getByTestId('geogrid-lng'), '-97.7431');
    await user.clear(screen.getByTestId('geogrid-spacing-custom'));
    await user.type(screen.getByTestId('geogrid-spacing-custom'), '150');
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    expect(
      await screen.findByText(
        'Spacing must be between 100 and 10000 metres, in steps of 100.',
      ),
    ).toBeInTheDocument();
  });

  it('rejects an out-of-range zoom', async () => {
    wireApi();
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-form');
    await screen.findByRole('option', { name: 'dentist austin' });
    await user.selectOptions(screen.getByTestId('geogrid-keyword'), KEYWORD_ID);
    await user.type(screen.getByTestId('geogrid-lat'), '30.2672');
    await user.type(screen.getByTestId('geogrid-lng'), '-97.7431');
    await user.clear(screen.getByTestId('geogrid-zoom'));
    await user.type(screen.getByTestId('geogrid-zoom'), '22');
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    expect(await screen.findByText('Zoom must be between 3 and 21.')).toBeInTheDocument();
  });

  it('offers every grid size and carries the choice into the request', async () => {
    wireApi();
    const { store } = renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-form');
    await user.click(screen.getByLabelText('7 by 7 (49 points)'));
    expect(store.getState().geogrid.form.gridSize).toBe(7);
    await user.click(screen.getByLabelText('2 km'));
    expect(store.getState().geogrid.form.spacingMeters).toBe(2000);
  });
});

describe('geogrid panel — preview and confirm', () => {
  const fillForm = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByTestId('geogrid-form');
    await screen.findByRole('option', { name: 'dentist austin' });
    await user.selectOptions(screen.getByTestId('geogrid-keyword'), KEYWORD_ID);
    await user.type(screen.getByTestId('geogrid-lat'), '30.2672');
    await user.type(screen.getByTestId('geogrid-lng'), '-97.7431');
  };

  it('discloses the cell count before any spend', async () => {
    wireApi();
    renderPanel();
    const user = userEvent.setup();
    await fillForm(user);
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    const card = await screen.findByTestId('geogrid-preview-card');
    expect(card).toHaveTextContent('1 geogrid scan covers all 9 grid points.');
    expect(
      mockedApiClient.mock.calls.filter(([, init]) => (init as { method?: string })?.method === 'POST'),
    ).toHaveLength(1);
  });

  it('cancel spends nothing', async () => {
    wireApi();
    renderPanel();
    const user = userEvent.setup();
    await fillForm(user);
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    await screen.findByTestId('geogrid-preview-card');
    await user.click(screen.getByTestId('geogrid-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('geogrid-preview-card')).not.toBeInTheDocument(),
    );
    const scanPosts = mockedApiClient.mock.calls.filter(
      ([path, init]) =>
        String(path).endsWith('/geogrid/scans') &&
        (init as { method?: string })?.method === 'POST',
    );
    expect(scanPosts).toHaveLength(0);
  });

  it('editing the grid after a preview invalidates the stale estimate', async () => {
    wireApi();
    renderPanel();
    const user = userEvent.setup();
    await fillForm(user);
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    await screen.findByTestId('geogrid-preview-card');
    await user.click(screen.getByLabelText('5 by 5 (25 points)'));
    await waitFor(() =>
      expect(screen.queryByTestId('geogrid-preview-card')).not.toBeInTheDocument(),
    );
  });

  it('confirm submits the scan and selects it in the URL', async () => {
    wireApi();
    renderPanel();
    const user = userEvent.setup();
    await fillForm(user);
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    await screen.findByTestId('geogrid-preview-card');
    await user.click(screen.getByTestId('geogrid-confirm'));
    await waitFor(() => expect(search).toContain(`scan=${SCAN_ID}`));
    expect(search).toContain('tab=geogrid');
  });

  it('a refused submit shows the server message and selects nothing', async () => {
    wireApi({ create: () => Promise.reject(httpError(503, 'Scans are paused.')) });
    renderPanel();
    const user = userEvent.setup();
    await fillForm(user);
    await user.click(screen.getByTestId('geogrid-preview-submit'));
    await screen.findByTestId('geogrid-preview-card');
    await user.click(screen.getByTestId('geogrid-confirm'));
    expect(await screen.findByTestId('geogrid-gate-killSwitch')).toHaveTextContent(
      'Scans are paused.',
    );
    expect(search).not.toContain('scan=');
  });
});

describe('geogrid heat grid and table fallback', () => {
  it('renders every cell state distinctly and keeps failed cells out of not-in-pack', async () => {
    wireApi();
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}`);
    await screen.findByTestId('geogrid-heat');

    expect(screen.getByTestId('geogrid-cell-0')).toHaveAttribute('data-state', 'observed');
    expect(screen.getByTestId('geogrid-cell-3')).toHaveAttribute('data-state', 'not_in_pack');
    expect(screen.getByTestId('geogrid-cell-4')).toHaveAttribute('data-state', 'failed');
    // A cell the scan has not settled yet is pending, never an outcome.
    expect(screen.getByTestId('geogrid-cell-8')).toHaveAttribute('data-state', 'pending');

    expect(screen.getByTestId('geogrid-cell-3')).toHaveTextContent(
      'not in the local pack',
    );
    expect(screen.getByTestId('geogrid-cell-4')).toHaveTextContent('the check failed');
    expect(screen.getByTestId('geogrid-cell-4')).not.toHaveTextContent(
      'not in the local pack',
    );
  });

  it('always renders the accessible table fallback', async () => {
    wireApi();
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}`);
    const table = await screen.findByTestId('geogrid-cell-table');
    expect(table).toHaveTextContent(
      'Every grid point, its coordinate, and what we saw there.',
    );
    const failedRow = screen.getByTestId('geogrid-cell-row-4');
    expect(failedRow).toHaveTextContent('Check failed');
    const notInPackRow = screen.getByTestId('geogrid-cell-row-3');
    expect(notInPackRow).toHaveTextContent('Not in the pack');
  });

  it('a cell click is URL-backed and shows the focused readout', async () => {
    wireApi();
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}`);
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-heat');
    await user.click(screen.getByTestId('geogrid-cell-0'));
    await waitFor(() => expect(search).toContain('cell=0'));
    expect(await screen.findByTestId('geogrid-cell-detail')).toHaveTextContent(
      'Point 1 ranks 1 of 5',
    );
    await user.click(screen.getByTestId('geogrid-cell-3'));
    await waitFor(() =>
      expect(screen.getByTestId('geogrid-cell-detail')).toHaveTextContent(
        'Point 4 is not in the local pack',
      ),
    );
    await user.click(screen.getByTestId('geogrid-cell-4'));
    await waitFor(() =>
      expect(screen.getByTestId('geogrid-cell-detail')).toHaveTextContent(
        'Point 5 could not be checked',
      ),
    );
  });

  it('discloses a partial scan with the exact failed count', async () => {
    wireApi();
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}`);
    expect(await screen.findByTestId('geogrid-partial-banner')).toHaveTextContent(
      '1 of 9 points failed.',
    );
  });

  it('discloses a fully failed scan', async () => {
    wireApi({
      scan: () => detail({ status: 'failed', cells: [], failedCells: 9 }),
    });
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}`);
    expect(await screen.findByTestId('geogrid-failed-banner')).toHaveTextContent(
      'there is nothing to show',
    );
  });

  it('a running scan says so instead of implying an empty grid', async () => {
    wireApi({ scan: () => detail({ status: 'running', cells: [] }) });
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}`);
    expect(await screen.findByTestId('geogrid-running')).toBeInTheDocument();
  });

  it('polls a queued scan until the grid reaches a terminal state', async () => {
    let reads = 0;
    wireApi({
      scan: () => {
        reads += 1;
        return reads === 1
          ? detail({ status: 'queued', cells: [] })
          : detail({ status: 'completed' });
      },
    });
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}`);
    expect(await screen.findByTestId('geogrid-running')).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.queryByTestId('geogrid-running')).not.toBeInTheDocument();
        expect(reads).toBeGreaterThanOrEqual(2);
      },
      { timeout: 4_000 },
    );
  });

  it('reopening a stored scan from history is free and URL-backed', async () => {
    wireApi();
    renderPanel();
    const user = userEvent.setup();
    await screen.findByTestId('geogrid-history');
    await user.click(screen.getByTestId(`geogrid-history-row-${SCAN_ID}`));
    await waitFor(() => expect(search).toContain(`scan=${SCAN_ID}`));
    const posts = mockedApiClient.mock.calls.filter(
      ([, init]) => (init as { method?: string })?.method === 'POST',
    );
    expect(posts).toHaveLength(0);
  });
});

describe('geogrid presentational components', () => {
  const renderWithI18n = (node: React.ReactElement) =>
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{node}</MemoryRouter>
      </I18nextProvider>,
    );

  it('the outcome banner renders nothing for a clean scan', () => {
    const { container } = renderWithI18n(<GeogridOutcomeBanner scan={summary()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the table renders an empty body without inventing rows', () => {
    renderWithI18n(<GeogridCellTable cells={[]} />);
    expect(screen.getByTestId('geogrid-cell-table')).toBeInTheDocument();
    expect(screen.queryByTestId('geogrid-cell-row-0')).not.toBeInTheDocument();
  });

  it('the history highlights the selected scan', () => {
    renderWithI18n(
      <GeogridScanHistory scans={[summary()]} selectedScanId={SCAN_ID} onSelect={() => {}} />,
    );
    expect(screen.getByTestId(`geogrid-history-row-${SCAN_ID}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('geogrid — Arabic RTL', () => {
  it('renders the grid and the table fallback in Arabic', async () => {
    await changeLanguage('ar');
    wireApi();
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}`);
    expect(await screen.findByTestId('geogrid-heat')).toBeInTheDocument();
    expect(screen.getByTestId('geogrid-cell-table')).toHaveTextContent('خط العرض');
    // pointIndex ordering is direction-independent.
    expect(screen.getByTestId('geogrid-cell-row-0')).toBeInTheDocument();
    await changeLanguage('en');
  });
});
