import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ranksReducer } from './slice';
import { addKeyword, checkNow, loadKeywords, removeKeyword, updateCadence } from './thunks';
import type { KeywordListPage } from '../types';

vi.mock('../api', () => ({
  fetchKeywordsRequest: vi.fn(),
  createKeywordRequest: vi.fn(),
  removeKeywordRequest: vi.fn(),
  updateCadenceRequest: vi.fn(),
  checkNowRequest: vi.fn(),
  fetchKeywordHistoryRequest: vi.fn(),
  fetchSerpFeaturesRequest: vi.fn(),
  fetchSerpFeatureDetailRequest: vi.fn(),
}));
const mocked = vi.mocked(api);

const page = (): KeywordListPage => ({ keywords: [], nextCursor: null, cadence: 'daily' }) as never;
const makeStore = () => configureStore({ reducer: { ranks: ranksReducer } });

beforeEach(() => vi.resetAllMocks());

describe('loadKeywords — duplicate request guard', () => {
  it('shares one GET between identical concurrent loads', async () => {
    let resolve!: (value: KeywordListPage) => void;
    mocked.fetchKeywordsRequest.mockReturnValueOnce(new Promise((res) => { resolve = res; }));
    const store = makeStore();
    const loads = [
      store.dispatch(loadKeywords({ siteId: 's1' })),
      store.dispatch(loadKeywords({ siteId: 's1', direction: 'initial' })),
      store.dispatch(loadKeywords({ siteId: 's1' })),
    ];
    resolve(page());
    await Promise.all(loads);
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(1);
    expect(store.getState().ranks.loaded).toBe(true);
  });

  it('keeps site, cursor, and engine variants separate', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(page());
    const store = makeStore();
    await Promise.all([
      store.dispatch(loadKeywords({ siteId: 's1' })),
      store.dispatch(loadKeywords({ siteId: 's2' })),
      store.dispatch(loadKeywords({ siteId: 's2', cursor: 'c', direction: 'next' })),
      store.dispatch(loadKeywords({ siteId: 's2', engine: 'bing' as never })),
    ]);
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(4);
  });

  it('refetches once the previous request settled', async () => {
    mocked.fetchKeywordsRequest.mockResolvedValue(page());
    const store = makeStore();
    await store.dispatch(loadKeywords({ siteId: 's1' }));
    await store.dispatch(loadKeywords({ siteId: 's1' }));
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['addKeyword', () => {
      mocked.createKeywordRequest.mockResolvedValue({ message: 'ok' } as never);
      return addKeyword({ siteId: 's1', phrase: 'x' } as never);
    }],
    ['removeKeyword', () => {
      mocked.removeKeywordRequest.mockResolvedValue({ message: 'ok' });
      return removeKeyword('k1');
    }],
    ['updateCadence', () => {
      mocked.updateCadenceRequest.mockResolvedValue({ cadence: 'weekly' } as never);
      return updateCadence({ siteId: 's1', cadence: 'weekly', previous: 'daily' });
    }],
    ['checkNow', () => {
      mocked.checkNowRequest.mockResolvedValue({} as never);
      return checkNow({ siteId: 's1' });
    }],
  ])('does not hand a pre-%s read to a post-mutation reload', async (_name, mutation) => {
    let resolveStale!: (value: KeywordListPage) => void;
    mocked.fetchKeywordsRequest.mockReturnValueOnce(new Promise((res) => { resolveStale = res; }));
    const store = makeStore();
    const stale = store.dispatch(loadKeywords({ siteId: 's1' }));
    await store.dispatch(mutation() as never);
    mocked.fetchKeywordsRequest.mockResolvedValueOnce(page());
    await store.dispatch(loadKeywords({ siteId: 's1' }));
    expect(mocked.fetchKeywordsRequest).toHaveBeenCalledTimes(2);
    resolveStale(page());
    await stale;
  });
});
