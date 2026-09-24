/**
 * Content Intelligence — competitor URL selection tests (Phase A6).
 *
 * The selector is pure (its only I/O is the injectable `assertSafe`), so
 * every rejection reason, the ceiling short-circuit, and the normalization
 * branches are exercised deterministically with an inline fake authority.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  selectCompetitorCandidates,
  type SelectCompetitorInput,
} from './content-analysis.selectors.js';

const allowAll = vi.fn(async (url: string) => url);

function run(overrides: Partial<SelectCompetitorInput> = {}) {
  return selectCompetitorCandidates({
    serpTopUrls: [],
    ownedDomain: 'example.com',
    ceiling: 3,
    assertSafe: allowAll,
    ...overrides,
  });
}

describe('selectCompetitorCandidates', () => {
  it('returns empty results for an empty SERP list', async () => {
    const result = await run({ serpTopUrls: [] });
    expect(result).toEqual({ selected: [], rejected: [] });
  });

  it('rejects an unparseable URL with reason invalid-url', async () => {
    const result = await run({ serpTopUrls: ['not a url'] });
    expect(result.selected).toEqual([]);
    expect(result.rejected).toEqual([{ url: 'not a url', reason: 'invalid-url' }]);
  });

  it('rejects the owned domain, stripping www. and casefolding the host', async () => {
    const result = await run({
      serpTopUrls: [
        'https://WWW.Example.COM/page',
        'https://example.com/other',
        'https://www.example.com/',
      ],
      ownedDomain: 'WWW.EXAMPLE.com',
    });
    expect(result.selected).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'owned-domain',
      'owned-domain',
      'owned-domain',
    ]);
  });

  it('rejects duplicates per normalized origin+path, including trailing slashes and the root path', async () => {
    const result = await run({
      serpTopUrls: [
        'https://a.example/page',
        'https://a.example/page/', // trailing slash → same key
        'https://WWW.a.example/page', // www + case → same key
        'https://b.example', // root → key '/'
        'https://b.example/', // explicit root slash → duplicate
      ],
      ceiling: 10,
    });
    expect(result.selected.map((s) => s.url)).toEqual([
      'https://a.example/page',
      'https://b.example',
    ]);
    expect(result.selected.map((s) => s.host)).toEqual(['a.example', 'b.example']);
    expect(result.rejected).toEqual([
      { url: 'https://a.example/page/', reason: 'duplicate' },
      { url: 'https://WWW.a.example/page', reason: 'duplicate' },
      { url: 'https://b.example/', reason: 'duplicate' },
    ]);
  });

  it('rejects every binary-asset extension case-insensitively', async () => {
    const exts = [
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip',
      '.gz', '.tar', '.7z', '.mp3', '.mp4', '.mov', '.avi', '.png', '.jpg',
      '.jpeg', '.gif', '.webp',
    ];
    const urls = exts.map((ext, i) => `https://bin-${i}.example/files/report${ext.toUpperCase()}`);
    const result = await run({ serpTopUrls: urls, ceiling: 100 });
    expect(result.selected).toEqual([]);
    expect(result.rejected.every((r) => r.reason === 'binary-asset')).toBe(true);
    expect(result.rejected).toHaveLength(exts.length);
  });

  it('accepts extension-less tails, unknown extensions, and bare-root paths (no false binary hits)', async () => {
    const result = await run({
      serpTopUrls: [
        'https://c.example/guide', // no dot in the tail
        'https://d.example/guide.html', // non-binary extension
        'https://e.example/', // root — tail after last slash is empty
        'https://f.example/dir.name/', // dot in a directory, empty tail
      ],
      ceiling: 10,
    });
    expect(result.selected.map((s) => s.host)).toEqual([
      'c.example',
      'd.example',
      'e.example',
      'f.example',
    ]);
    expect(result.rejected).toEqual([]);
  });

  it('rejects every login-wall path prefix', async () => {
    const prefixes = [
      '/login',
      '/signin',
      '/sign-in',
      '/auth',
      '/account/login',
      '/user/login',
    ];
    const urls = prefixes.map((p, i) => `https://login-${i}.example${p.toUpperCase()}/next`);
    const result = await run({ serpTopUrls: urls, ceiling: 100 });
    expect(result.selected).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual(prefixes.map(() => 'login-wall'));
  });

  it('rejects a URL whose assertSafe throws with reason unsafe and keeps scanning', async () => {
    const assertSafe = vi.fn(async (url: string) => {
      if (url.includes('unsafe')) throw new Error('private address');
      return url;
    });
    const result = await run({
      serpTopUrls: ['https://unsafe.example/x', 'https://safe.example/y'],
      assertSafe,
    });
    expect(result.rejected).toEqual([{ url: 'https://unsafe.example/x', reason: 'unsafe' }]);
    expect(result.selected).toEqual([{ url: 'https://safe.example/y', host: 'safe.example' }]);
    expect(assertSafe).toHaveBeenCalledTimes(2);
  });

  it('short-circuits immediately on a ceiling of zero (no assertSafe calls)', async () => {
    const assertSafe = vi.fn(async (url: string) => url);
    const result = await run({
      serpTopUrls: ['https://a.example/x', 'https://b.example/y'],
      ceiling: 0,
      assertSafe,
    });
    expect(result).toEqual({ selected: [], rejected: [] });
    expect(assertSafe).not.toHaveBeenCalled();
  });

  it('stops mid-list when the ceiling fills, leaving later candidates unprocessed', async () => {
    const assertSafe = vi.fn(async (url: string) => url);
    const result = await run({
      serpTopUrls: [
        'https://one.example/a',
        'https://two.example/b',
        'https://three.example/c',
      ],
      ceiling: 2,
      assertSafe,
    });
    expect(result.selected.map((s) => s.host)).toEqual(['one.example', 'two.example']);
    expect(result.rejected).toEqual([]);
    // The third URL never reached the safety authority.
    expect(assertSafe).toHaveBeenCalledTimes(2);
  });
});
