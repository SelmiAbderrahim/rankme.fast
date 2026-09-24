/**
 * Live Keyword Trends store coverage (slice reducers + thunks).
 *
 * The view-level suite (`liveTrends.test.tsx`) drives the rendered surface;
 * this file pins the Redux layer directly:
 *   1. `clearLiveTrendsPreview` / `resetLiveTrends` reducers.
 *   2. Every pending/fulfilled/rejected case of the four live-trends thunks,
 *      including the `rejectWithValue`-less rejection (payload `undefined`)
 *      so the defensive `?? ''` fallbacks are exercised rather than ignored.
 *   3. `toLiveTrendsReject` error discrimination: kill-switch /
 *      provider-failed / not-found / unknown / transport-level (no status).
 *   4. The optimistic history prepend and the cursor-page merge/dedupe.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '@shared/api/client';

const api = vi.hoisted(() => ({
  previewLiveTrendsRequest: vi.fn(),
  exploreLiveTrendsRequest: vi.fn(),
  fetchLiveTrendsListRequest: vi.fn(),
  fetchLiveTrendsRunRequest: vi.fn(),
}));

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, ...api };
});

import {
  clearLiveTrendsPreview,
  initialState,
  keywordResearchReducer,
  resetLiveTrends,
} from './store/slice';
import {
  exploreLiveTrends,
  loadLiveTrendsList,
  loadLiveTrendsRun,
  previewLiveTrends,
} from './store/thunks';
import {
  selectLiveTrends,
  selectLiveTrendsList,
  selectLiveTrendsPreview,
  selectLiveTrendsRun,
  selectLiveTrendsStoredRun,
} from './store/selectors';
import type {
  KeywordResearchState,
  TrendsExplorationDto,
  TrendsListResponse,
  TrendsSpendPreview,
  TrendsStoredRunSummary,
} from './types';

const COVERAGE_NOTE_KEY =
  'keywordResearch.trends.coverageNote.searchInterestIndex';

const envelope = () => ({
  source: 'estimate' as const,
  observationMeta: { searchInterestIndexKey: COVERAGE_NOTE_KEY },
});

function preview(): TrendsSpendPreview {
  return { operation: 'trends-explore' };
}

function exploration(
  overrides: Partial<TrendsExplorationDto> = {},
): TrendsExplorationDto {
  return {
    runId: 'a'.repeat(24),
    status: 'succeeded',
    retained: true,
    refunded: false,
    errorCode: null,
    inputs: { keywords: ['solar'], geo: 'us', language: 'en' },
    cached: false,
    fetchedAt: '2026-07-19T00:00:00.000Z',
    window: { startDate: '2022-01-01', endDate: '2024-01-01' },
    observedAt: '2026-07-19T00:00:00.000Z',
    locationCode: 2840,
    languageCode: 'en',
    series: [
      {
        keyword: 'solar',
        points: [{ year: 2023, month: 1, value: 10 }],
        ...envelope(),
      },
    ],
    seriesReadouts: [
      {
        keyword: 'solar',
        readouts: {
          yoy: { deltaFraction: 0.1, ...envelope() },
          momentum: { direction: 'up', slopePerWeek: 0.5, ...envelope() },
          seasonality: { months: [6], ...envelope() },
        },
      },
    ],
    relatedQueries: [{ query: 'solar roof', value: 90, kind: 'rising' }],
    createdAt: '2026-07-19T00:00:00.000Z',
    completedAt: '2026-07-19T00:00:01.000Z',
    ...overrides,
  };
}

function storedRun(
  overrides: Partial<TrendsStoredRunSummary> = {},
): TrendsStoredRunSummary {
  return {
    runId: 'b'.repeat(24),
    status: 'succeeded',
    retained: true,
    refunded: false,
    errorCode: null,
    inputs: { keywords: ['solar'], geo: 'us', language: 'en' },
    siteId: null,
    seriesCount: 1,
    relatedQueryCount: 1,
    createdAt: '2026-07-18T00:00:00.000Z',
    completedAt: '2026-07-18T00:00:01.000Z',
    ...envelope(),
    ...overrides,
  };
}

function listOf(...runs: TrendsStoredRunSummary[]): TrendsListResponse {
  return { runs, nextCursor: null };
}

type ThunkAction = (
  dispatch: unknown,
  getState: unknown,
  extra: unknown,
) => Promise<unknown>;

/** Run a thunk against stub dispatch/getState and return the settled action. */
async function runThunk(thunk: unknown) {
  const dispatched: { type: string; payload?: unknown }[] = [];
  const dispatch = (action: unknown) => {
    dispatched.push(action as { type: string });
    return action;
  };
  await (thunk as ThunkAction)(dispatch, () => ({}), undefined);
  return dispatched[dispatched.length - 1]!;
}

const EXPLORE_ARGS = { keywords: ['solar'], geo: 'us', language: 'en' };

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});

describe('live-trends reducers', () => {
  it('clearLiveTrendsPreview drops the preview without touching the run', () => {
    const seeded: KeywordResearchState = {
      ...initialState,
      liveTrends: {
        ...initialState.liveTrends,
        preview: { loading: true, data: preview(), error: 'x', errorKind: 'unknown' },
        run: { loading: false, data: exploration(), error: '', errorKind: null },
      },
    };
    const next = keywordResearchReducer(seeded, clearLiveTrendsPreview());
    expect(next.liveTrends.preview).toEqual({
      loading: false,
      data: null,
      error: '',
      errorKind: null,
    });
    expect(next.liveTrends.run.data).not.toBeNull();
  });

  it('resetLiveTrends clears preview/run/storedRun but keeps stored history', () => {
    const list = listOf(storedRun());
    const seeded: KeywordResearchState = {
      ...initialState,
      liveTrends: {
        preview: { loading: false, data: preview(), error: '', errorKind: null },
        run: { loading: false, data: exploration(), error: 'boom', errorKind: 'unknown' },
        list: { loading: false, data: list, error: '', errorKind: null },
        storedRun: { loading: false, data: storedRun(), error: '', errorKind: null },
      },
    };
    const next = keywordResearchReducer(seeded, resetLiveTrends());
    expect(next.liveTrends.preview.data).toBeNull();
    expect(next.liveTrends.run.data).toBeNull();
    expect(next.liveTrends.run.error).toBe('');
    expect(next.liveTrends.storedRun.data).toBeNull();
    expect(next.liveTrends.list.data).toBe(list);
  });
});

describe('previewLiveTrends', () => {
  it('pending clears the previous error, fulfilled stores the server preview', async () => {
    const pending = keywordResearchReducer(
      {
        ...initialState,
        liveTrends: {
          ...initialState.liveTrends,
          preview: { loading: false, data: null, error: 'old', errorKind: 'unknown' },
        },
      },
      previewLiveTrends.pending('rid', EXPLORE_ARGS),
    );
    expect(pending.liveTrends.preview).toMatchObject({
      loading: true,
      error: '',
      errorKind: null,
    });

    api.previewLiveTrendsRequest.mockResolvedValue(preview());
    const action = await runThunk(previewLiveTrends(EXPLORE_ARGS));
    expect(action.type).toBe(previewLiveTrends.fulfilled.type);
    const next = keywordResearchReducer(pending, action as never);
    expect(next.liveTrends.preview.loading).toBe(false);
    expect(selectLiveTrendsPreview({ keywordResearch: next } as never).data)
      .toMatchObject({ operation: 'trends-explore' });
  });

  it('a rejection carrying no payload falls back to empty error + null kind', () => {
    const next = keywordResearchReducer(
      initialState,
      previewLiveTrends.rejected(new Error('transport'), 'rid', EXPLORE_ARGS),
    );
    expect(next.liveTrends.preview).toMatchObject({
      loading: false,
      data: null,
      error: '',
      errorKind: null,
    });
  });
});

describe('exploreLiveTrends', () => {
  it('pending → fulfilled consumes the preview and prepends into stored history', async () => {
    api.exploreLiveTrendsRequest.mockResolvedValue(exploration());
    const seeded: KeywordResearchState = {
      ...initialState,
      liveTrends: {
        ...initialState.liveTrends,
        preview: { loading: false, data: preview(), error: '', errorKind: null },
        list: {
          loading: false,
          // Same runId already present → replaced, not duplicated.
          data: listOf(storedRun({ runId: 'a'.repeat(24) }), storedRun()),
          error: '',
          errorKind: null,
        },
      },
    };
    const pending = keywordResearchReducer(
      seeded,
      exploreLiveTrends.pending('rid', EXPLORE_ARGS),
    );
    expect(pending.liveTrends.run.loading).toBe(true);

    const action = await runThunk(exploreLiveTrends(EXPLORE_ARGS) as never);
    const next = keywordResearchReducer(pending, action as never);
    expect(next.liveTrends.preview.data).toBeNull();
    const runs = next.liveTrends.list.data!.runs;
    expect(runs).toHaveLength(2);
    expect(runs[0]!.runId).toBe('a'.repeat(24));
    expect(runs[0]!.source).toBe('estimate');
    expect(runs[0]!.observationMeta.searchInterestIndexKey).toBe(
      COVERAGE_NOTE_KEY,
    );
    expect(selectLiveTrendsRun({ keywordResearch: next } as never).data)
      .toMatchObject({ status: 'succeeded' });
  });

  it('fulfilled with no loaded history leaves the list untouched', async () => {
    api.exploreLiveTrendsRequest.mockResolvedValue(exploration());
    const action = await runThunk(exploreLiveTrends(EXPLORE_ARGS) as never);
    const next = keywordResearchReducer(initialState, action as never);
    expect(next.liveTrends.list.data).toBeNull();
  });

  it('a rejected preview records the error and classifies other statuses as unknown', async () => {
    api.previewLiveTrendsRequest.mockRejectedValue(
      new ApiError('bad', 400, { error: { message: 'Pick at least one keyword.' } }),
    );
    const action = await runThunk(previewLiveTrends(EXPLORE_ARGS));
    expect(action.payload).toMatchObject({ kind: 'unknown', status: 400 });
    const next = keywordResearchReducer(initialState, action as never);
    expect(next.liveTrends.preview).toMatchObject({
      loading: false,
      data: null,
      error: 'Pick at least one keyword.',
      errorKind: 'unknown',
    });
  });

  it('503 provider reason rejects as `providerFailed` regardless of localized message', async () => {
    api.exploreLiveTrendsRequest.mockRejectedValue(
      new ApiError('down', 503, {
        error: {
          message: 'لم يستجب مزوّد الاتجاهات',
          details: { reason: 'provider_failed' },
        },
      }),
    );
    const action = await runThunk(exploreLiveTrends(EXPLORE_ARGS) as never);
    expect(action.payload).toMatchObject({ kind: 'providerFailed', status: 503 });
    const next = keywordResearchReducer(initialState, action as never);
    expect(next.liveTrends.run.errorKind).toBe('providerFailed');
  });

  it('503 disabled reason rejects as `unavailable` regardless of localized message', async () => {
    api.exploreLiveTrendsRequest.mockRejectedValue(
      new ApiError('off', 503, {
        error: {
          message: 'الاستكشاف المباشر متوقف مؤقتًا',
          details: { reason: 'disabled' },
        },
      }),
    );
    const action = await runThunk(exploreLiveTrends(EXPLORE_ARGS) as never);
    expect(action.payload).toMatchObject({ kind: 'unavailable' });
  });

  it('a 503 without a stable reason is a generic failure, never a fake kill switch', async () => {
    api.exploreLiveTrendsRequest.mockRejectedValue(new ApiError('off', 503, undefined));
    const action = await runThunk(exploreLiveTrends(EXPLORE_ARGS) as never);
    expect(action.payload).toMatchObject({ kind: 'unknown' });
  });

  it('a non-ApiError throw keeps `kind` null (no status to discriminate on)', async () => {
    api.exploreLiveTrendsRequest.mockRejectedValue(new TypeError('network'));
    const action = await runThunk(exploreLiveTrends(EXPLORE_ARGS) as never);
    expect(action.payload).toMatchObject({ kind: null, status: null });
  });

  it('a payload-less explore rejection falls back to empty error + null kind', () => {
    const next = keywordResearchReducer(
      initialState,
      exploreLiveTrends.rejected(new Error('transport'), 'rid', EXPLORE_ARGS),
    );
    expect(next.liveTrends.run).toMatchObject({ error: '', errorKind: null });
  });
});

describe('loadLiveTrendsList', () => {
  it('a cursor-less load replaces the first page', async () => {
    api.fetchLiveTrendsListRequest.mockResolvedValue(listOf(storedRun()));
    const pending = keywordResearchReducer(
      initialState,
      loadLiveTrendsList.pending('rid', { limit: 20 }),
    );
    expect(pending.liveTrends.list.loading).toBe(true);
    const action = await runThunk(loadLiveTrendsList({ limit: 20 }) as never);
    const next = keywordResearchReducer(pending, action as never);
    expect(next.liveTrends.list.data!.runs).toHaveLength(1);
    expect(selectLiveTrendsList({ keywordResearch: next } as never).loading).toBe(
      false,
    );
  });

  it('a cursor page appends and dedupes against the already-loaded rows', async () => {
    api.fetchLiveTrendsListRequest.mockResolvedValue(
      listOf(storedRun({ runId: 'b'.repeat(24) }), storedRun({ runId: 'c'.repeat(24) })),
    );
    const seeded: KeywordResearchState = {
      ...initialState,
      liveTrends: {
        ...initialState.liveTrends,
        list: {
          loading: false,
          data: { runs: [storedRun({ runId: 'b'.repeat(24) })], nextCursor: 'cur' },
          error: '',
          errorKind: null,
        },
      },
    };
    const action = await runThunk(
      loadLiveTrendsList({ limit: 20, cursor: 'cur' }) as never,
    );
    const next = keywordResearchReducer(seeded, action as never);
    expect(next.liveTrends.list.data!.runs.map((r) => r.runId)).toEqual([
      'b'.repeat(24),
      'c'.repeat(24),
    ]);
  });

  it('a cursor page with nothing loaded yet still replaces the page', async () => {
    api.fetchLiveTrendsListRequest.mockResolvedValue(listOf(storedRun()));
    const action = await runThunk(
      loadLiveTrendsList({ limit: 20, cursor: 'cur' }) as never,
    );
    const next = keywordResearchReducer(initialState, action as never);
    expect(next.liveTrends.list.data!.runs).toHaveLength(1);
  });

  it('a 500 rejects as `unknown` and stops the loading affordance', async () => {
    api.fetchLiveTrendsListRequest.mockRejectedValue(new ApiError('boom', 500, {}));
    const action = await runThunk(loadLiveTrendsList({ limit: 20 }) as never);
    expect(action.payload).toMatchObject({ kind: 'unknown', status: 500 });
    const next = keywordResearchReducer(
      keywordResearchReducer(initialState, loadLiveTrendsList.pending('rid', { limit: 20 })),
      action as never,
    );
    expect(next.liveTrends.list.errorKind).toBe('unknown');
    expect(next.liveTrends.list.loading).toBe(false);
  });

  it('a payload-less list rejection falls back to empty error + null kind', () => {
    const next = keywordResearchReducer(
      initialState,
      loadLiveTrendsList.rejected(new Error('transport'), 'rid', { limit: 20 }),
    );
    expect(next.liveTrends.list).toMatchObject({ error: '', errorKind: null });
  });
});

describe('loadLiveTrendsRun', () => {
  it('pending → fulfilled stores the reopened run', async () => {
    api.fetchLiveTrendsRunRequest.mockResolvedValue(storedRun());
    const pending = keywordResearchReducer(
      initialState,
      loadLiveTrendsRun.pending('rid', { runId: 'b'.repeat(24) }),
    );
    expect(pending.liveTrends.storedRun.loading).toBe(true);
    const action = await runThunk(
      loadLiveTrendsRun({ runId: 'b'.repeat(24) }) as never,
    );
    const next = keywordResearchReducer(pending, action as never);
    expect(
      selectLiveTrendsStoredRun({ keywordResearch: next } as never).data!.runId,
    ).toBe('b'.repeat(24));
    expect(selectLiveTrends({ keywordResearch: next } as never).storedRun.loading)
      .toBe(false);
  });

  it('a 404 rejects as `notFound` and clears any previously read run', async () => {
    api.fetchLiveTrendsRunRequest.mockRejectedValue(new ApiError('gone', 404, {}));
    const seeded: KeywordResearchState = {
      ...initialState,
      liveTrends: {
        ...initialState.liveTrends,
        storedRun: { loading: true, data: storedRun(), error: '', errorKind: null },
      },
    };
    const action = await runThunk(
      loadLiveTrendsRun({ runId: 'b'.repeat(24) }) as never,
    );
    expect(action.payload).toMatchObject({ kind: 'notFound', status: 404 });
    const next = keywordResearchReducer(seeded, action as never);
    expect(next.liveTrends.storedRun.data).toBeNull();
    expect(next.liveTrends.storedRun.errorKind).toBe('notFound');
  });

  it('a payload-less stored-run rejection falls back to empty error + null kind', () => {
    const next = keywordResearchReducer(
      initialState,
      loadLiveTrendsRun.rejected(new Error('transport'), 'rid', {
        runId: 'b'.repeat(24),
      }),
    );
    expect(next.liveTrends.storedRun).toMatchObject({ error: '', errorKind: null });
  });
});
