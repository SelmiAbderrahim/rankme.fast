import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AudienceResearchRun } from './audience-research.model.js';
import { EXCERPT_MAX_LENGTH, buildEvidenceExcerpt } from './excerpt.js';
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

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

describe('audience research persistence privacy', () => {
  it('never persists raw HTML or authenticated content on sources', async () => {
    const excerpt = buildEvidenceExcerpt(
      '<script>evil()</script><p>Users complain about billing.</p>',
    );
    const created = await AudienceResearchRun.create({
      accountId: new mongoose.Types.ObjectId(),
      siteId: new mongoose.Types.ObjectId(),
      state: 'clustering',
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
        seedTopics: ['billing'],
        queryTemplateVersion: 1,
      },
      sources: [
        {
          sourceId: '1',
          canonicalUrl: 'https://example.com/thread',
          title: 'Users complain about billing',
          sourceType: 'forum',
          registrableDomain: 'example.com',
          observedAt: null,
          contentHash: 'h1',
          excerpt,
          observationMeta: META,
          discoveryQueryIds: ['q-1'],
        },
      ],
    });
    const found = await AudienceResearchRun.findById(created._id).lean();
    expect(found?.sources[0]!.excerpt).not.toContain('<script>');
    expect(found?.sources[0]!.excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH);
  });

  it('bounds all excerpts to ≤ 500 chars even for large raw input', () => {
    const raw = 'x'.repeat(5000);
    const out = buildEvidenceExcerpt(raw);
    expect([...out].length).toBeLessThanOrEqual(EXCERPT_MAX_LENGTH);
  });

  it('costLedger persists only safe bounded fields (no URL, no query prose)', async () => {
    const created = await AudienceResearchRun.create({
      accountId: new mongoose.Types.ObjectId(),
      siteId: new mongoose.Types.ObjectId(),
      state: 'collecting',
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
        seedTopics: ['billing'],
        queryTemplateVersion: 1,
      },
      costLedger: [
        {
          stage: 'discovery',
          operationCounts: { serpFetches: 3 },
          estimatedCostMicros: 30_000,
          actualCostMicros: 29_500,
          startedAt: new Date(),
          endedAt: new Date(),
          outcome: 'ok',
        },
      ],
    });
    const found = await AudienceResearchRun.findById(created._id).lean();
    const entry = found?.costLedger[0];
    expect(entry).toBeDefined();
    const asJson = JSON.stringify(entry);
    expect(asJson).not.toContain('http');
    expect(asJson).not.toContain('query');
    const knownKeys = new Set([
      'stage',
      'operationCounts',
      'estimatedCostMicros',
      'actualCostMicros',
      'startedAt',
      'endedAt',
      'outcome',
    ]);
    for (const key of Object.keys(entry!)) {
      expect(knownKeys.has(key)).toBe(true);
    }
  });

  it('aiClustering persists only digest, never the raw output', async () => {
    const created = await AudienceResearchRun.create({
      accountId: new mongoose.Types.ObjectId(),
      siteId: new mongoose.Types.ObjectId(),
      state: 'clustering',
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
        seedTopics: ['billing'],
        queryTemplateVersion: 1,
      },
      aiClustering: {
        profileVersion: 'v1',
        idempotencyKey: 'k1',
        claimedAt: new Date(),
        resolvedAt: new Date(),
        resultDigest: 'sha256:abc',
      },
    });
    const found = await AudienceResearchRun.findById(created._id).lean();
    const knownKeys = new Set([
      'profileVersion',
      'idempotencyKey',
      'claimedAt',
      'resolvedAt',
      'resultDigest',
    ]);
    for (const key of Object.keys(found!.aiClustering!)) {
      expect(knownKeys.has(key)).toBe(true);
    }
  });
});
