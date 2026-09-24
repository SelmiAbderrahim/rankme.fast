import { describe, expect, it } from 'vitest';
import { keywordResearchReducer } from './store/slice';
import { fetchLongTail } from './store/thunks';
import { buildSearchAgainUrl, parsePrefillParams } from './validation';

const args = { seed: 'seo, audit', locationCode: 2840, languageCode: 'en' };

describe('long-tail keyword client state', () => {
  it('preserves an exact seed prefill ahead of legacy q', () => {
    const result = parsePrefillParams(
      new URLSearchParams('seed=seo%2C+audit&q=ignored,phrases&location=2840&lang=en'),
    );
    expect(result.chips).toEqual(['seo, audit']);
    const url = buildSearchAgainUrl({
      id: 'history-1',
      kind: 'long_tail',
      phrases: ['seo, audit'],
      locationCode: 2840,
      languageCode: 'en',
      resultCount: 2,
      cached: true,
      createdAt: '2026-08-12T00:00:00.000Z',
    });
    expect(new URLSearchParams(url.split('?')[1]).get('seed')).toBe('seo, audit');
  });

  it('clears prior rows when a new seed starts and replaces them on success', () => {
    let state = keywordResearchReducer(
      undefined,
      fetchLongTail.fulfilled(
        {
          seed: 'old',
          suggestions: [{
            keyword: 'old result',
            searchVolume: 10,
            difficulty: 20,
            cpc: null,
            monthlySearches: [],
          }],
          cached: false,
        },
        'first',
        { ...args, seed: 'old' },
      ),
    );
    state = keywordResearchReducer(state, fetchLongTail.pending('second', args));
    expect(state.longTail).toMatchObject({ seed: 'seo, audit', loading: true, suggestions: [] });

    state = keywordResearchReducer(
      state,
      fetchLongTail.fulfilled(
        { seed: args.seed, suggestions: [], cached: true },
        'second',
        args,
      ),
    );
    expect(state.longTail).toMatchObject({
      seed: 'seo, audit',
      loading: false,
      suggestions: [],
      cached: true,
      locationCode: 2840,
      languageCode: 'en',
    });
  });
});
