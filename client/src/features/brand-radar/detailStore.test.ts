import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { RootState } from '@app/store';
import { apiClient } from '@shared/api/client';
import {
  mentionFixture,
  scanDetailFixture,
  scanFixture,
} from './__fixtures__/scans';
import { brandRadarReducer } from './store/slice';
import {
  loadBrandRadarMentions,
  loadBrandRadarScanDetail,
} from './store/thunks';
import {
  buildBrandRadarTrendPoints,
  selectBrandRadarDetailEntry,
  selectBrandRadarMentionEntry,
} from './store/selectors';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);
const makeStore = () => configureStore({ reducer: { brandRadar: brandRadarReducer } });
const SCAN_ID = '65f000000000000000000001';

beforeEach(() => {
  mockedApiClient.mockReset();
});

describe('brandRadar slice — detail and mention entries', () => {
  it('keys entries by scan id so a second scan never overwrites the first', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce(scanDetailFixture({ id: 'scan-a' }) as never);
    await store.dispatch(loadBrandRadarScanDetail({ scanId: 'scan-a' }));
    mockedApiClient.mockResolvedValueOnce(scanDetailFixture({ id: 'scan-b' }) as never);
    await store.dispatch(loadBrandRadarScanDetail({ scanId: 'scan-b' }));

    const state = store.getState() as unknown as RootState;
    expect(selectBrandRadarDetailEntry(state, 'scan-a').detail?.id).toBe('scan-a');
    expect(selectBrandRadarDetailEntry(state, 'scan-b').detail?.id).toBe('scan-b');
    // An untouched id reads the shared initial entry rather than crashing.
    expect(selectBrandRadarDetailEntry(state, 'scan-c').status).toBe('idle');
    expect(selectBrandRadarMentionEntry(state, 'scan-c').items).toEqual([]);
  });

  it('falls back to the initial state before the slice is injected', () => {
    const empty = {} as RootState;
    expect(selectBrandRadarDetailEntry(empty, SCAN_ID).detail).toBeNull();
    expect(selectBrandRadarMentionEntry(empty, SCAN_ID).nextCursor).toBeNull();
  });

  it('drops a detail rejection that was aborted, and keeps a real one', () => {
    const store = makeStore();
    store.dispatch({
      type: loadBrandRadarScanDetail.rejected.type,
      payload: undefined,
      error: { message: 'Aborted' },
      meta: { arg: { scanId: SCAN_ID }, aborted: true, requestId: 'r1' },
    });
    let state = store.getState() as unknown as RootState;
    expect(selectBrandRadarDetailEntry(state, SCAN_ID).status).toBe('idle');

    // A rejection with no payload still leaves the entry in a failed state.
    store.dispatch({
      type: loadBrandRadarScanDetail.rejected.type,
      payload: undefined,
      error: { message: 'boom' },
      meta: { arg: { scanId: SCAN_ID }, aborted: false, requestId: 'r2' },
    });
    state = store.getState() as unknown as RootState;
    expect(selectBrandRadarDetailEntry(state, SCAN_ID).status).toBe('failed');
    expect(selectBrandRadarDetailEntry(state, SCAN_ID).error).toBe('');
  });

  it('drops an aborted mention rejection but clears the loading-more flag', () => {
    const store = makeStore();
    store.dispatch({
      type: loadBrandRadarMentions.rejected.type,
      payload: undefined,
      error: { message: 'Aborted' },
      meta: { arg: { scanId: SCAN_ID, cursor: 'c1' }, aborted: true, requestId: 'r1' },
    });
    let state = store.getState() as unknown as RootState;
    expect(selectBrandRadarMentionEntry(state, SCAN_ID).status).toBe('idle');
    expect(selectBrandRadarMentionEntry(state, SCAN_ID).loadingMore).toBe(false);

    store.dispatch({
      type: loadBrandRadarMentions.rejected.type,
      payload: undefined,
      error: { message: 'boom' },
      meta: { arg: { scanId: SCAN_ID }, aborted: false, requestId: 'r2' },
    });
    state = store.getState() as unknown as RootState;
    expect(selectBrandRadarMentionEntry(state, SCAN_ID).status).toBe('failed');
    expect(selectBrandRadarMentionEntry(state, SCAN_ID).error).toBe('');
  });

  it('flags a keyset read as loading-more and replaces on a head read', async () => {
    const store = makeStore();
    mockedApiClient.mockResolvedValueOnce({
      items: [mentionFixture({ id: 'm1' })],
      nextCursor: 'c1',
    } as never);
    await store.dispatch(loadBrandRadarMentions({ scanId: SCAN_ID }));
    mockedApiClient.mockResolvedValueOnce({
      items: [mentionFixture({ id: 'm2' })],
      nextCursor: null,
    } as never);
    await store.dispatch(loadBrandRadarMentions({ scanId: SCAN_ID, cursor: 'c1' }));
    let state = store.getState() as unknown as RootState;
    expect(selectBrandRadarMentionEntry(state, SCAN_ID).items.map((row) => row.id)).toEqual([
      'm1',
      'm2',
    ]);

    mockedApiClient.mockResolvedValueOnce({
      items: [mentionFixture({ id: 'm9' })],
      nextCursor: null,
    } as never);
    await store.dispatch(loadBrandRadarMentions({ scanId: SCAN_ID }));
    state = store.getState() as unknown as RootState;
    expect(selectBrandRadarMentionEntry(state, SCAN_ID).items.map((row) => row.id)).toEqual([
      'm9',
    ]);
  });
});

describe('buildBrandRadarTrendPoints', () => {
  it('returns nothing before the detail lands', () => {
    expect(buildBrandRadarTrendPoints([scanFixture()], null)).toEqual([]);
  });

  it('keeps settled same-query scans, oldest first, and falls back to createdAt', () => {
    const detail = scanDetailFixture({ id: SCAN_ID });
    const points = buildBrandRadarTrendPoints(
      [
        scanFixture({
          id: 'other-query',
          queryHash: 'b'.repeat(64),
          terminalAt: '2026-07-01T00:00:00.000Z',
        }),
        scanFixture({ id: 'still-running', status: 'running', terminalAt: null }),
        scanFixture({
          id: SCAN_ID,
          retainedRowCount: 42,
          terminalAt: '2026-07-20T10:05:00.000Z',
        }),
        // A settled scan the pipeline never stamped: capturedAt falls back.
        scanFixture({
          id: 'no-terminal',
          retainedRowCount: 30,
          createdAt: '2026-07-06T10:00:00.000Z',
          terminalAt: null,
        }),
      ],
      detail,
    );

    expect(points.map((point) => point.scanId)).toEqual(['no-terminal', SCAN_ID]);
    expect(points[0]?.capturedAt).toBe('2026-07-06T10:00:00.000Z');
    expect(points[0]?.delta).toBeNull();
    expect(points[0]?.isCurrent).toBe(false);
    expect(points[1]?.delta).toBe(6);
    expect(points[1]?.isCurrent).toBe(true);
  });

  it('never invents a delta when the server sent none', () => {
    const points = buildBrandRadarTrendPoints(
      [scanFixture({ id: SCAN_ID })],
      scanDetailFixture({ id: SCAN_ID, trend: null }),
    );
    expect(points[0]?.delta).toBeNull();
  });
});
