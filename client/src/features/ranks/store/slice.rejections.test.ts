import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ranksReducer } from './slice';
import { addKeywordsBulk, loadKeywords } from './thunks';

vi.mock('../api', () => ({
  fetchKeywordsRequest: vi.fn(),
  createKeywordsBulkRequest: vi.fn(),
}));
const mocked = vi.mocked(api);
const makeStore = () => configureStore({ reducer: { ranks: ranksReducer } });

beforeEach(() => vi.resetAllMocks());

it('keeps the list state when a load is canceled, and shows an empty message for a bare rejection', async () => {
  mocked.fetchKeywordsRequest.mockReturnValue(new Promise(() => undefined));
  const store = makeStore();
  const canceled = store.dispatch(loadKeywords({ siteId: 's1' }));
  expect(store.getState().ranks.loading).toBe(true);
  canceled.abort();
  await canceled;
  expect(store.getState().ranks.loaded).toBe(false);
  expect(store.getState().ranks.error).toBe('');

  store.dispatch(loadKeywords.pending('request-2', { siteId: 's1' }));
  store.dispatch(loadKeywords.rejected(new Error('stopped'), 'request-2', { siteId: 's1' }));
  expect(store.getState().ranks.loaded).toBe(true);
  expect(store.getState().ranks.error).toBe('');
});

it('shows an empty add error for a bulk add that fails without a reason', () => {
  const store = makeStore();
  store.dispatch(addKeywordsBulk.rejected(new Error('stopped'), 'request-3',
    { siteId: 's1', keywords: [], locationCode: 1, languageCode: 'en', device: 'desktop' } as never));
  expect(store.getState().ranks.adding).toBe(false);
  expect(store.getState().ranks.addError).toBe('');
});
