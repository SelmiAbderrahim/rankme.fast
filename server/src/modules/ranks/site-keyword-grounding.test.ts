import { describe, expect, it } from 'vitest';
import type {
  ContentDocument,
  SiteKeywordCandidate,
} from '../../shared/providers/index.js';
import {
  extractSiteKeywordEvidence,
  groundSiteKeywordCandidates,
  SITE_KEYWORD_SEED_LIMIT,
  SITE_KEYWORD_SEED_MAX_CHARACTERS,
} from './site-keyword-grounding.js';

function document(overrides: Partial<ContentDocument> = {}): ContentDocument {
  return {
    sourceUrl: 'https://example.com/',
    statusCode: 200,
    title: 'Episode Brief Generator',
    description: 'Turn podcast episodes into concise summaries and useful show notes for every listener',
    canonical: 'https://example.com/',
    robots: ['index'],
    language: 'en',
    markdown: '',
    text: '',
    headings: [
      { level: 1, text: 'Podcast Summary Generator' },
      { level: 2, text: 'Episode Show Notes' },
      { level: 3, text: 'Navigation Account Links' },
    ],
    links: [],
    structuredData: [],
    contentHash: 'hash',
    capturedAt: new Date('2026-08-20T00:00:00.000Z'),
    ...overrides,
  };
}

function candidate(
  keyword: string,
  searchVolume: number | null,
  difficulty: number | null = 30,
): SiteKeywordCandidate {
  return {
    keyword,
    searchVolume,
    difficulty,
    currentPosition: null,
    estimatedTraffic: null,
    rankingUrl: null,
  };
}

describe('site keyword evidence extraction', () => {
  it('prioritizes normalized metadata, then bounded title/description/H1/H2 phrases', () => {
    const evidence = extractSiteKeywordEvidence([
      document({
        metadataKeywords: [
          'Podcast Summaries',
          ' podcast summaries ',
          'podcast',
          'create account',
          '---',
          'abcdefghijk abcdefghijk abcdefghijk abcdefghijk abcdefghijk abcdefghijk abcdefghijk abcdefghijk abcdefghijk',
        ],
      }),
      document({
        sourceUrl: 'https://example.com/empty',
        metadataKeywords: undefined,
        title: null,
        description: null,
        headings: [],
      }),
    ]);

    expect(evidence.seeds[0]).toBe('podcast summaries');
    expect(evidence.seeds).toContain('episode brief generator');
    expect(evidence.seeds).toContain('podcast summary generator');
    expect(evidence.seeds.join(' ')).not.toContain('navigation account links');
    expect(evidence.seeds.every((seed) => seed.length <= SITE_KEYWORD_SEED_MAX_CHARACTERS)).toBe(true);
    expect(evidence.metadataTokens).toEqual(expect.arrayContaining(['podcast', 'summaries']));
    expect(evidence.descriptiveTokens).toEqual(
      expect.arrayContaining(['episode', 'brief', 'generator', 'summary', 'notes']),
    );
  });

  it('caps metadata-first seeds without appending descriptive phrases', () => {
    const metadataKeywords = Array.from(
      { length: SITE_KEYWORD_SEED_LIMIT + 1 },
      (_, index) => `topic phrase ${index}`,
    );
    const evidence = extractSiteKeywordEvidence([document({ metadataKeywords })]);
    expect(evidence.seeds).toHaveLength(SITE_KEYWORD_SEED_LIMIT);
    expect(evidence.seeds[0]).toBe('topic phrase 0');
    expect(evidence.seeds).not.toContain('episode brief generator');
  });
});

describe('site keyword candidate grounding', () => {
  const evidence = {
    seeds: ['podcast summary generator'],
    metadataTokens: ['podcast'],
    descriptiveTokens: ['episode', 'summary', 'generator'],
  };

  it('keeps grounded positive-volume ideas, scores them, normalizes them, and dedupes', () => {
    const grounded = groundSiteKeywordCandidates([
      candidate(' Episode Summaries Generator ', 900),
      candidate('Podcast tool', 500),
      candidate('PODCAST TOOL', 700),
      candidate('episode login', 20),
      candidate('create your account', 49_500),
      candidate('google sign in', 201_000),
      candidate('outlook sign in', 450_000),
      candidate('episode summary', 0),
      candidate('podcast transcript', null),
      candidate('', 100),
      candidate('x'.repeat(SITE_KEYWORD_SEED_MAX_CHARACTERS + 1), 100),
    ], evidence, 2);

    expect(grounded).toEqual([
      candidate('podcast tool', 700),
      candidate('episode summaries generator', 900),
    ]);
  });

  it('fails closed for insufficient evidence and non-positive limits', () => {
    expect(groundSiteKeywordCandidates([candidate('episode login', 20)], evidence, 10)).toEqual([]);
    expect(groundSiteKeywordCandidates([candidate('podcast tool', 500)], evidence, 0)).toEqual([]);
  });

  it('handles short and repeated tokens and sorts exact ties deterministically', () => {
    expect(groundSiteKeywordCandidates(
      [candidate('seo', 100)],
      { seeds: [], metadataTokens: ['podcast'], descriptiveTokens: [] },
      10,
    )).toEqual([]);
    expect(groundSiteKeywordCandidates(
      [candidate('podcast', 100)],
      { seeds: [], metadataTokens: ['seo'], descriptiveTokens: [] },
      10,
    )).toEqual([]);
    expect(groundSiteKeywordCandidates([
      candidate('podcast podcast', 600),
      candidate('podcast beta', 500),
      candidate('podcast alpha', 500),
    ], evidence, 10).map((row) => row.keyword)).toEqual([
      'podcast podcast',
      'podcast alpha',
      'podcast beta',
    ]);
  });
});
