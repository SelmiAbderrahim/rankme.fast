/**
 * `collectPaged` row bound. The walk itself is
 * exercised end to end by `onpage-deep-signals.test.ts`; this suite pins the
 * row bound the deep crawl reads add.
 */
import { describe, expect, it } from 'vitest';
import { MAX_PAGED_REQUESTS, collectPaged } from './onpage-paging.js';

const pager = (pages: string[][], total?: number) => {
  const offsets: number[] = [];
  return {
    offsets,
    fetchPage: async (offset: number) => {
      offsets.push(offset);
      const index = offsets.length - 1;
      return { items: pages[index] ?? [], total };
    },
  };
};

describe('collectPaged', () => {
  it('walks until an empty page and advances the offset by the rows returned', async () => {
    const { offsets, fetchPage } = pager([['a', 'b'], ['c']]);
    const result = await collectPaged({ fetchPage, keyOf: (row) => row });
    expect(result).toEqual({ items: ['a', 'b', 'c'], complete: true });
    expect(offsets).toEqual([0, 2, 3]);
  });

  it('stops at maxItems and reports the cut as incomplete', async () => {
    const { offsets, fetchPage } = pager([['a', 'b'], ['c', 'd'], ['e']], 5);
    const result = await collectPaged({ fetchPage, keyOf: (row) => row, maxItems: 3 });
    expect(result).toEqual({ items: ['a', 'b', 'c'], complete: false });
    expect(offsets).toEqual([0, 2]);
  });

  it('a bound that lands exactly on the reported total is complete', async () => {
    const { fetchPage } = pager([['a', 'b']], 2);
    const result = await collectPaged({ fetchPage, keyOf: (row) => row, maxItems: 2 });
    expect(result).toEqual({ items: ['a', 'b'], complete: true });
  });

  it('a bound below a short final page is still a cut', async () => {
    const { fetchPage } = pager([['a', 'b', 'c']], 3);
    const result = await collectPaged({ fetchPage, keyOf: (row) => row, maxItems: 2 });
    expect(result).toEqual({ items: ['a', 'b'], complete: false });
  });

  it('keeps the request ceiling', () => {
    expect(MAX_PAGED_REQUESTS).toBe(600);
  });
});
