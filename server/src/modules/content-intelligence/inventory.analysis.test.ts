import { describe, expect, it } from 'vitest';
import {
  INVENTORY_THRESHOLDS,
  THRESHOLDS_VERSION,
  inventoryFindingsSchema,
  type InventoryPageFacts,
} from './inventory.schemas.js';
import {
  analyzeInventory,
  buildInventoryInboundCounts,
  emptyEvidence,
  normalizeQuery,
  normalizeUrlKey,
  type InventoryEvidence,
} from './inventory.analysis.js';

let hashSeq = 0;
function makePage(overrides: Partial<InventoryPageFacts> = {}): InventoryPageFacts {
  hashSeq += 1;
  return {
    url: `https://example.com/p${hashSeq}`,
    canonical: null,
    statusCode: 200,
    robots: [],
    language: 'en',
    title: null,
    description: null,
    headings: [],
    wordCount: 500,
    schemaTypes: [],
    hasSchemaOrgArticle: false,
    internalLinkCount: 0,
    externalLinkCount: 0,
    internalOutLinks: [],
    contentHash: `hash-${hashSeq}`,
    primaryTopics: [],
    secondaryTopics: [],
    targetQueries: [],
    qualityFlags: [],
    ...overrides,
  };
}

function evidence(overrides: Partial<InventoryEvidence> = {}): InventoryEvidence {
  return { ...emptyEvidence(), ...overrides };
}

describe('analyzeInventory — envelope', () => {
  it('returns a schema-valid empty findings set for no pages', () => {
    const findings = analyzeInventory([], emptyEvidence());
    expect(() => inventoryFindingsSchema.parse(findings)).not.toThrow();
    expect(findings.thresholdsVersion).toBe(THRESHOLDS_VERSION);
    expect(findings.clusters).toEqual([]);
    expect(findings.opportunityExplanation).toBeNull();
  });

  it('emptyEvidence is empty', () => {
    const e = emptyEvidence();
    expect(e.gscByUrl.size).toBe(0);
    expect(e.rankByQuery.size).toBe(0);
    expect(e.trackedQueries).toEqual([]);
  });
});

describe('analyzeInventory — clustering', () => {
  it('groups a 3-page transitive clique and leaves a singleton uncluttered', () => {
    // Sizes vary so both arms of the jaccard small/large ternary run.
    const a = makePage({ url: 'https://example.com/a', title: 'alpha bravo charlie delta echo' });
    const b = makePage({ url: 'https://example.com/b', title: 'alpha bravo charlie delta' });
    const c = makePage({ url: 'https://example.com/c', title: 'alpha bravo charlie delta' });
    const d = makePage({ url: 'https://example.com/d', title: 'zulu yankee xray whiskey' });
    const findings = analyzeInventory([a, b, c, d], emptyEvidence());
    expect(findings.clusters).toHaveLength(1);
    const cluster = findings.clusters[0]!;
    expect(cluster.urls).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
    expect(cluster.sharedTerms).toContain('alpha');
    expect(cluster.label).toBe('alpha');
  });

  it('labels an empty-intersection cluster by its first URL (low threshold)', () => {
    const a = makePage({ url: 'https://example.com/a', title: 'aaa bbb ccc' });
    const b = makePage({ url: 'https://example.com/b', title: 'ccc ddd eee' });
    const c = makePage({ url: 'https://example.com/c', title: 'eee fff ggg' });
    const findings = analyzeInventory([a, b, c], emptyEvidence(), {
      ...INVENTORY_THRESHOLDS,
      clusterJaccard: 0.1,
    });
    expect(findings.clusters).toHaveLength(1);
    const cluster = findings.clusters[0]!;
    expect(cluster.sharedTerms).toEqual([]);
    expect(cluster.label).toBe('https://example.com/a');
  });
});

describe('analyzeInventory — duplicates', () => {
  it('separates exact-content from near-duplicate title/heading groups', () => {
    const exact1 = makePage({ url: 'https://example.com/x1', contentHash: 'same', title: 'x' });
    const exact2 = makePage({ url: 'https://example.com/x2', contentHash: 'same', title: 'y' });
    const unique = makePage({ url: 'https://example.com/u', contentHash: 'lonely', title: 'z' });
    // Near-dup by TITLE (identical titles, different content hash).
    const nt1 = makePage({
      url: 'https://example.com/nt1',
      contentHash: 'nt-a',
      title: 'unique widget buying guide review',
    });
    const nt2 = makePage({
      url: 'https://example.com/nt2',
      contentHash: 'nt-b',
      title: 'unique widget buying guide review',
    });
    // Near-dup by HEADINGS (titles differ enough that headingSim > titleSim).
    const nh1 = makePage({
      url: 'https://example.com/nh1',
      contentHash: 'nh-a',
      title: 'aardvark',
      headings: ['shared alpha beta gamma delta epsilon zeta'],
    });
    const nh2 = makePage({
      url: 'https://example.com/nh2',
      contentHash: 'nh-b',
      title: 'buffalo',
      headings: ['shared alpha beta gamma delta epsilon zeta'],
    });
    const findings = analyzeInventory([exact1, exact2, unique, nt1, nt2, nh1, nh2], emptyEvidence());

    const exact = findings.duplicates.filter((d) => d.kind === 'exact');
    expect(exact).toHaveLength(1);
    expect(exact[0]!.field).toBe('content');
    expect(exact[0]!.similarity).toBe(1);
    expect(exact[0]!.urls).toEqual(['https://example.com/x1', 'https://example.com/x2']);

    const nearTitle = findings.duplicates.find(
      (d) => d.kind === 'near' && d.urls.includes('https://example.com/nt1'),
    );
    expect(nearTitle?.field).toBe('title');

    const nearHeading = findings.duplicates.find(
      (d) => d.kind === 'near' && d.urls.includes('https://example.com/nh1'),
    );
    expect(nearHeading?.field).toBe('headings');
  });
});

describe('analyzeInventory — thin / orphan / linking', () => {
  it('exports the same normalized, deduped inbound graph used by findings', () => {
    const a = makePage({
      url: 'https://EXAMPLE.com/a/',
      internalOutLinks: [
        'https://example.com/b/',
        'https://example.com/b',
        'https://example.com/a',
        'https://outside.example/x',
      ],
    });
    const b = makePage({ url: 'https://example.com/b' });
    const inbound = buildInventoryInboundCounts([a, b]);
    expect(inbound.get(normalizeUrlKey(a.url))).toBe(0);
    expect(inbound.get(normalizeUrlKey(b.url))).toBe(1);
  });

  it('flags thin, orphan, and weakly-linked pages with link-graph edge cases', () => {
    const p1 = makePage({
      url: 'https://example.com/p1',
      title: 'page one distinct',
      internalOutLinks: [
        'https://example.com/p2',
        'https://example.com/p2', // duplicate out-link → counted once
        'https://example.com/p1', // self-link → skipped
        '/relative', // unparseable absolute URL → skipped
        'https://external.com/x', // not in inventory → skipped
        'https://example.com/p3/', // trailing slash normalizes to /p3
      ],
    });
    const p2 = makePage({
      url: 'https://example.com/p2',
      title: 'page two distinct',
      internalOutLinks: ['https://example.com/p3'],
    });
    const p3 = makePage({ url: 'https://example.com/p3', title: 'page three distinct' });
    const p4 = makePage({ url: 'https://example.com/p4', title: 'page four distinct', wordCount: 100 });

    const findings = analyzeInventory([p1, p2, p3, p4], emptyEvidence());

    expect(findings.thinPages.map((f) => f.url)).toEqual(['https://example.com/p4']);
    // p1 (0 inbound) + p4 (0 inbound) are orphans; p2 (1 inbound) is weak; p3 (2) is fine.
    const orphanUrls = findings.orphanPages
      .filter((f) => f.reason === 'orphan')
      .map((f) => f.url);
    expect(orphanUrls).toEqual(['https://example.com/p1', 'https://example.com/p4']);
    const weak = findings.orphanPages.find((f) => f.reason === 'weakly_linked');
    expect(weak?.url).toBe('https://example.com/p2');
    expect(weak?.internalLinkCount).toBe(1);
    expect(findings.orphanPages.some((f) => f.url === 'https://example.com/p3')).toBe(false);
  });

  it('sorts multiple thin pages deterministically', () => {
    const z = makePage({ url: 'https://example.com/zzz', title: 'zeta unique', wordCount: 10 });
    const a = makePage({ url: 'https://example.com/aaa', title: 'alpha unique', wordCount: 10 });
    const findings = analyzeInventory([z, a], emptyEvidence());
    expect(findings.thinPages.map((f) => f.url)).toEqual([
      'https://example.com/aaa',
      'https://example.com/zzz',
    ]);
  });
});

describe('analyzeInventory — cannibalization', () => {
  it('grades confidence by GSC / rank evidence and never on density alone', () => {
    const q1 = makePage({
      url: 'https://example.com/q1',
      title: 'q1',
      targetQueries: ['buy shoes', 'blue widgets', 'green socks', 'solo term'],
    });
    const q2 = makePage({
      url: 'https://example.com/q2',
      title: 'q2',
      targetQueries: ['buy shoes', 'blue widgets', 'green socks'],
    });
    const q3 = makePage({ url: 'https://example.com/q3', title: 'q3' });
    const q4 = makePage({ url: 'https://example.com/q4', title: 'q4' });

    const gscByUrl = new Map([
      [
        normalizeUrlKey('https://example.com/q1'),
        [
          { query: 'buy shoes', impressions: 10, clicks: 1, position: 3 },
          { query: 'blue widgets', impressions: 8, clicks: 0, position: 5 },
          { query: '', impressions: 3, clicks: 0, position: 9 }, // empty query → skipped
        ],
      ],
      [
        normalizeUrlKey('https://example.com/q2'),
        [
          { query: 'buy shoes', impressions: 5, clicks: 0, position: 4 },
          { query: 'blue widgets', impressions: 0, clicks: 0, position: 12 }, // 0 impressions
        ],
      ],
    ]);
    const rankByQuery = new Map([
      [
        'red hats',
        [
          { url: 'https://example.com/q3', position: 2 },
          { url: 'https://example.com/q4', position: 6 },
          { url: 'https://example.com/notcrawled', position: 9 }, // not in inventory → skipped
        ],
      ],
      ['!!!', [{ url: 'https://example.com/q3', position: 1 }]], // empty query → skipped
    ]);

    const findings = analyzeInventory(
      [q1, q2, q3, q4],
      evidence({ gscByUrl, rankByQuery }),
    );

    const byQuery = new Map(findings.cannibalization.map((c) => [c.query, c]));
    expect(byQuery.get('buy shoes')?.confidence).toBe('high');
    expect(byQuery.get('buy shoes')?.hasGscEvidence).toBe(true);
    expect(byQuery.get('blue widgets')?.confidence).toBe('medium');
    expect(byQuery.get('red hats')?.confidence).toBe('medium');
    expect(byQuery.get('red hats')?.urls).toEqual([
      'https://example.com/q3',
      'https://example.com/q4',
    ]);
    const green = byQuery.get('green socks');
    expect(green?.confidence).toBe('low');
    expect(green?.hasGscEvidence).toBe(false);
    expect(green?.evidenceSourceIds).toContain('query:https://example.com/q1');
    // A query targeted by a single page is never a cannibalization candidate.
    expect(byQuery.has('solo term')).toBe(false);
  });
});

describe('analyzeInventory — topical gaps', () => {
  it('grades gap confidence high (GSC) / medium (rank) / low (tracked only)', () => {
    const g1 = makePage({
      url: 'https://example.com/g1',
      title: 'g1',
      targetQueries: ['covered topic'],
    });
    const g2 = makePage({ url: 'https://example.com/g2', title: 'g2' }); // no gsc rows

    const gscByUrl = new Map([
      // GSC data for a URL that was NOT crawled → demand without coverage.
      [
        normalizeUrlKey('https://example.com/notcrawled'),
        [
          { query: 'gsc gap', impressions: 20, clicks: 2, position: 4 },
          { query: 'zero imp', impressions: 0, clicks: 0, position: 30 }, // impressions 0
        ],
      ],
      // An inventory page WITH a gsc row → exercises the covered gsc branch.
      [
        normalizeUrlKey('https://example.com/g1'),
        [{ query: 'covered topic', impressions: 4, clicks: 1, position: 2 }],
      ],
    ]);
    const rankByQuery = new Map([
      ['rank gap', [{ url: 'https://example.com/notcrawled2', position: 5 }]],
      ['covered by rank', [{ url: 'https://example.com/g1', position: 3 }]],
    ]);

    const findings = analyzeInventory(
      [g1, g2],
      evidence({
        gscByUrl,
        rankByQuery,
        // 'gsc gap' is also tracked → the demand entry is created then merged.
        trackedQueries: ['covered topic', 'low demand topic', 'gsc gap', '!!!'],
      }),
    );

    const byQuery = new Map(findings.gaps.map((g) => [g.query, g]));
    expect(byQuery.get('gsc gap')?.confidence).toBe('high');
    expect(byQuery.get('rank gap')?.confidence).toBe('medium');
    expect(byQuery.get('low demand topic')?.confidence).toBe('low');
    // Covered queries never appear as gaps.
    expect(byQuery.has('covered topic')).toBe(false);
    expect(byQuery.has('covered by rank')).toBe(false);
    // A pure punctuation tracked query normalizes empty and is dropped.
    expect(byQuery.has('')).toBe(false);
  });
});

describe('tokenization + normalization guards', () => {
  it('caps distinct terms per page and skips null / short tokens', () => {
    const manyTerms = Array.from({ length: 250 }, (_, i) => `token${i}`).join(' ');
    const p = makePage({
      url: 'https://example.com/big',
      title: null, // null string skipped in tokenize
      headings: [`of a an ${manyTerms}`], // < 3-char tokens skipped
    });
    // Should not throw despite the > maxTermsPerPage term stream.
    const findings = analyzeInventory([p, makePage({ title: 'unrelated words here' })], emptyEvidence());
    expect(() => inventoryFindingsSchema.parse(findings)).not.toThrow();
  });

  it('normalizeUrlKey strips trailing slash, keeps root, tolerates junk', () => {
    expect(normalizeUrlKey('https://EX.com/A/')).toBe('https://ex.com/a');
    expect(normalizeUrlKey('https://ex.com/')).toBe('https://ex.com/');
    expect(normalizeUrlKey('/relative')).toBe('/relative');
  });

  it('normalizeQuery lowercases, collapses whitespace, and empties on junk', () => {
    expect(normalizeQuery('  Buy  BLUE Widgets!! ')).toBe('buy blue widgets');
    expect(normalizeQuery('!!!')).toBe('');
  });
});
