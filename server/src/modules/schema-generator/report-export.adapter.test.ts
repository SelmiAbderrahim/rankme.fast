import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({ generation: vi.fn() }));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./schema-generator.service.js', () => ({ getGeneration: mocked.generation }));

import { createSchemaGenerationReportExportAdapter } from './report-export.adapter.js';

const accountId = 'schema-export-account';
const actorUserId = 'schema-export-user';
const siteId = '507f1f77bcf86cd799439011';
const generationId = '507f1f77bcf86cd799439012';
const generatedAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function generation(input: Record<string, unknown> = {}) {
  return {
    id: generationId, siteId, pageUrl: 'https://example.test/article',
    source: 'url', schemaType: 'Article', registryVersion: 'v1', status: 'succeeded',
    conformanceStatus: 'valid', failureReason: null, generatedAt,
    conformance: { errors: [], warnings: [] },
    evidence: [
      { property: 'headline', value: 'Example article', source: 'title' },
      { property: 'headline', value: 'Example article', source: 'h1' },
      { property: 'author', value: 'Editor', source: 'byline' },
    ],
    omissions: [
      { property: 'author', reason: 'unverified' },
      { property: 'datePublished', reason: 'missing' },
    ],
    payload: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Article', headline: 'Example article' }),
    ...input,
  };
}

function access(scope: 'site_resource' | 'site' = 'site_resource') {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: scope === 'site_resource'
      ? { scope: 'site_resource' as const, siteId, resourceId: generationId }
      : { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(format: 'json' | 'jsonld' = 'json') {
  return { ...access(), selection: {}, format, branding };
}

beforeEach(() => {
  mocked.generation.mockReset().mockResolvedValue(generation());
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Schema Site',
    paused: false, pausedAt: null, createdAt: generatedAt, updatedAt: generatedAt,
  });
});

describe('schema generation report export adapter', () => {
  it('validates empty selection and enforces resource/site ownership', async () => {
    const adapter = createSchemaGenerationReportExportAdapter();
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ extra: true }).success).toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access('site'))).rejects.toMatchObject({ status: 404 });
    mocked.generation.mockResolvedValueOnce(generation({ siteId: 'foreign-site' }));
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });
  });

  it('groups repeated evidence, preserves omissions, and renders JSON plus canonical JSON-LD', async () => {
    const adapter = createSchemaGenerationReportExportAdapter();
    const result = await adapter.compose(compose());
    expect(result.document.subject[0]?.value).toBe('Schema Site');
    expect(result.document.completeness.selectedItems).toBe(3);
    expect(result.document.artifacts[0]).toMatchObject({
      format: 'jsonld', label: `${generationId}.jsonld`,
    });
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: generatedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('supports a payload-free failed generation and the site-domain fallback', async () => {
    mocked.generation.mockResolvedValue(generation({
      status: 'failed', conformanceStatus: 'invalid', payload: null,
      evidence: [], omissions: [],
    }));
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: generatedAt, updatedAt: generatedAt,
    });
    const adapter = createSchemaGenerationReportExportAdapter();
    const result = await adapter.compose(compose());
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.artifacts).toEqual([]);
  });
});
