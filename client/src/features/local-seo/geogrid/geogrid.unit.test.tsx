/**
 * Geogrid unit seams the panel suite cannot reach from the UI: the request
 * builders, the URL writer's clear paths, the reducer's housekeeping actions,
 * and the lazy-slice selector fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import type { RootState } from '@app/store';
import {
  createGeogridScan,
  fetchGeogridKeywordOptions,
  fetchGeogridScan,
  fetchGeogridScans,
  previewGeogridScan,
} from './api';
import { GeogridPanel } from './components/GeogridPanel';
import {
  clearGeogridSubmitGate,
  geogridReducer,
  resetGeogrid,
  setGeogridFormField,
} from './store/slice';
import { loadGeogridScans } from './store/thunks';
import * as selectors from './store/selectors';
import {
  selectGeogridForm,
  selectGeogridPreviewDefinition,
  selectGeogridScans,
} from './store/selectors';
import { useGeogridUrlState } from './urlState';
import { initialGeogridState, type GeogridDefinition } from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const SITE_ID = 'a'.repeat(24);
const SCAN_ID = '11111111-1111-4111-8111-111111111111';
const KEYWORD_ID = '22222222-2222-4222-8222-222222222222';

const definition: GeogridDefinition = {
  keywordId: KEYWORD_ID,
  centerLat: 30.2672,
  centerLng: -97.7431,
  spacingMeters: 1_000,
  gridSize: 3,
  zoom: 17,
};

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApiClient.mockReset();
  mockedApiClient.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geogrid request builders', () => {
  it('posts the definition on preview and on create', async () => {
    await previewGeogridScan(SITE_ID, definition);
    // The object is handed to `apiClient` unserialized — it does the JSON
    // encoding, and pre-stringifying would double-encode the request body.
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${SITE_ID}/geogrid/preview`, {
      method: 'POST',
      body: definition,
    });
    await createGeogridScan(SITE_ID, definition);
    expect(mockedApiClient).toHaveBeenCalledWith(`/sites/${SITE_ID}/geogrid/scans`, {
      method: 'POST',
      body: definition,
    });
  });

  it('builds the list query with and without filters', async () => {
    await fetchGeogridScans(SITE_ID);
    expect(mockedApiClient).toHaveBeenLastCalledWith(`/sites/${SITE_ID}/geogrid/scans`);
    await fetchGeogridScans(SITE_ID, { keywordId: KEYWORD_ID, limit: 5 });
    expect(mockedApiClient).toHaveBeenLastCalledWith(
      `/sites/${SITE_ID}/geogrid/scans?keywordId=${KEYWORD_ID}&limit=5`,
    );
    await fetchGeogridScans(SITE_ID, { limit: 1 });
    expect(mockedApiClient).toHaveBeenLastCalledWith(
      `/sites/${SITE_ID}/geogrid/scans?limit=1`,
    );
  });

  it('reads one stored scan', async () => {
    await fetchGeogridScan(SITE_ID, SCAN_ID);
    expect(mockedApiClient).toHaveBeenLastCalledWith(
      `/sites/${SITE_ID}/geogrid/scans/${SCAN_ID}`,
    );
  });

  it('narrows the keyword list to id and phrase', async () => {
    mockedApiClient.mockResolvedValueOnce({
      keywords: [{ id: KEYWORD_ID, phrase: 'dentist austin', locationCode: 2840 }],
    } as never);
    await expect(fetchGeogridKeywordOptions(SITE_ID)).resolves.toEqual([
      { id: KEYWORD_ID, phrase: 'dentist austin' },
    ]);
  });

  it('the list thunk only sends a keyword filter when one is given', async () => {
    const store = configureStore({ reducer: { geogrid: geogridReducer } });
    mockedApiClient.mockResolvedValue({ scans: [] } as never);
    await store.dispatch(loadGeogridScans({ siteId: SITE_ID }));
    expect(mockedApiClient).toHaveBeenLastCalledWith(`/sites/${SITE_ID}/geogrid/scans`);
    await store.dispatch(loadGeogridScans({ siteId: SITE_ID, keywordId: KEYWORD_ID }));
    expect(mockedApiClient).toHaveBeenLastCalledWith(
      `/sites/${SITE_ID}/geogrid/scans?keywordId=${KEYWORD_ID}`,
    );
  });
});

describe('geogrid url state', () => {
  let state: ReturnType<typeof useGeogridUrlState>[0];
  let setState: ReturnType<typeof useGeogridUrlState>[1];
  let search = '';

  const Probe = () => {
    [state, setState] = useGeogridUrlState();
    search = useLocation().search;
    return null;
  };

  const mount = (entry: string) =>
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
      </MemoryRouter>,
    );

  it('reads and clears both params while preserving the tab', async () => {
    mount(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}&cell=4`);
    expect(state).toEqual({ scanId: SCAN_ID, cellIndex: 4 });

    setState({ cellIndex: null });
    await waitFor(() => expect(search).not.toContain('cell='));
    expect(search).toContain(`scan=${SCAN_ID}`);
    expect(search).toContain('tab=geogrid');

    setState({ scanId: null });
    await waitFor(() => expect(search).not.toContain('scan='));
    expect(search).toContain('tab=geogrid');

    setState({});
    await waitFor(() => expect(search).toContain('tab=geogrid'));
  });
});

describe('geogrid slice housekeeping', () => {
  it('clears a submit gate and resets to the initial state', () => {
    const store = configureStore({ reducer: { geogrid: geogridReducer } });
    store.dispatch(setGeogridFormField({ field: 'zoom', value: 12 }));
    expect(selectGeogridForm(store.getState() as unknown as RootState).zoom).toBe(12);
    store.dispatch(clearGeogridSubmitGate());
    store.dispatch(resetGeogrid());
    expect(store.getState().geogrid).toEqual(initialGeogridState);
  });

  it('selectors fall back to the initial state before the slice is injected', () => {
    const bare = {} as RootState;
    expect(selectGeogridScans(bare)).toEqual([]);
    expect(selectGeogridForm(bare)).toEqual(initialGeogridState.form);
    expect(selectGeogridPreviewDefinition(bare)).toBeNull();
  });
});

describe('geogrid panel edge paths', () => {
  const renderPanel = (entry: string) => {
    const store = configureStore({ reducer: { geogrid: geogridReducer } });
    return {
      store,
      ...render(
        <Provider store={store}>
          <I18nextProvider i18n={i18n}>
            <MemoryRouter initialEntries={[entry]}>
              <GeogridPanel siteId={SITE_ID} />
            </MemoryRouter>
          </I18nextProvider>
        </Provider>,
      ),
    };
  };

  const detail = () => ({
    id: SCAN_ID,
    keywordId: KEYWORD_ID,
    keyword: 'dentist austin',
    status: 'completed' as const,
    centerLat: 30.2672,
    centerLng: -97.7431,
    spacingMeters: 1_000,
    gridSize: 3,
    zoom: 17,
    totalCells: 9,
    observedCells: 1,
    notInPackCells: 0,
    failedCells: 0,
    createdAt: '2026-08-02T09:00:00.000Z',
    finishedAt: '2026-08-02T09:00:00.000Z',
    failureReason: null,
    cells: [
      {
        pointIndex: 0,
        lat: 30.276,
        lng: -97.753,
        state: 'observed' as const,
        position: 1,
        totalPackSize: 5,
        capturedAt: '2026-08-02T09:00:00.000Z',
      },
    ],
  });

  const wire = () => {
    mockedApiClient.mockImplementation((path: string) => {
      if (path.includes(`/geogrid/scans/${SCAN_ID}`)) return Promise.resolve(detail()) as never;
      if (path.includes('/geogrid/scans')) return Promise.resolve({ scans: [] }) as never;
      if (path.includes('/keywords')) return Promise.resolve({ keywords: [] }) as never;
      throw new Error(`unexpected ${path}`);
    });
  };

  it('a ?cell= index with no matching cell shows no readout instead of guessing', async () => {
    wire();
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&scan=${SCAN_ID}&cell=8`);
    await screen.findByTestId('geogrid-heat');
    expect(screen.queryByTestId('geogrid-cell-detail')).not.toBeInTheDocument();
  });

  it('a ?cell= index without a loaded scan shows no readout', async () => {
    wire();
    renderPanel(`/sites/${SITE_ID}?tab=geogrid&cell=0`);
    await screen.findByTestId('geogrid-empty');
    expect(screen.queryByTestId('geogrid-cell-detail')).not.toBeInTheDocument();
  });

  it('an unmount before the keyword list resolves does not set state', async () => {
    let resolveKeywords: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveKeywords = resolve;
    });
    mockedApiClient.mockImplementation((path: string) => {
      if (path.includes('/keywords')) return pending as never;
      return Promise.resolve({ scans: [] }) as never;
    });
    const { unmount } = renderPanel(`/sites/${SITE_ID}?tab=geogrid`);
    await screen.findByTestId('geogrid-form');
    unmount();
    resolveKeywords({ keywords: [{ id: KEYWORD_ID, phrase: 'late' }] });
    await pending;
    // No "state update on an unmounted component" warning, and nothing rendered.
    expect(screen.queryByTestId('geogrid-form')).not.toBeInTheDocument();
  });

  it('an unmount before a failing keyword read settles does not set state', async () => {
    let rejectKeywords: (reason: unknown) => void = () => {};
    const pending = new Promise((_resolve, reject) => {
      rejectKeywords = reject;
    });
    mockedApiClient.mockImplementation((path: string) => {
      if (path.includes('/keywords')) return pending as never;
      return Promise.resolve({ scans: [] }) as never;
    });
    const { unmount } = renderPanel(`/sites/${SITE_ID}?tab=geogrid`);
    await screen.findByTestId('geogrid-form');
    unmount();
    rejectKeywords(new Error('too late'));
    await pending.catch(() => undefined);
    expect(screen.queryByTestId('geogrid-form')).not.toBeInTheDocument();
  });
});

describe('geogrid slice — rejection fallbacks', () => {
  it('falls back to an unnamed failure when a thunk rejects without a gate', () => {
    let state = geogridReducer(undefined, { type: '@@init' });
    for (const type of [
      'geogrid/loadScans/rejected',
      'geogrid/loadScan/rejected',
      'geogrid/preview/rejected',
      'geogrid/submit/rejected',
    ]) {
      state = geogridReducer(state, { type, payload: undefined, error: { message: 'boom' } });
    }
    expect(state.scansGate).toEqual({ kind: 'failed', message: '' });
    expect(state.detailGate).toEqual({ kind: 'failed', message: '' });
    expect(state.previewGate).toEqual({ kind: 'failed', message: '' });
    expect(state.submitGate).toEqual({ kind: 'failed', message: '' });
  });
});

describe('geogrid selectors — every read has a fallback', () => {
  it('reads the whole slice through the lazy-injection fallback', () => {
    const bare = {} as RootState;
    expect(selectors.selectGeogridSiteId(bare)).toBeNull();
    expect(selectors.selectGeogridScansStatus(bare)).toBe('idle');
    expect(selectors.selectGeogridScansGate(bare)).toBeNull();
    expect(selectors.selectGeogridDetail(bare)).toBeNull();
    expect(selectors.selectGeogridDetailStatus(bare)).toBe('idle');
    expect(selectors.selectGeogridDetailGate(bare)).toBeNull();
    expect(selectors.selectGeogridPreview(bare)).toBeNull();
    expect(selectors.selectGeogridPreviewStatus(bare)).toBe('idle');
    expect(selectors.selectGeogridPreviewGate(bare)).toBeNull();
    expect(selectors.selectGeogridSubmitting(bare)).toBe(false);
    expect(selectors.selectGeogridSubmitGate(bare)).toBeNull();
  });
});
