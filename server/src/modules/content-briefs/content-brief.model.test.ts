import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_BRIEF_MAX_DOCUMENTS,
  CONTENT_BRIEF_MAX_DRAFT_VERSIONS,
  ContentBrief,
} from './content-brief.model.js';

const base = () => ({
  accountId: new mongoose.Types.ObjectId(),
  siteId: new mongoose.Types.ObjectId(),
  keywordId: 'keyword-id',
  keyword: 'evidence led seo',
  locale: 'en',
  reservationKey: `key-${new mongoose.Types.ObjectId()}`,
  runCeilingMicros: 120_000,
});

describe('ContentBrief model', () => {
  it('applies bounded aggregate defaults, including nested evidence defaults', () => {
    const brief = new ContentBrief({
      ...base(),
      documents: [
        {
          id: 'doc-1',
          sourceUrl: 'https://example.test',
          title: 'Title',
          excerpt: '',
          capturedAt: new Date(),
          wordCount: 0,
        },
      ],
      corpusStats: {
        wordCount: { documentCount: 0 },
        headingHistogram: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
      },
      outline: [{ id: 'node-1', heading: 'Heading', purpose: 'Purpose' }],
      questions: [{ question: 'Question?' }],
      draftVersions: [
        {
          version: 1,
          draft: 'Draft',
          comparison: {
            wordCount: 1,
            headingCount: 0,
            matchedEntities: 0,
            totalEntities: 0,
            deterministicScore: 0,
          },
          aiDisclosure: 'cost_ceiling',
          createdAt: new Date(),
        },
      ],
    });
    expect(brief.validateSync()).toBeUndefined();
    expect(brief).toMatchObject({
      status: 'queued',
      totalCostMicros: 0,
      editorAiCostMicros: 0,
      editorAiReservedMicros: 0,
      serpSource: 'pending',
      fetchedInsideUnit: false,
      scrapeAttempts: 0,
      successfulScrapeAttempts: 0,
      indeterminateScrapeAttempts: 0,
      providerFailureCount: 0,
      unsafeUrlCount: 0,
      briefAiCompleted: false,
      processorAttempt: -1,
      draftVersionCount: 0,
    });
    expect(brief.documents[0]).toMatchObject({ headings: [], entityLabels: [] });
    expect(brief.corpusStats).toMatchObject({
      wordCount: { min: null, max: null, average: null },
      entities: [],
      scrapeDates: [],
    });
    expect(brief.outline[0]?.citations).toEqual([]);
    expect(brief.questions[0]?.citations).toEqual([]);
    expect(brief.draftVersions[0]).toMatchObject({
      aiScore: null,
      aiRationale: null,
      aiCitations: [],
      aiCostMicros: 0,
    });
  });

  it('rejects overlong evidence and aggregate collections', () => {
    const tooManyHeadings = Array.from({ length: 101 }, () => ({ level: 2, text: 'Heading' }));
    const tooManyEntities = Array.from({ length: 51 }, (_, index) => `Entity ${index}`);
    const document = {
      id: 'doc-1',
      sourceUrl: 'https://example.test',
      title: 'Title',
      excerpt: '',
      headings: tooManyHeadings,
      capturedAt: new Date(),
      wordCount: 1,
      entityLabels: tooManyEntities,
    };
    const aggregate = new ContentBrief({
      ...base(),
      documents: Array.from({ length: CONTENT_BRIEF_MAX_DOCUMENTS + 1 }, (_, index) => ({
        ...document,
        id: `doc-${index}`,
      })),
      serpTopUrls: Array.from(
        { length: CONTENT_BRIEF_MAX_DOCUMENTS + 1 },
        (_, index) => `https://${index}.example.test`,
      ),
      draftVersions: Array.from({ length: CONTENT_BRIEF_MAX_DRAFT_VERSIONS + 1 }, (_, index) => ({
        version: Math.min(index + 1, CONTENT_BRIEF_MAX_DRAFT_VERSIONS),
        draft: 'Draft',
        comparison: {
          wordCount: 1,
          headingCount: 0,
          matchedEntities: 0,
          totalEntities: 0,
          deterministicScore: 0,
        },
        aiDisclosure: 'cost_ceiling',
        createdAt: new Date(),
      })),
    });
    expect(Object.keys(aggregate.validateSync()?.errors ?? {})).toEqual(
      expect.arrayContaining(['documents', 'serpTopUrls', 'draftVersions']),
    );

    const nested = new ContentBrief({ ...base(), documents: [document] });
    expect(Object.keys(nested.validateSync()?.errors ?? {})).toEqual(
      expect.arrayContaining(['documents.0.headings', 'documents.0.entityLabels']),
    );
  });
});
