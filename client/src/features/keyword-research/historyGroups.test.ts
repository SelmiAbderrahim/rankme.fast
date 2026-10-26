import { describe, expect, it } from 'vitest';
import {
  LEGACY_PAIR_WINDOW_MS,
  canViewStoredResult,
  groupResearchHistory,
  sortKinds,
} from './historyGroups';
import type { ResearchHistoryItem } from './types';

const T0 = Date.parse('2026-07-10T12:00:00.000Z');
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const item = (
  id: string,
  kind: ResearchHistoryItem['kind'],
  overrides: Partial<ResearchHistoryItem> = {},
): ResearchHistoryItem => ({
  id,
  kind,
  phrases: ['pystub generator'],
  locationCode: 2840,
  languageCode: 'en',
  resultCount: 1,
  cached: false,
  lookupId: null,
  createdAt: at(0),
  ...overrides,
});

describe('groupResearchHistory — shared lookupId (exact)', () => {
  it('folds a metrics+intent pair with the same lookupId into one row, whatever the timing', () => {
    const groups = groupResearchHistory([
      item('i', 'intent', { lookupId: 'L1', createdAt: at(-3_600_000) }),
      item('m', 'metrics', { lookupId: 'L1', resultCount: 7 }),
    ]);
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group!.id).toBe('m');
    expect(group!.primary.id).toBe('m');
    expect(group!.members.map((m) => m.id)).toEqual(['i', 'm']);
    expect(group!.kinds).toEqual(['metrics', 'intent']);
    expect(group!.resultCount).toBe(7);
    // Newest member's time is the row time (the first listed member here).
    expect(group!.createdAt).toBe(at(-3_600_000));
  });

  it('keeps two real presses of the same phrases separate when their lookupIds differ', () => {
    const groups = groupResearchHistory([
      item('m2', 'metrics', { lookupId: 'L2', createdAt: at(10_000) }),
      item('i2', 'intent', { lookupId: 'L2', createdAt: at(10_500) }),
      item('m1', 'metrics', { lookupId: 'L1', createdAt: at(0) }),
      item('i1', 'intent', { lookupId: 'L1', createdAt: at(500) }),
    ]);
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([
      ['m2', 'i2'],
      ['m1', 'i1'],
    ]);
  });

  it('leaves a lone half alone and ignores extra records of an already-paired kind', () => {
    const groups = groupResearchHistory([
      item('m', 'metrics', { lookupId: 'L1' }),
      item('m-dup', 'metrics', { lookupId: 'L1' }),
      item('i', 'intent', { lookupId: 'L1' }),
      item('i-dup', 'intent', { lookupId: 'L1' }),
      item('only-m', 'metrics', { lookupId: 'L9', phrases: ['other'] }),
      item('only-i', 'intent', { lookupId: 'L8', phrases: ['another'] }),
    ]);
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([
      ['m', 'i'],
      ['m-dup'],
      ['i-dup'],
      ['only-m'],
      ['only-i'],
    ]);
  });

  it('never pairs a lookupId record with a legacy record, even for identical phrases and time', () => {
    const groups = groupResearchHistory([
      item('m', 'metrics', { lookupId: 'L1' }),
      item('i', 'intent', { lookupId: null }),
    ]);
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([['m'], ['i']]);
  });
});

describe('groupResearchHistory — legacy records (no lookupId)', () => {
  it('pairs opposite kinds with the same phrase set and market within the 60 s window', () => {
    const groups = groupResearchHistory([
      item('i', 'intent', { phrases: ['b', 'A'], createdAt: at(20_000) }),
      item('m', 'metrics', { phrases: ['a', ' B '], createdAt: at(0) }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.primary.id).toBe('m');
    expect(groups[0]!.kinds).toEqual(['metrics', 'intent']);
  });

  it('does not pair across the window edge, across markets, or across phrase sets', () => {
    expect(
      groupResearchHistory([
        item('i', 'intent', { createdAt: at(LEGACY_PAIR_WINDOW_MS) }),
        item('m', 'metrics', { createdAt: at(0) }),
      ]),
    ).toHaveLength(1);
    expect(
      groupResearchHistory([
        item('i', 'intent', { createdAt: at(LEGACY_PAIR_WINDOW_MS + 1) }),
        item('m', 'metrics', { createdAt: at(0) }),
      ]),
    ).toHaveLength(2);
    expect(
      groupResearchHistory([
        item('i', 'intent', { locationCode: 2826 }),
        item('m', 'metrics'),
      ]),
    ).toHaveLength(2);
    expect(
      groupResearchHistory([
        item('i', 'intent', { languageCode: 'de' }),
        item('m', 'metrics'),
      ]),
    ).toHaveLength(2);
    expect(
      groupResearchHistory([
        item('i', 'intent', { phrases: ['pystub generator', 'extra'] }),
        item('m', 'metrics'),
      ]),
    ).toHaveLength(2);
  });

  it('never pairs two records of the same kind (two real searches stay two rows)', () => {
    const groups = groupResearchHistory([
      item('m2', 'metrics', { createdAt: at(5_000) }),
      item('m1', 'metrics', { createdAt: at(0) }),
    ]);
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([['m2'], ['m1']]);
  });

  it('pairs each record at most once, nearest in time first, so a rapid repeat keeps two rows', () => {
    // m2/i2 were 1 s apart; m1/i1 were 1 s apart; m2 is closer to i2 than to i1.
    const groups = groupResearchHistory([
      item('i2', 'intent', { createdAt: at(31_000) }),
      item('m2', 'metrics', { createdAt: at(30_000) }),
      item('i1', 'intent', { createdAt: at(1_000) }),
      item('m1', 'metrics', { createdAt: at(0) }),
    ]);
    expect(groups.map((g) => g.members.map((m) => m.id).sort())).toEqual([
      ['i2', 'm2'],
      ['i1', 'm1'],
    ]);
  });

  it('breaks equal-distance ties toward the record earlier in the list and skips taken partners', () => {
    const groups = groupResearchHistory([
      item('i-a', 'intent', { createdAt: at(10_000) }),
      item('i-b', 'intent', { createdAt: at(-10_000) }),
      item('m-1', 'metrics', { createdAt: at(0) }),
      item('m-2', 'metrics', { createdAt: at(0) }),
    ]);
    // m-1 takes i-a (first of the equidistant pair); m-2 is left with i-b.
    expect(groups.map((g) => g.members.map((m) => m.id))).toEqual([
      ['i-a', 'm-1'],
      ['i-b', 'm-2'],
    ]);
  });

  it('folds a pair whose halves arrive on different pages once both are in the list', () => {
    const page1 = [item('i', 'intent')];
    expect(groupResearchHistory(page1)).toHaveLength(1);
    expect(groupResearchHistory(page1)[0]!.primary.id).toBe('i');
    const both = [...page1, item('m', 'metrics', { createdAt: at(-1_000) })];
    const groups = groupResearchHistory(both);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.primary.id).toBe('m');
  });
});

describe('groupResearchHistory — output', () => {
  it('keeps list order, reports cached only when EVERY member was cached, and never pairs other kinds', () => {
    const groups = groupResearchHistory([
      item('gap', 'gap', { phrases: ['rival.example'] }),
      item('i', 'intent', { lookupId: 'L1', cached: true }),
      item('m', 'metrics', { lookupId: 'L1', cached: false }),
      item('ideas', 'ideas', { cached: true, phrases: ['seed'] }),
      item('i2', 'intent', { lookupId: 'L2', cached: true, phrases: ['z'] }),
      item('m2', 'metrics', { lookupId: 'L2', cached: true, phrases: ['z'] }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['gap', 'm', 'ideas', 'm2']);
    expect(groups.map((g) => g.cached)).toEqual([false, false, true, true]);
    expect(groups[1]!.phrases).toEqual(['pystub generator']);
    expect(groups[1]!.locationCode).toBe(2840);
    expect(groups[1]!.languageCode).toBe('en');
  });

  it('an intent-only row is its own primary', () => {
    const [group] = groupResearchHistory([item('i', 'intent')]);
    expect(group!.primary.id).toBe('i');
    expect(group!.kinds).toEqual(['intent']);
  });

  it('returns nothing for nothing', () => {
    expect(groupResearchHistory([])).toEqual([]);
  });
});

describe('row capabilities', () => {
  it('only kinds with a stored result can be viewed', () => {
    for (const kind of ['metrics', 'intent', 'related', 'ideas', 'long_tail'] as const) {
      expect(canViewStoredResult({ kinds: [kind] })).toBe(true);
    }
    for (const kind of ['gap', 'overview', 'trends', 'clusters'] as const) {
      expect(canViewStoredResult({ kinds: [kind] })).toBe(false);
    }
    expect(canViewStoredResult({ kinds: ['gap', 'metrics'] })).toBe(true);
  });
});

describe('sortKinds', () => {
  it('orders lookup-type tags the same way whichever record is newer, then every other kind by its place', () => {
    expect(sortKinds(['intent', 'metrics'])).toEqual(['metrics', 'intent']);
    expect(sortKinds(['metrics', 'intent'])).toEqual(['metrics', 'intent']);
    expect(sortKinds(['clusters', 'long_tail', 'gap', 'related', 'ideas', 'trends', 'overview'])).toEqual([
      'related',
      'ideas',
      'long_tail',
      'gap',
      'overview',
      'trends',
      'clusters',
    ]);
  });
});
