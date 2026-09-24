import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIENCE_RESEARCH_CONFIDENCE,
  AUDIENCE_RESEARCH_LEDGER_OUTCOMES,
  AUDIENCE_RESEARCH_LEDGER_STAGES,
  AUDIENCE_RESEARCH_SIGNAL_TYPES,
  AUDIENCE_RESEARCH_SOURCE_TYPES,
  AUDIENCE_RESEARCH_SUGGESTED_ROUTES,
  AUDIENCE_RESEARCH_TERMINAL_REASON_CODES,
  AudienceResearchRun,
  isTerminalState,
} from './audience-research.model.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { buildObservationMeta } from '../../shared/observations/observations.js';

const META = buildObservationMeta({
  sourceKind: 'provider_observation',
  sourceLabel: 'dataforseo',
  observedAt: new Date('2026-07-19T00:00:00Z'),
});

function baseRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    accountId: new mongoose.Types.ObjectId(),
    siteId: new mongoose.Types.ObjectId(),
    state: 'queued' as const,
    deterministicInputHash: 'a'.repeat(64),
    input: {
      siteMarket: {
        country: 'US',
        region: null,
        city: null,
        language: 'en',
        device: 'all' as const,
      },
      competitorDomains: [],
      seedTopics: ['pricing'],
      queryTemplateVersion: 1,
    },
    ...overrides,
  };
}

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

describe('AudienceResearchRun model', () => {
  it('locks the enum shapes', () => {
    expect(AUDIENCE_RESEARCH_SIGNAL_TYPES).toEqual([
      'complaint',
      'request',
      'question',
      'competitor_gap',
    ]);
    expect(AUDIENCE_RESEARCH_SUGGESTED_ROUTES).toEqual([
      'content',
      'comparison_page',
      'product',
      'seo',
    ]);
    expect(AUDIENCE_RESEARCH_CONFIDENCE).toEqual(['high', 'medium', 'low']);
    expect(AUDIENCE_RESEARCH_SOURCE_TYPES).toEqual([
      'forum',
      'review',
      'comparison',
      'question',
      'other',
    ]);
    expect(AUDIENCE_RESEARCH_LEDGER_STAGES).toEqual(['discovery', 'collect', 'cluster']);
    expect(AUDIENCE_RESEARCH_LEDGER_OUTCOMES).toEqual([
      'ok',
      'ceiling_stop',
      'provider_error',
      'unavailable',
    ]);
    expect(AUDIENCE_RESEARCH_TERMINAL_REASON_CODES).toContain('no_usable_public_evidence');
  });

  it('round-trips a minimal run', async () => {
    const created = await AudienceResearchRun.create(baseRun());
    const found = await AudienceResearchRun.findById(created._id).lean();
    expect(found?.state).toBe('queued');
    expect(found?.input.seedTopics).toEqual(['pricing']);
  });

  it('enforces (accountId, deterministicInputHash) unique index', async () => {
    await AudienceResearchRun.syncIndexes();
    const first = baseRun();
    await AudienceResearchRun.create(first);
    await expect(
      AudienceResearchRun.create({ ...first, siteId: new mongoose.Types.ObjectId() }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('exposes the required compound indexes', async () => {
    await AudienceResearchRun.syncIndexes();
    const indexes = await AudienceResearchRun.collection.indexes();
    const keys = indexes.map((i) => JSON.stringify(i.key));
    expect(keys.some((k) => k.includes('"accountId":1') && k.includes('"createdAt":-1'))).toBe(true);
    expect(keys.some((k) => k.includes('"state":1'))).toBe(true);
    expect(keys.some((k) => k.includes('"deterministicInputHash":1'))).toBe(true);
  });

  it('rejects raw HTML markers in bounded text fields (pre-validate hook)', async () => {
    const run = baseRun();
    await expect(
      AudienceResearchRun.create({
        ...run,
        sources: [
          {
            sourceId: '1',
            canonicalUrl: 'https://a.com/x',
            title: '<script>alert(1)</script>',
            sourceType: 'forum',
            registrableDomain: 'a.com',
            observedAt: null,
            contentHash: 'h1',
            excerpt: 'safe',
            observationMeta: META,
            discoveryQueryIds: ['q-1'],
          },
        ],
      }),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('rejects raw HTML markers in signal summary', async () => {
    const run = baseRun();
    await expect(
      AudienceResearchRun.create({
        ...run,
        signals: [
          {
            signalId: '1',
            type: 'complaint',
            title: 'ok',
            summary: '<iframe src=x></iframe>',
            suggestedRoute: 'content',
            citedSourceIds: ['1'],
            independentDomainCount: 1,
            sourceTypeCount: 1,
            mostRecentSourceObservedAt: null,
            confidence: 'low',
          },
        ],
      }),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('rejects raw HTML markers in candidate title', async () => {
    const run = baseRun();
    await expect(
      AudienceResearchRun.create({
        ...run,
        candidates: [
          {
            canonicalUrl: 'https://a.com/x',
            title: '<!doctype html>',
            sourceType: 'other',
            registrableDomain: 'a.com',
            observedAt: null,
            organicPosition: 1,
            discoveryQueryIds: ['q-1'],
          },
        ],
      }),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('isTerminalState mirrors state list', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('partial')).toBe(true);
    expect(isTerminalState('failed')).toBe(true);
    expect(isTerminalState('queued')).toBe(false);
  });
});
