import { describe, expect, it } from 'vitest';
import type { InventoryPageFacts } from '../content-intelligence/index.js';
import {
  generateInternalLinkCandidates,
  normalizeInternalLinkText,
  sourceSectionForUrl,
  truncateCodePoints,
} from './internal-links.candidates.js';

const INVENTORY_DATE = '2026-08-01T12:00:00.000Z';
let sequence = 0;

function page(
  url: string,
  overrides: Partial<InventoryPageFacts> = {},
): InventoryPageFacts {
  sequence += 1;
  return {
    url,
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
    contentHash: `hash-${sequence}`,
    primaryTopics: [],
    secondaryTopics: [],
    targetQueries: [],
    qualityFlags: [],
    ...overrides,
  };
}

function generate(
  pages: InventoryPageFacts[],
  gscQueriesByUrl: ReadonlyMap<string, readonly string[]> = new Map(),
) {
  return generateInternalLinkCandidates({
    pages,
    gscQueriesByUrl,
    inventoryDate: INVENTORY_DATE,
  });
}

describe('candidate text helpers', () => {
  it('normalizes Unicode/space, truncates by code point, and derives safe sections', () => {
    expect(normalizeInternalLinkText('  ＳＥＯ\n\tAudit  ')).toBe('seo audit');
    expect(normalizeInternalLinkText('x'.repeat(4_100))).toHaveLength(4_000);
    expect(truncateCodePoints('😀😀😀', 2)).toBe('😀😀');
    expect(sourceSectionForUrl('https://example.com/')).toBe('/');
    expect(sourceSectionForUrl('https://example.com/learn%20seo/page')).toBe('/learn seo');
    expect(sourceSectionForUrl('https://example.com/%E0%A4%A/page')).toBe('/%E0%A4%A');
    expect(sourceSectionForUrl('not a url')).toBe('/');
    expect(sourceSectionForUrl(`https://example.com/${'x'.repeat(300)}`)).toHaveLength(256);
  });
});

describe('generateInternalLinkCandidates — deterministic rules', () => {
  it('pins the one-vs-two heading-token threshold and evidence fields', () => {
    const target = page('https://example.com/services/audit', {
      title: 'SEO audit service',
      headings: ['SEO audit basics'],
      qualityFlags: ['orphan'],
    });
    const one = page('https://example.com/blog/one', {
      headings: ['SEO pricing'],
      wordCount: 800,
    });
    const two = page('https://example.com/blog/two', {
      headings: ['SEO audit checklist'],
      wordCount: 700,
    });
    const result = generate([one, target, two]);
    const towardTarget = result.filter((candidate) => candidate.targetUrl === target.url);
    expect(towardTarget).toHaveLength(1);
    expect(towardTarget[0]).toMatchObject({
      sourceUrl: two.url,
      targetFlag: 'orphan',
      targetInboundCount: 0,
      confidence: 'low',
      headingMatches: ['audit', 'seo'],
      sharedQueries: [],
      anchorText: 'SEO audit basics',
      sourceSection: '/blog',
      inventoryDate: INVENTORY_DATE,
      rank: null,
      rankingSource: 'deterministic',
    });
    expect(towardTarget[0]?.id).toMatch(/^link-[0-9a-f]{20}$/u);
  });

  it('uses shared 28-day GSC queries independently and grades all confidence levels', () => {
    const target = page('https://example.com/target', {
      headings: ['content audit guide framework'],
      qualityFlags: ['orphan'],
    });
    const queryOnly = page('https://example.com/query-only', { headings: ['different words'] });
    const both = page('https://example.com/both', { headings: ['audit guide other'] });
    const fourHeadings = page('https://example.com/four', {
      headings: ['content audit guide framework'],
    });
    const gsc = new Map<string, readonly string[]>([
      [target.url, [' SEO Audit ', 'SEO\tAudit']],
      [queryOnly.url, ['seo audit']],
      [both.url, ['seo audit']],
    ]);
    const result = generate([target, queryOnly, both, fourHeadings], gsc);
    const bySource = new Map(
      result
        .filter((candidate) => candidate.targetUrl === target.url)
        .map((candidate) => [candidate.sourceUrl, candidate]),
    );
    expect(bySource.get(queryOnly.url)?.confidence).toBe('medium');
    expect(bySource.get(queryOnly.url)?.sharedQueries).toEqual(['seo audit']);
    expect(bySource.get(both.url)?.confidence).toBe('high');
    expect(bySource.get(fourHeadings.url)?.confidence).toBe('medium');
  });

  it('recomputes orphan/weak targets, excludes noindex/existing edges, and orders ties', () => {
    const orphan = page('https://example.com/orphan', {
      headings: ['internal linking guide'],
      qualityFlags: ['weakly_linked'],
    });
    const weak = page('https://example.com/weak', {
      headings: ['internal linking guide'],
      qualityFlags: ['orphan'],
    });
    const healthy = page('https://example.com/healthy', {
      headings: ['internal linking guide'],
    });
    const sourceA = page('https://example.com/a', {
      headings: ['internal linking guide'],
      wordCount: 900,
      internalOutLinks: [weak.url, healthy.url],
    });
    const sourceB = page('https://example.com/b', {
      headings: ['internal linking guide'],
      wordCount: 700,
      internalOutLinks: [healthy.url],
    });
    const noindexSource = page('https://example.com/noindex-source', {
      headings: ['internal linking guide'],
      qualityFlags: ['noindex'],
      internalOutLinks: [healthy.url],
    });
    const noindexTarget = page('https://example.com/noindex-target', {
      headings: ['internal linking guide'],
      qualityFlags: ['noindex', 'orphan'],
    });
    const result = generate([
      sourceB,
      noindexTarget,
      healthy,
      sourceA,
      weak,
      orphan,
      noindexSource,
    ]);
    expect(result.some((candidate) => candidate.targetUrl === noindexTarget.url)).toBe(false);
    expect(result.some((candidate) => candidate.sourceUrl === noindexSource.url)).toBe(false);
    expect(
      result.some(
        (candidate) => candidate.sourceUrl === sourceA.url && candidate.targetUrl === weak.url,
      ),
    ).toBe(false);
    expect(result.some((candidate) => candidate.targetUrl === healthy.url)).toBe(false);
    const orphanCandidates = result.filter((candidate) => candidate.targetUrl === orphan.url);
    expect(orphanCandidates[0]?.sourceUrl).toBe(sourceA.url);
    expect(orphanCandidates.every((candidate) => candidate.targetFlag === 'orphan')).toBe(true);
    const weakCandidate = result.find(
      (candidate) => candidate.targetUrl === weak.url && candidate.sourceUrl === sourceB.url,
    );
    expect(weakCandidate?.targetFlag).toBe('weakly_linked');
    expect(weakCandidate?.targetInboundCount).toBe(1);
  });

  it('property: input permutations produce byte-identical output', () => {
    const pages = [
      page('https://example.com/c', { headings: ['alpha beta gamma'] }),
      page('https://example.com/a', { headings: ['alpha beta delta'] }),
      page('https://example.com/b', { headings: ['alpha beta epsilon'] }),
    ];
    const permutations = [
      pages,
      [pages[2]!, pages[0]!, pages[1]!],
      [pages[1]!, pages[2]!, pages[0]!],
      [...pages].reverse(),
    ];
    const outputs = permutations.map((value) => JSON.stringify(generate(value)));
    expect(new Set(outputs).size).toBe(1);
  });

  it('property: existing-edge direction is not treated as symmetric', () => {
    const a = page('https://example.com/a', {
      headings: ['shared topic words'],
      internalOutLinks: ['https://example.com/b'],
    });
    const b = page('https://example.com/b', { headings: ['shared topic words'] });
    const result = generate([a, b]);
    expect(
      result.some((candidate) => candidate.sourceUrl === a.url && candidate.targetUrl === b.url),
    ).toBe(false);
    expect(
      result.some((candidate) => candidate.sourceUrl === b.url && candidate.targetUrl === a.url),
    ).toBe(true);
  });

  it('property: per-target/evidence/global bounds hold for a dense graph', () => {
    const sharedQueries = Array.from({ length: 15 }, (_, index) => `query ${index}`);
    const pages = Array.from({ length: 25 }, (_, index) =>
      page(`https://example.com/section-${index}/page`, {
        headings: ['alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'],
        wordCount: 500 + index,
      }),
    );
    const gsc = new Map(pages.map((item) => [item.url, sharedQueries]));
    const result = generate(pages, gsc);
    expect(result).toHaveLength(100);
    const perTarget = new Map<string, number>();
    for (const candidate of result) {
      perTarget.set(candidate.targetUrl, (perTarget.get(candidate.targetUrl) ?? 0) + 1);
      expect(candidate.sharedQueries.length).toBeLessThanOrEqual(10);
      expect(candidate.headingMatches.length).toBeLessThanOrEqual(10);
    }
    expect(Math.max(...perTarget.values())).toBeLessThanOrEqual(5);
  });

  it('builds bounded fallback anchors from heading, title, path, host, and invalid URL', () => {
    const source = page('https://example.com/source', { headings: ['source only'] });
    const targets = [
      page('https://example.com/heading', { headings: ['😀'.repeat(121)] }),
      page('https://example.com/title', { title: 'Target title' }),
      page('https://example.com/path-name', {}),
      page('https://example.com/', {}),
      page('not-a-url', {}),
      page('https://example.com/blank-title', { title: '   ' }),
      page('   ', {}),
      // Duplicate normalized URL exercises deterministic first-row retention.
      page('https://example.com/title', { title: 'Ignored duplicate title' }),
    ];
    const gsc = new Map<string, readonly string[]>([
      [source.url, ['same query', '   ']],
      ...targets.map((target) => [target.url, ['same query', '   ']] as const),
    ]);
    const result = generate([source, ...targets], gsc);
    const anchor = (url: string) =>
      result.find((candidate) => candidate.targetUrl === url)?.anchorText;
    expect([...(anchor(targets[0]!.url) ?? '')]).toHaveLength(120);
    expect(anchor(targets[1]!.url)).toBe('Target title');
    expect(anchor(targets[2]!.url)).toBe('path name');
    expect(anchor(targets[3]!.url)).toBe('example.com');
    expect(anchor(targets[4]!.url)).toBe('not-a-url');
    expect(anchor(targets[5]!.url)).toBe('blank title');
    expect(anchor(targets[6]!.url)).toBe('/');
    const duplicateTargetCandidates = result.filter(
      (candidate) => candidate.targetUrl === targets[7]!.url,
    );
    expect(duplicateTargetCandidates.length).toBeGreaterThan(0);
    expect(
      duplicateTargetCandidates.every((candidate) => candidate.anchorText === 'Target title'),
    ).toBe(true);
  });
});
