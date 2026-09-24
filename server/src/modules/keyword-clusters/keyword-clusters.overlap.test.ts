import { describe, expect, it } from 'vitest';
import {
  clusterKeywordsBySerpOverlap,
  prepareComparisonWindow,
  sharedUrls,
  type ClusterInputKeyword,
} from './keyword-clusters.overlap.js';
import {
  KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN,
  KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED,
  KEYWORD_CLUSTER_MIN_SHARED_URLS,
  KEYWORD_CLUSTER_TOP_URLS,
  keywordClusterSetSchema,
} from './keyword-clusters.schemas.js';

const OBSERVED = '2026-08-04T00:00:00.000Z';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const url = (n: number): string => `https://example.com/result-${n}`;

const keyword = (
  n: number,
  urls: readonly number[],
  phrase = `kw-${String(n).padStart(3, '0')}`,
): ClusterInputKeyword => ({
  keywordId: uuid(n),
  phrase,
  observedAt: OBSERVED,
  topUrls: urls.map(url),
});

/** Deterministic in-test shuffle — never `Math.random` (breaks resume). */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('prepareComparisonWindow', () => {
  it('normalizes, de-duplicates, then truncates in that order', () => {
    const window = prepareComparisonWindow(
      [
        'https://Example.com/a/',
        'https://example.com/a',
        'https://example.com/b#frag',
        'https://example.com/c',
      ],
      3,
    );
    expect(window).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
  });

  it('drops an empty normalized key and stops at the window size', () => {
    const window = prepareComparisonWindow(
      ['', 'https://example.com/a', 'https://example.com/b'],
      1,
    );
    expect(window).toEqual(['https://example.com/a']);
  });
});

describe('sharedUrls', () => {
  it('is symmetric for every generated pair', () => {
    for (let left = 0; left < 8; left += 1) {
      for (let right = 0; right < 8; right += 1) {
        const a = prepareComparisonWindow(
          [0, 1, 2, 3].filter((n) => (left >> n) & 1).map(url),
          KEYWORD_CLUSTER_TOP_URLS,
        );
        const b = prepareComparisonWindow(
          [0, 1, 2, 3].filter((n) => (right >> n) & 1).map(url),
          KEYWORD_CLUSTER_TOP_URLS,
        );
        expect(sharedUrls(new Set(a), b)).toEqual(sharedUrls(new Set(b), a));
      }
    }
  });
});

describe('clusterKeywordsBySerpOverlap', () => {
  it('groups a pair at the threshold and splits it one URL below', () => {
    const atThreshold = clusterKeywordsBySerpOverlap({
      keywords: [keyword(1, [1, 2, 3, 4]), keyword(2, [1, 2, 3, 9])],
    });
    expect(atThreshold).toHaveLength(1);
    expect(atThreshold[0]!.size).toBe(2);
    expect(atThreshold[0]!.members[1]!.sharedUrlCount).toBe(
      KEYWORD_CLUSTER_MIN_SHARED_URLS,
    );

    const belowThreshold = clusterKeywordsBySerpOverlap({
      keywords: [keyword(1, [1, 2, 3, 4]), keyword(2, [1, 2, 8, 9])],
    });
    expect(belowThreshold).toHaveLength(2);
    expect(belowThreshold.every((cluster) => cluster.size === 1)).toBe(true);
  });

  it('adding one shared URL groups a previously split pair', () => {
    const before = clusterKeywordsBySerpOverlap({
      keywords: [keyword(1, [1, 2, 3]), keyword(2, [1, 2, 7])],
    });
    const after = clusterKeywordsBySerpOverlap({
      keywords: [keyword(1, [1, 2, 3]), keyword(2, [1, 2, 3])],
    });
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(1);
  });

  it('emits a keyword that matches nothing as its own single-member cluster', () => {
    const clusters = clusterKeywordsBySerpOverlap({
      keywords: [
        keyword(1, [1, 2, 3]),
        keyword(2, [1, 2, 3]),
        keyword(3, [90, 91, 92]),
      ],
    });
    expect(clusters).toHaveLength(2);
    const singleton = clusters.find((cluster) => cluster.size === 1);
    expect(singleton?.members[0]!.keywordId).toBe(uuid(3));
    expect(singleton?.members[0]!.isPivot).toBe(true);
  });

  it('is invariant under every seeded permutation of the input', () => {
    const keywords = [
      keyword(1, [1, 2, 3, 4]),
      keyword(2, [1, 2, 3, 5]),
      keyword(3, [20, 21, 22]),
      keyword(4, [20, 21, 22, 23]),
      keyword(5, [50]),
    ];
    const baseline = JSON.stringify(clusterKeywordsBySerpOverlap({ keywords }));
    for (const seed of [1, 7, 13, 99, 12_345]) {
      const shuffled = seededShuffle(keywords, seed);
      expect(JSON.stringify(clusterKeywordsBySerpOverlap({ keywords: shuffled }))).toBe(
        baseline,
      );
    }
  });

  it('partitions the input: every keyword appears in exactly one cluster', () => {
    const keywords = Array.from({ length: 24 }, (_, index) =>
      keyword(index + 1, [index % 6, (index % 6) + 1, (index % 6) + 2, index + 40]),
    );
    const clusters = clusterKeywordsBySerpOverlap({ keywords });
    const seen = clusters.flatMap((cluster) =>
      cluster.members.map((member) => member.keywordId),
    );
    expect(new Set(seen).size).toBe(keywords.length);
    expect(seen).toHaveLength(keywords.length);
  });

  it('gives every grouped member its overlap evidence and the pivot first', () => {
    const clusters = clusterKeywordsBySerpOverlap({
      keywords: [
        keyword(1, [1, 2, 3, 4]),
        keyword(2, [1, 2, 3, 5]),
        keyword(3, [1, 2, 3, 6]),
      ],
    });
    expect(clusters).toHaveLength(1);
    const [cluster] = clusters;
    expect(cluster!.members[0]!.isPivot).toBe(true);
    for (const member of cluster!.members.slice(1)) {
      expect(member.isPivot).toBe(false);
      expect(member.sharedUrlCount).toBeGreaterThanOrEqual(
        KEYWORD_CLUSTER_MIN_SHARED_URLS,
      );
      expect(member.sharedUrls).toHaveLength(member.sharedUrlCount);
    }
    // The common core is the intersection across ALL three windows.
    expect(cluster!.sharedUrls).toEqual([url(1), url(2), url(3)].sort());
  });

  it('reports a common core shorter than the threshold without dropping evidence', () => {
    // Both members share 3 URLs with the pivot, but not the SAME three.
    const clusters = clusterKeywordsBySerpOverlap({
      keywords: [
        keyword(1, [1, 2, 3, 4, 5, 6]),
        keyword(2, [1, 2, 3, 70]),
        keyword(3, [1, 5, 6, 71]),
      ],
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.sharedUrls).toEqual([url(1)]);
    expect(
      clusters[0]!.members.slice(1).every(
        (member) => member.sharedUrlCount >= KEYWORD_CLUSTER_MIN_SHARED_URLS,
      ),
    ).toBe(true);
  });

  it('never chains: A~B and B~C do not merge when A and C share nothing', () => {
    const clusters = clusterKeywordsBySerpOverlap({
      keywords: [
        keyword(1, [1, 2, 3], 'aaa'),
        keyword(2, [1, 2, 3, 4, 5, 6], 'bbb'),
        keyword(3, [4, 5, 6], 'ccc'),
      ],
    });
    // `aaa` is the first pivot and groups `bbb`; `ccc` shares nothing with the
    // pivot, so it forms its own cluster instead of chaining through `bbb`.
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.members.map((member) => member.phrase)).toEqual(['aaa', 'bbb']);
    expect(clusters[1]!.members.map((member) => member.phrase)).toEqual(['ccc']);
  });

  it('breaks a phrase tie on keyword id, in either input order', () => {
    // Both comparator arms: the sort sees (9, 2) in one order and (2, 9) in the
    // other, so neither `-1` nor `1` branch can hide.
    for (const keywords of [
      [keyword(9, [1], 'same'), keyword(2, [2], 'same')],
      [keyword(2, [2], 'same'), keyword(9, [1], 'same')],
    ]) {
      const clusters = clusterKeywordsBySerpOverlap({ keywords });
      expect(clusters.map((cluster) => cluster.pivotKeywordId)).toEqual([
        uuid(2),
        uuid(9),
      ]);
    }
  });

  it('orders distinct phrases in either input order', () => {
    for (const keywords of [
      [keyword(1, [1], 'zzz last'), keyword(2, [2], 'aaa first')],
      [keyword(2, [2], 'aaa first'), keyword(1, [1], 'zzz last')],
    ]) {
      const clusters = clusterKeywordsBySerpOverlap({ keywords });
      expect(clusters.map((cluster) => cluster.members[0]!.phrase)).toEqual([
        'aaa first',
        'zzz last',
      ]);
    }
  });

  it('honours a run-frozen threshold and window', () => {
    const keywords = [keyword(1, [1, 2, 3, 4]), keyword(2, [1, 2, 9, 8])];
    expect(
      clusterKeywordsBySerpOverlap({ keywords, minSharedUrls: 2 }),
    ).toHaveLength(1);
    expect(
      clusterKeywordsBySerpOverlap({ keywords, minSharedUrls: 2, topUrlWindow: 1 }),
    ).toHaveLength(2);
  });

  it('clamps the input and the stored evidence arrays', () => {
    const keywords = Array.from({ length: KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN + 5 },
      (_, index) => keyword(index + 1, [index + 1_000]));
    const clusters = clusterKeywordsBySerpOverlap({ keywords });
    expect(clusters).toHaveLength(KEYWORD_CLUSTER_MAX_KEYWORDS_PER_RUN);

    const wide = clusterKeywordsBySerpOverlap({
      keywords: [
        keyword(1, Array.from({ length: 40 }, (_, index) => index)),
        keyword(2, Array.from({ length: 40 }, (_, index) => index)),
      ],
    });
    expect(wide[0]!.members[0]!.sharedUrls.length).toBeLessThanOrEqual(
      KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED,
    );
    expect(wide[0]!.sharedUrls.length).toBeLessThanOrEqual(
      KEYWORD_CLUSTER_MAX_SHARED_URLS_STORED,
    );
  });

  it('produces output the persistence-boundary schema accepts', () => {
    const clusters = clusterKeywordsBySerpOverlap({
      keywords: [keyword(1, [1, 2, 3, 4]), keyword(2, [1, 2, 3]), keyword(3, [80])],
    });
    expect(() => keywordClusterSetSchema.parse(clusters)).not.toThrow();
  });
});

describe('the honesty invariant is enforced at the schema, not only in code', () => {
  it('refuses a grouped member without overlap evidence', () => {
    const [cluster] = clusterKeywordsBySerpOverlap({
      keywords: [keyword(1, [1, 2, 3]), keyword(2, [1, 2, 3])],
    });
    const tampered = {
      ...cluster!,
      members: [
        cluster!.members[0]!,
        { ...cluster!.members[1]!, sharedUrls: [], sharedUrlCount: 0 },
      ],
    };
    expect(() => keywordClusterSetSchema.parse([tampered])).toThrow(
      /validation\.issue\.custom/,
    );
  });

  it('refuses a size that disagrees with the member count', () => {
    const [cluster] = clusterKeywordsBySerpOverlap({ keywords: [keyword(1, [1])] });
    expect(() =>
      keywordClusterSetSchema.parse([{ ...cluster!, size: 4 }]),
    ).toThrow(/validation\.issue\.custom/);
  });

  it('refuses a cluster whose first member is not the pivot', () => {
    const [cluster] = clusterKeywordsBySerpOverlap({ keywords: [keyword(1, [1])] });
    expect(() =>
      keywordClusterSetSchema.parse([
        {
          ...cluster!,
          members: [{ ...cluster!.members[0]!, isPivot: false }],
        },
      ]),
    ).toThrow(/validation\.issue\.custom/);
  });

  it('refuses a label without its source and vice versa', () => {
    const [cluster] = clusterKeywordsBySerpOverlap({ keywords: [keyword(1, [1])] });
    expect(() =>
      keywordClusterSetSchema.parse([{ ...cluster!, label: 'Shoes' }]),
    ).toThrow(/validation\.issue\.custom/);
    expect(() =>
      keywordClusterSetSchema.parse([{ ...cluster!, labelSource: 'ai' }]),
    ).toThrow(/validation\.issue\.custom/);
  });
});
