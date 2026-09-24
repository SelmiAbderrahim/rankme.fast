import { describe, expect, it } from 'vitest';
import type { ContentDocument, StructuredDataFact } from '../../shared/providers/content-source.js';
import {
  boundedPlainText,
  buildBriefScoringEvidence,
  compareDraftToCorpus,
  computeCorpusStats,
  countWords,
  entityLabelsForDocument,
  filterBriefScoringOutput,
  toStoredBriefDocument,
  type ContentBriefCorpusStats,
  type StoredBriefDocument,
} from './content-brief.core.js';

function sourceDocument(overrides: Partial<ContentDocument> = {}): ContentDocument {
  return {
    sourceUrl: 'https://example.test/guide',
    statusCode: 200,
    title: ' Guide title ',
    description: null,
    canonical: null,
    robots: [],
    language: 'en',
    markdown: '# Markdown fallback words',
    text: 'Alpha beta ٣',
    headings: [{ level: 2, text: ' Evidence heading ' }],
    links: [],
    structuredData: [
      { type: 'Article', property: 'headline', value: 'Guide title' },
      { type: 'Article', property: 'ignored', value: 'Never entity' },
    ],
    contentHash: 'hash',
    capturedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function stored(overrides: Partial<StoredBriefDocument> = {}): StoredBriefDocument {
  return {
    id: 'doc-1',
    sourceUrl: 'https://example.test/guide',
    title: 'Guide',
    excerpt: 'alpha beta',
    headings: [{ level: 1, text: 'Guide' }, { level: 2, text: 'Details' }],
    capturedAt: new Date('2026-07-01T00:00:00Z'),
    wordCount: 100,
    entityLabels: ['Article', 'Acme'],
    ...overrides,
  };
}

describe('content-brief deterministic core', () => {
  it('bounds inert text and counts Unicode words', () => {
    expect(boundedPlainText(null, 10)).toBe('');
    expect(boundedPlainText('  a\u0000\n b  ', 3)).toBe('a b');
    expect(countWords('Hello, 世界 ٣')).toBe(3);
    expect(countWords('---')).toBe(0);
  });

  it('extracts only structured-data labels, dedupes, sorts, and clamps them', () => {
    const facts: StructuredDataFact[] = [
      { type: 'Article', property: 'headline', value: 'Alpha' },
      { type: 'article', property: 'name', value: 'alpha' },
      { type: 'Thing', property: 'ignored', value: 'Nope' },
      { type: 'Numbered', property: 'name', value: 7 },
      ...Array.from({ length: 60 }, (_, index) => ({
        type: `Type ${index}`,
        property: 'name',
        value: `Name ${index}`,
      } satisfies StructuredDataFact)),
    ];
    const labels = entityLabelsForDocument(facts);
    expect(labels).toHaveLength(50);
    expect(labels).toContain('Alpha');
    expect(labels).not.toContain('Nope');
  });

  it('projects a bounded provider document and falls back to markdown', () => {
    const projected = toStoredBriefDocument(sourceDocument(), 1);
    expect(projected).toMatchObject({ id: 'doc-2', title: 'Guide title', wordCount: 3 });
    expect(projected.excerpt).toBe('Alpha beta ٣');
    expect(projected.entityLabels).toContain('Article');

    const fallback = toStoredBriefDocument(
      sourceDocument({
        sourceUrl: `https://example.test/${'x'.repeat(2_100)}`,
        title: null,
        text: '',
        markdown: '# one two',
        headings: Array.from({ length: 102 }, (_, index) => ({
          level: (index === 0 ? 0 : index === 1 ? 9 : 2) as 1,
          text: 'h'.repeat(400),
        })),
      }),
      0,
    );
    expect(fallback.sourceUrl).toHaveLength(2_048);
    expect(fallback.title).toBe('');
    expect(fallback.wordCount).toBe(2);
    expect(fallback.headings).toHaveLength(100);
    expect(fallback.headings[0]?.level).toBe(1);
    expect(fallback.headings[1]?.level).toBe(6);
    expect(fallback.headings[2]?.text).toHaveLength(300);
  });

  it('computes empty and populated corpus statistics deterministically', () => {
    expect(computeCorpusStats([])).toEqual({
      wordCount: { min: null, max: null, average: null, documentCount: 0 },
      headingHistogram: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      entities: [],
      scrapeDates: [],
    });
    const stats = computeCorpusStats([
      stored(),
      stored({
        id: 'doc-2',
        wordCount: 201,
        headings: [{ level: 3, text: 'Third' }],
        entityLabels: ['article', 'Beta'],
        capturedAt: new Date('2026-07-02T00:00:00Z'),
      }),
    ]);
    expect(stats.wordCount).toEqual({ min: 100, max: 201, average: 151, documentCount: 2 });
    expect(stats.headingHistogram).toEqual({ h1: 1, h2: 1, h3: 1, h4: 0, h5: 0, h6: 0 });
    expect(stats.entities[0]).toEqual({ label: 'Article', documentCount: 2 });
    expect(stats.scrapeDates).toHaveLength(2);
  });

  it('compares drafts as guidance across populated and absent corpus branches', () => {
    const empty = computeCorpusStats([]);
    expect(compareDraftToCorpus('', empty)).toEqual({
      wordCount: 0,
      corpusMin: null,
      corpusMax: null,
      corpusAverage: null,
      wordDeltaFromAverage: null,
      headingCount: 0,
      corpusAverageHeadings: null,
      matchedEntities: 0,
      totalEntities: 0,
      deterministicScore: 0,
    });
    const zeroHeadingStats: ContentBriefCorpusStats = {
      wordCount: { min: 0, max: 0, average: 0, documentCount: 1 },
      headingHistogram: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      entities: [],
      scrapeDates: [],
    };
    expect(compareDraftToCorpus('', zeroHeadingStats).deterministicScore).toBe(70);
    expect(compareDraftToCorpus('# Heading\nword', zeroHeadingStats).deterministicScore).toBe(0);

    const stats = computeCorpusStats([stored({ wordCount: 4 })]);
    expect(compareDraftToCorpus('# Guide\nalpha beta Acme Article', stats)).toMatchObject({
      wordCount: 5,
      headingCount: 1,
      corpusAverageHeadings: 2,
      matchedEntities: 2,
      totalEntities: 2,
    });
    expect(compareDraftToCorpus('one', stats).deterministicScore).toBeLessThan(40);
    expect(compareDraftToCorpus('one two three four five six seven eight', stats).deterministicScore)
      .toBeLessThan(40);
  });

  it('builds a bounded evidence envelope with and without a draft', () => {
    const stats = computeCorpusStats([stored()]);
    const base = buildBriefScoringEvidence({
      mode: 'brief',
      keyword: 'guide',
      documents: [stored()],
      stats,
      paaRows: [{ id: 'paa-1', question: 'Why?', answerDomain: null, answerUrl: null }],
      secondaryTerms: [{ id: 'term-1', term: 'secondary' }],
    });
    expect(base).not.toHaveProperty('draft');
    expect(base.corpusRows).toHaveLength(9);
    expect(base.documents[0]?.headings).toEqual(['1:Guide', '2:Details']);
    expect(
      buildBriefScoringEvidence({
        mode: 'rescore', keyword: 'guide', documents: [], stats, paaRows: [],
        secondaryTerms: [], draft: 'draft',
      }),
    ).toHaveProperty('draft', 'draft');
  });

  it('drops every foreign, uncited, duplicate, or wrong-mode AI sentence', () => {
    const evidence = buildBriefScoringEvidence({
      mode: 'brief', keyword: 'guide', documents: [stored()],
      stats: computeCorpusStats([stored()]),
      paaRows: [{ id: 'paa-1', question: 'Why?', answerDomain: null, answerUrl: null }],
      secondaryTerms: [{ id: 'term-1', term: 'secondary' }],
    });
    const filtered = filterBriefScoringOutput({
      outline: [
        { id: 'ok', heading: 'Good', purpose: 'Grounded', citations: ['doc-1'] },
        { id: 'ok', heading: 'Duplicate', purpose: 'No', citations: ['stat-word-min'] },
        { id: 'paa-only', heading: 'No', purpose: 'No', citations: ['paa-1'] },
        { id: 'foreign', heading: 'No', purpose: 'No', citations: ['foreign'] },
        { id: 'mixed', heading: 'Mixed', purpose: 'Kept', citations: ['term-1', 'foreign'] },
      ],
      questions: [
        { question: 'Good?', citations: ['paa-1'] },
        { question: 'Mixed but retained?', citations: ['paa-1', 'foreign'] },
        { question: 'No?', citations: ['doc-1'] },
        { question: 'Foreign?', citations: ['foreign'] },
      ],
      score: 90,
      rationale: 'ignored in brief mode',
      citations: ['doc-1', 'foreign', 'doc-1'],
    }, evidence);
    expect(filtered.rejected).toBe(true);
    expect(filtered.output.outline.map((row) => row.id)).toEqual(['ok', 'mixed']);
    expect(filtered.output.questions).toEqual([
      { question: 'Good?', citations: ['paa-1'] },
      { question: 'Mixed but retained?', citations: ['paa-1'] },
    ]);
    expect(filtered.output.score).toBeNull();
    expect(filtered.output.citations).toEqual(['doc-1']);

    const rescore = filterBriefScoringOutput(
      {
        outline: [{ id: 'x', heading: 'Injected', purpose: 'No', citations: ['doc-1'] }],
        questions: [{ question: 'Injected?', citations: ['paa-1'] }],
        score: 55,
        rationale: 'Guidance only',
        citations: ['doc-1'],
      },
      { ...evidence, mode: 'rescore', draft: 'draft' },
    );
    expect(rescore.output).toMatchObject({ outline: [], questions: [], score: 55 });
    expect(rescore.rejected).toBe(true);
  });
});
