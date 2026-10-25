import { describe, expect, it } from 'vitest';
import { MAX_PAGED_REQUESTS, collectPaged } from './onpage-paging.js';

describe('on-page pagination', () => {
  it('keeps walking short pages until the vendor reports exhaustion', async () => {
    const offsets: number[] = [];
    const pages = [['a', 'b'], ['c'], []];
    const result = await collectPaged({ keyOf: (item: string) => item,
      fetchPage: async (offset) => { offsets.push(offset); return { items: pages[offsets.length - 1]!, total: null }; } });
    expect(result).toEqual({ items: ['a', 'b', 'c'], complete: true });
    expect(offsets).toEqual([0, 2, 3]);
  });

  it('stops a repeating vendor page without inventing completion', async () => {
    const result = await collectPaged({ keyOf: (item: string) => item,
      fetchPage: async () => ({ items: ['same'], total: 20 }) });
    expect(result).toEqual({ items: ['same'], complete: false });
  });

  it('enforces a row bound and the fixed request ceiling', async () => {
    const result = await collectPaged({ keyOf: (item: string) => item, maxItems: 2,
      fetchPage: async () => ({ items: ['a', 'b', 'c'], total: 3 }) });
    expect(result).toEqual({ items: ['a', 'b'], complete: false });
    expect(MAX_PAGED_REQUESTS).toBe(600);
  });
});
