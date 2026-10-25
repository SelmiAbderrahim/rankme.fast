import { describe, expect, it } from 'vitest';
import { keywordPageCount, pageWindow, readKeywordListQuery, writeKeywordListQuery } from './keywordListParams';

describe('keyword list URL state', () => {
  it('reads valid filters and discards malformed paging without dropping search text', () => {
    expect(readKeywordListQuery(new URLSearchParams('tab=keywords&page=2&pageSize=50&engine=bing&search=+trail+')))
      .toEqual({ page: 2, pageSize: 50, engine: 'bing', search: 'trail' });
    expect(readKeywordListQuery(new URLSearchParams('page=-1&pageSize=999&engine=unknown&search=shoes')))
      .toEqual({ page: 1, pageSize: 25, engine: null, search: 'shoes' });
  });

  it('preserves unrelated tab state and omits defaults from the URL', () => {
    const params = new URLSearchParams('tab=keywords&open=tool&page=3');
    const next = writeKeywordListQuery(params, { page: 1, pageSize: 25, engine: null, search: '' });
    expect(next.toString()).toBe('tab=keywords&open=tool');
    expect(writeKeywordListQuery(next, { page: 4, pageSize: 100, engine: 'youtube', search: 'new shoes' }).toString())
      .toContain('page=4&pageSize=100&engine=youtube&search=new+shoes');
  });

  it('shows every page in a short gap and an ellipsis for a longer gap', () => {
    expect(keywordPageCount(0, 25)).toBe(1);
    expect(keywordPageCount(51, 25)).toBe(3);
    expect(pageWindow(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
