import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import { ApiError, apiClient } from '@shared/api/client';
import { previewFixture, scanFixture } from './__fixtures__/scans';
import {
  brandRadarReducer,
  clearBrandRadarPreview,
  initialBrandRadarState,
  resetBrandRadar,
} from './store/slice';
import {
  createBrandRadarScanThunk,
  loadBrandRadarScans,
  previewBrandRadarScanThunk,
} from './store/thunks';
import {
  selectBrandRadarCreateError,
  selectBrandRadarCreateStatus,
  selectBrandRadarHasPending,
  selectBrandRadarItems,
  selectBrandRadarListError,
  selectBrandRadarListStatus,
  selectBrandRadarLoadingMore,
  selectBrandRadarNextCursor,
  selectBrandRadarOptimistic,
  selectBrandRadarPreview,
  selectBrandRadarPreviewError,
  selectBrandRadarPreviewStatus,
  selectBrandRadarRows,
  selectBrandRadarUnavailable,
} from './store/selectors';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);
const SITE = '65f000000000000000000abc';

const makeStore = () => configureStore({ reducer: { brandRadar: brandRadarReducer } });

const unavailableError = () =>
  new ApiError('off', 503, { error: { message: 'nope' } });

beforeEach(() => {
  mockedApiClient.mockReset();
});

describe('brandRadar slice — list lifecycle', () => {
  it('replaces the page on a cursor-less load and appends on a keyset load', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce({
      items: [scanFixture({ id: 'a' })],
      nextCursor: 'cur1',
    } as never);
    await store.dispatch(loadBrandRadarScans({ siteId: SITE }));
    expect(selectBrandRadarItems(store.getState() as RootState)).toHaveLength(1);
    expect(selectBrandRadarNextCursor(store.getState() as RootState)).toBe('cur1');
    expect(selectBrandRadarListStatus(store.getState() as RootState)).toBe('succeeded');

    mockedApiClient.mockResolvedValueOnce({
      items: [scanFixture({ id: 'b' })],
      nextCursor: null,
    } as never);
    await store.dispatch(loadBrandRadarScans({ siteId: SITE, cursor: 'cur1' }));
    expect(selectBrandRadarItems(store.getState() as RootState).map((i) => i.id)).toEqual([
      'a',
      'b',
    ]);
    expect(selectBrandRadarNextCursor(store.getState() as RootState)).toBeNull();
    expect(selectBrandRadarLoadingMore(store.getState() as RootState)).toBe(false);
  });

  it('marks loadingMore while a keyset page is in flight', () => {
    const state = brandRadarReducer(initialBrandRadarState, {
      type: loadBrandRadarScans.pending.type,
      meta: { arg: { cursor: 'cur1' } },
    });
    expect(state.loadingMore).toBe(true);
    expect(state.listStatus).toBe('loading');
  });

  it('records a localized list failure', async () => {
    const store = makeStore();
    mockedApiClient.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'Server said no' } }),
    );
    await store.dispatch(loadBrandRadarScans({ siteId: SITE }));
    expect(selectBrandRadarListStatus(store.getState() as RootState)).toBe('failed');
    expect(selectBrandRadarListError(store.getState() as RootState)).toBe('Server said no');
  });

  it('ignores an aborted list rejection', () => {
    const state = brandRadarReducer(
      { ...initialBrandRadarState, listStatus: 'loading' },
      {
        type: loadBrandRadarScans.rejected.type,
        payload: undefined,
        meta: { aborted: true, arg: undefined },
      },
    );
    expect(state.listStatus).toBe('loading');
    expect(state.listError).toBe('');
  });

  it('falls back to an empty string when the rejection carries no payload', () => {
    const state = brandRadarReducer(initialBrandRadarState, {
      type: loadBrandRadarScans.rejected.type,
      payload: undefined,
      meta: { aborted: false, arg: undefined },
    });
    expect(state.listError).toBe('');
  });
});

describe('brandRadar slice — preview lifecycle', () => {
  it('stores a fulfilled preview', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce(previewFixture() as never);
    await store.dispatch(previewBrandRadarScanThunk({ siteId: SITE, input: { brandQuery: 'RankMeFast' } }));
    expect(selectBrandRadarPreviewStatus(store.getState() as RootState)).toBe('succeeded');
    expect(selectBrandRadarPreview(store.getState() as RootState)).toMatchObject({
      operation: 'brand-scan',
    });
  });

  it('flags the kill switch on a 503 refusal', async () => {
    const store = makeStore();
    mockedApiClient.mockRejectedValueOnce(unavailableError());
    await store.dispatch(previewBrandRadarScanThunk({ siteId: SITE, input: { brandQuery: 'RankMeFast' } }));
    expect(store.getState().brandRadar.previewUnavailable).toBe(true);
    expect(selectBrandRadarPreviewError(store.getState() as RootState)).toBe('nope');
    expect(selectBrandRadarUnavailable(store.getState() as RootState)).toBe(true);
  });

  it('does not flag the kill switch for other refusals', async () => {
    const store = makeStore();
    mockedApiClient.mockRejectedValueOnce(
      new ApiError('bad', 400, { error: { message: 'Invalid query.' } }),
    );
    await store.dispatch(previewBrandRadarScanThunk({ siteId: SITE, input: { brandQuery: 'RankMeFast' } }));
    expect(selectBrandRadarPreviewError(store.getState() as RootState)).toBe('Invalid query.');
    expect(selectBrandRadarUnavailable(store.getState() as RootState)).toBe(false);
  });

  it('defaults the rejected preview payload when the thunk throws bare', () => {
    const state = brandRadarReducer(initialBrandRadarState, {
      type: previewBrandRadarScanThunk.rejected.type,
      payload: undefined,
      meta: { arg: { brandQuery: 'x' } },
    });
    expect(state.previewError).toBe('');
    expect(state.previewUnavailable).toBe(false);
  });

  it('clears the preview and the kill-switch flags on demand', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce(previewFixture() as never);
    await store.dispatch(previewBrandRadarScanThunk({ siteId: SITE, input: { brandQuery: 'RankMeFast' } }));
    store.dispatch(clearBrandRadarPreview());
    expect(selectBrandRadarPreview(store.getState() as RootState)).toBeNull();
    expect(selectBrandRadarPreviewStatus(store.getState() as RootState)).toBe('idle');
    expect(selectBrandRadarCreateStatus(store.getState() as RootState)).toBe('idle');
  });
});

describe('brandRadar slice — create lifecycle', () => {
  it('prepends an optimistic row built from the 202 payload', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce({
      scanId: 'new-scan',
      status: 'queued',
      queryHash: 'b'.repeat(64),
      priorScanId: null,
      outputLocale: 'de',
      reservedUnits: 1,
    } as never);
    await store.dispatch(
      createBrandRadarScanThunk({
        siteId: SITE,
        input: { brandQuery: 'RankMeFast', language: 'fr', locationCode: 2840 },
      }),
    );
    const optimistic = selectBrandRadarOptimistic(store.getState() as RootState);
    expect(optimistic).toMatchObject({
      id: 'new-scan',
      brandQuery: 'RankMeFast',
      language: 'fr',
      outputLocale: 'de',
      locationCode: 2840,
      status: 'queued',
      digestState: 'pending',
    });
    const rows = selectBrandRadarRows(store.getState() as RootState);
    expect(rows[0]).toMatchObject({
      id: 'new-scan',
      retainedRowCount: null,
      createdAt: null,
      refundState: 'none',
    });
    expect(selectBrandRadarHasPending(store.getState() as RootState)).toBe(true);
  });

  it('nulls the optional inputs the caller left blank', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce({
      scanId: 'plain',
      status: 'queued',
      queryHash: 'c'.repeat(64),
      priorScanId: 'prior',
      outputLocale: 'en',
      reservedUnits: 1,
    } as never);
    await store.dispatch(createBrandRadarScanThunk({ siteId: SITE, input: { brandQuery: 'RankMeFast' } }));
    expect(selectBrandRadarOptimistic(store.getState() as RootState)).toMatchObject({
      language: null,
      locationCode: null,
      priorScanId: 'prior',
    });
  });

  it('drops the optimistic row once the server row arrives', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce({
      scanId: 'dup',
      status: 'queued',
      queryHash: 'd'.repeat(64),
      priorScanId: null,
      outputLocale: 'en',
      reservedUnits: 1,
    } as never);
    await store.dispatch(createBrandRadarScanThunk({ siteId: SITE, input: { brandQuery: 'RankMeFast' } }));
    mockedApiClient.mockResolvedValueOnce({
      items: [scanFixture({ id: 'dup', status: 'queued' })],
      nextCursor: null,
    } as never);
    await store.dispatch(loadBrandRadarScans({ siteId: SITE }));
    expect(selectBrandRadarOptimistic(store.getState() as RootState)).toBeNull();
    expect(selectBrandRadarRows(store.getState() as RootState)).toHaveLength(1);
  });

  it('keeps the optimistic row while the server page does not contain it', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce({
      scanId: 'pending-row',
      status: 'queued',
      queryHash: 'e'.repeat(64),
      priorScanId: null,
      outputLocale: 'en',
      reservedUnits: 1,
    } as never);
    await store.dispatch(createBrandRadarScanThunk({ siteId: SITE, input: { brandQuery: 'RankMeFast' } }));
    mockedApiClient.mockResolvedValueOnce({
      items: [scanFixture({ id: 'other' })],
      nextCursor: null,
    } as never);
    await store.dispatch(loadBrandRadarScans({ siteId: SITE }));
    expect(selectBrandRadarOptimistic(store.getState() as RootState)?.id).toBe('pending-row');
    expect(selectBrandRadarRows(store.getState() as RootState)).toHaveLength(2);
  });

  it('records the create kill switch and message on refusal', async () => {
    const store = makeStore();
    mockedApiClient.mockRejectedValueOnce(unavailableError());
    await store.dispatch(createBrandRadarScanThunk({ siteId: SITE, input: { brandQuery: 'RankMeFast' } }));
    expect(selectBrandRadarCreateStatus(store.getState() as RootState)).toBe('failed');
    expect(store.getState().brandRadar.createUnavailable).toBe(true);
    expect(selectBrandRadarCreateError(store.getState() as RootState)).toBe('nope');
    expect(selectBrandRadarUnavailable(store.getState() as RootState)).toBe(true);
  });

  it('defaults the rejected create payload when the thunk throws bare', () => {
    const state = brandRadarReducer(initialBrandRadarState, {
      type: createBrandRadarScanThunk.rejected.type,
      payload: undefined,
      meta: { arg: { brandQuery: 'x' } },
    });
    expect(state.createError).toBe('');
    expect(state.createUnavailable).toBe(false);
  });

  it('resets the whole slice', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce({
      items: [scanFixture()],
      nextCursor: null,
    } as never);
    await store.dispatch(loadBrandRadarScans({ siteId: SITE }));
    store.dispatch(resetBrandRadar());
    expect(store.getState().brandRadar).toEqual(initialBrandRadarState);
  });
});

describe('brandRadar selectors — lazy-slice safety', () => {
  const emptyState = {} as RootState;

  it('returns initial-state defaults before the reducer is injected', () => {
    expect(selectBrandRadarItems(emptyState)).toEqual([]);
    expect(selectBrandRadarNextCursor(emptyState)).toBeNull();
    expect(selectBrandRadarListStatus(emptyState)).toBe('idle');
    expect(selectBrandRadarListError(emptyState)).toBe('');
    expect(selectBrandRadarLoadingMore(emptyState)).toBe(false);
    expect(selectBrandRadarOptimistic(emptyState)).toBeNull();
    expect(selectBrandRadarPreview(emptyState)).toBeNull();
    expect(selectBrandRadarPreviewStatus(emptyState)).toBe('idle');
    expect(selectBrandRadarPreviewError(emptyState)).toBe('');
    expect(selectBrandRadarCreateStatus(emptyState)).toBe('idle');
    expect(selectBrandRadarCreateError(emptyState)).toBe('');
    expect(selectBrandRadarUnavailable(emptyState)).toBe(false);
    expect(selectBrandRadarRows(emptyState)).toEqual([]);
    expect(selectBrandRadarHasPending(emptyState)).toBe(false);
  });
});
