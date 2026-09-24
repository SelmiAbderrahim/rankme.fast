import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import {
  INVENTORY_SCHEMA_VERSION,
  INVENTORY_THRESHOLDS,
  THRESHOLDS_VERSION,
  inventoryFindingsSchema,
  inventoryPageFactsSchema,
  listInventoryQuerySchema,
  runIdParamsSchema,
  siteIdParamsSchema,
  startInventoryBodySchema,
} from './inventory.schemas.js';

const validBody = {
  pageLimit: 20,
  allowedPaths: ['/blog', '/guides/*'],
  excludedPaths: ['/admin'],
  sitemapSeeds: ['https://example.com/sitemap.xml'],
  locale: 'en',
};

describe('inventory request schemas (SEC-BOUND ceilings)', () => {
  it('accepts a valid body and applies array defaults', () => {
    const parsed = startInventoryBodySchema.parse({ pageLimit: 8, locale: 'fr' });
    expect(parsed.allowedPaths).toEqual([]);
    expect(parsed.excludedPaths).toEqual([]);
    expect(parsed.sitemapSeeds).toEqual([]);
    expect(parsed.pageLimit).toBe(8);
  });

  it('coerces a numeric string page limit', () => {
    const parsed = startInventoryBodySchema.parse({ ...validBody, pageLimit: '15' });
    expect(parsed.pageLimit).toBe(15);
  });

  it('rejects a page limit above the operator ceiling', () => {
    expect(() =>
      startInventoryBodySchema.parse({
        ...validBody,
        pageLimit: env.CONTENT_INVENTORY_MAX_PAGES + 1,
      }),
    ).toThrow();
  });

  it('rejects a page limit below 1', () => {
    expect(() => startInventoryBodySchema.parse({ ...validBody, pageLimit: 0 })).toThrow();
  });

  it('rejects more than 20 allowed paths', () => {
    const allowedPaths = Array.from({ length: 21 }, (_, i) => `/p${i}`);
    expect(() =>
      startInventoryBodySchema.parse({ ...validBody, allowedPaths }),
    ).toThrow();
  });

  it('rejects a path that is not an absolute prefix', () => {
    expect(() =>
      startInventoryBodySchema.parse({ ...validBody, allowedPaths: ['blog'] }),
    ).toThrow();
  });

  it('rejects more than 5 sitemap seeds', () => {
    const sitemapSeeds = Array.from({ length: 6 }, (_, i) => `https://example.com/s${i}.xml`);
    expect(() =>
      startInventoryBodySchema.parse({ ...validBody, sitemapSeeds }),
    ).toThrow();
  });

  it('rejects an unknown locale + unknown extra key (strict)', () => {
    expect(() =>
      startInventoryBodySchema.parse({ ...validBody, locale: 'xx' }),
    ).toThrow();
    expect(() =>
      startInventoryBodySchema.parse({ ...validBody, bogus: true }),
    ).toThrow();
  });

  it('parses params + list query with defaults', () => {
    expect(siteIdParamsSchema.parse({ siteId: 'abc' }).siteId).toBe('abc');
    expect(runIdParamsSchema.parse({ runId: 'r1' }).runId).toBe('r1');
    expect(listInventoryQuerySchema.parse({}).limit).toBe(20);
    expect(listInventoryQuerySchema.parse({ limit: '5' }).limit).toBe(5);
  });
});

describe('inventory result schemas', () => {
  it('validates a page-facts shape', () => {
    const facts = inventoryPageFactsSchema.parse({
      url: 'https://example.com/a',
      canonical: 'https://example.com/a',
      statusCode: 200,
      robots: ['index', 'follow'],
      language: 'en',
      title: 'Title',
      description: 'Desc',
      headings: ['H1'],
      wordCount: 500,
      schemaTypes: ['Article'],
      hasSchemaOrgArticle: true,
      internalLinkCount: 3,
      externalLinkCount: 1,
      internalOutLinks: ['https://example.com/b'],
      contentHash: 'abc',
      primaryTopics: ['seo'],
      secondaryTopics: [],
      targetQueries: ['seo audit'],
      qualityFlags: ['thin'],
    });
    expect(facts.url).toBe('https://example.com/a');
  });

  it('validates a findings envelope with versions', () => {
    const findings = inventoryFindingsSchema.parse({
      version: INVENTORY_SCHEMA_VERSION,
      thresholdsVersion: THRESHOLDS_VERSION,
      clusters: [],
      duplicates: [],
      thinPages: [],
      orphanPages: [],
      cannibalization: [],
      gaps: [],
      opportunityExplanation: null,
    });
    expect(findings.version).toBe(INVENTORY_SCHEMA_VERSION);
  });

  it('pins the versioned thresholds constant', () => {
    expect(INVENTORY_THRESHOLDS.version).toBe(THRESHOLDS_VERSION);
    expect(INVENTORY_THRESHOLDS.clusterJaccard).toBeGreaterThan(0);
    expect(INVENTORY_THRESHOLDS.nearDuplicateJaccard).toBeGreaterThan(
      INVENTORY_THRESHOLDS.clusterJaccard,
    );
  });
});
