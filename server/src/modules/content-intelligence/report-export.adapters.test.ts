import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
} from '../../shared/testing/postgres.js';
import { getSite, type PublicSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({
  analysis: vi.fn(),
  applicationCheck: vi.fn(),
  history: vi.fn(),
  inventory: vi.fn(),
  outcome: vi.fn(),
}));

vi.mock('./content-intelligence.service.js', () => ({ getAnalysis: mocked.analysis }));
vi.mock('./content-recommendation-outcomes.service.js', () => ({
  getStoredRecommendationOutcome: mocked.outcome,
}));
vi.mock('./content-recommendation.service.js', () => ({
  getRecommendationApplicationCheck: mocked.applicationCheck,
  listRecommendationHistory: mocked.history,
}));
vi.mock('./inventory.service.js', () => ({ getInventoryRun: mocked.inventory }));
vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));

import {
  contentIntelligenceReportExportTestables as internals,
  createContentIntelligenceReportExportAdapters,
} from './report-export.adapters.js';

const accountId = 'content-export-account';
const actorUserId = 'content-export-user';
const siteId = '507f1f77bcf86cd799439011';
const analysisId = '507f1f77bcf86cd799439012';
const recommendationId = 'rec-1';
const completedAt = '2026-08-10T12:00:00.000Z';
const requestedAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};
const site: PublicSite = {
  id: siteId,
  url: 'https://example.test',
  domain: 'example.test',
  displayName: 'Example Site',
  paused: false,
  pausedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: completedAt,
};

function database(): ApplicationDb {
  return getTestDb();
}

function analysis(input: Record<string, unknown> = {}) {
  return {
    analysisId,
    siteId,
    ownedUrl: 'https://example.test/article',
    keyword: 'seo audit',
    locale: 'en',
    status: 'succeeded',
    stages: [{ id: 'score', state: 'succeeded' }],
    warnings: [],
    schemaVersion: 2,
    owned: { title: 'Owned page' },
    error: null,
    requestedAt,
    startedAt: requestedAt,
    completedAt,
    cancelledAt: null,
    scorecard: { score: 80 },
    scorecardV2: { score: 82 },
    recommendations: [
      { id: recommendationId, title: 'Improve title' },
      { id: 'rec-2', title: 'Add examples' },
    ],
    recommendationStates: [{
      recommendationId,
      analysisVersion: 2,
      state: 'accepted',
      version: 3,
      stateChangedAt: completedAt,
      appliedAt: null,
      baselineAnchorAt: null,
      contentHash: 'hash-current',
      analysisContentHash: 'hash-analysis',
      hashStatus: 'changed',
    }],
    brief: { title: 'Legacy brief' },
    briefVersions: [{ versionId: 'brief-v1', title: 'Brief', savedAt: completedAt }],
    draft: 'Legacy draft',
    draftVersions: [
      { versionId: 'draft-v1', markdown: '# First', wordCount: 1, savedAt: requestedAt },
      { versionId: 'draft-v2', markdown: '# Latest', wordCount: 1, savedAt: completedAt },
    ],
    citations: [{ url: 'https://source.test', title: 'Source' }],
    ...input,
  };
}

function unavailableOutcome() {
  return {
    available: false,
    reason: 'not-applied',
  };
}

function availableOutcome(input: Record<string, unknown> = {}) {
  return {
    available: true,
    dataAvailable: true,
    aggregationVersion: 'v1',
    appliedAt: completedAt,
    contentHash: 'hash-current',
    hashStatus: 'same',
    window: { days: 28 },
    coverage: { before: 2, after: 2 },
    metrics: { clicks: { before: 10, after: 20 } },
    laterEdit: false,
    series: [
      { source: 'gsc', phase: 'before', observedAt: requestedAt, value: 10 },
      { source: 'gsc', phase: 'after', observedAt: completedAt, value: 20 },
    ],
    ...input,
  };
}

function inventory(input: Record<string, unknown> = {}) {
  return {
    runId: analysisId,
    siteId,
    origin: 'manual',
    locale: 'en',
    status: 'succeeded',
    input: { maxPages: 10 },
    progress: { completed: 2, total: 2 },
    warnings: [],
    error: null,
    thresholdsVersion: 'v1',
    requestedAt,
    startedAt: requestedAt,
    completedAt,
    cancelledAt: null,
    pages: [
      { url: 'https://example.test/a', facts: { words: 100 } },
      { url: 'https://example.test/b', facts: { words: 200 } },
    ],
    findings: {
      clusters: [
        { id: 'cluster-a', label: 'Cluster A', pages: ['/a'] },
        { id: 'cluster-b', label: 'Cluster B', pages: ['/b'] },
      ],
      duplicates: [{ id: 'duplicate-a', kind: 'near', pages: ['/a', '/b'] }],
      thinPages: [{ url: 'https://example.test/a', reason: 'thin' }],
      orphanPages: [{ url: 'https://example.test/b', reason: 'orphan' }],
      cannibalization: [{ id: 'cannibal-a', keyword: 'seo' }],
      gaps: [
        { id: 'gap-a', query: 'seo guide', confidence: 'high' },
        { id: 'gap-b', query: 'seo checklist', confidence: 'medium' },
      ],
      opportunityExplanation: 'Publish a complete guide.',
    },
    ...input,
  };
}

function target(resourceId = analysisId, targetSiteId = siteId) {
  return { scope: 'site_resource' as const, siteId: targetSiteId, resourceId };
}

function access(input: {
  resourceId?: string;
  purpose?: 'create' | 'persist';
  format?: 'pdf' | 'csv' | 'json' | 'md';
  sourceVersion?: string;
} = {}) {
  return {
    accountId,
    actorUserId,
    purpose: input.purpose ?? 'create',
    target: target(input.resourceId),
    format: input.format ?? 'json',
    locale: 'en' as const,
    ...(input.sourceVersion === undefined ? {} : { sourceVersion: input.sourceVersion }),
  };
}

function compose(
  selection: Record<string, string | number | string[] | undefined>,
  input: { resourceId?: string; format?: 'pdf' | 'csv' | 'json' | 'md' } = {},
) {
  return { ...access(input), selection, branding };
}

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);

beforeEach(() => {
  mocked.analysis.mockReset().mockResolvedValue(analysis());
  mocked.applicationCheck.mockReset().mockResolvedValue({ applied: true, checkedAt: completedAt });
  mocked.history.mockReset().mockResolvedValue([
    { id: 'event-1', actorUserId: actorUserId, eventKind: 'accepted', recordedAt: completedAt },
  ]);
  mocked.inventory.mockReset().mockResolvedValue(inventory());
  mocked.outcome.mockReset().mockResolvedValue(unavailableOutcome());
  vi.mocked(getSite).mockReset().mockResolvedValue(site);
});

describe('content intelligence export helpers', () => {
  it('parses selections and rejects malformed outcome identities', () => {
    expect(internals.analysisSelectionSchema.parse({})).toEqual({});
    expect(internals.analysisSelectionSchema.safeParse({ sections: ['unknown'] }).success).toBe(false);
    expect(internals.outcomeSelectionSchema.parse({ window: 28 })).toEqual({ window: 28 });
    expect(internals.inventorySelectionSchema.safeParse({ page: ['not-a-url'] }).success).toBe(false);
    expect(() => internals.outcomeIds('missing')).toThrow();
    expect(() => internals.outcomeIds(':recommendation')).toThrow();
    expect(() => internals.outcomeIds('analysis:')).toThrow();
    expect(internals.outcomeIds(`${analysisId}:${recommendationId}`)).toEqual({ analysisId, recommendationId });
  });

  it('loads outcome context, strips actor identity, and handles absent recommendation state', async () => {
    const loaded = await internals.outcomeBase(database(), {
      accountId, target: target(`${analysisId}:${recommendationId}`), locale: 'en',
    });
    expect(loaded).toMatchObject({
      recommendation: { id: recommendationId },
      decisionState: { recommendationId, state: 'accepted' },
      history: [{ id: 'event-1', eventKind: 'accepted' }],
    });
    expect(loaded.history[0]).not.toHaveProperty('actorUserId');

    mocked.analysis.mockResolvedValueOnce(analysis({ recommendations: [], recommendationStates: [] }));
    await expect(internals.outcomeBase(database(), {
      accountId, target: target(`${analysisId}:missing`), locale: 'en',
    })).resolves.toMatchObject({ recommendation: null, decisionState: null });
  });

  it('enforces inventory site binding', async () => {
    mocked.inventory.mockResolvedValueOnce(inventory({ siteId: 'foreign-site' }));
    await expect(internals.inventoryBase({ accountId, target: target(), locale: 'en' }))
      .rejects.toMatchObject({ status: 404 });
    await expect(internals.inventoryBase({ accountId, target: target(), locale: 'en' }))
      .resolves.toMatchObject({ runId: analysisId });
    expect(getSite).toHaveBeenCalledWith(accountId, siteId);
  });
});

describe('content analysis export adapter', () => {
  it('loads every section, joins recommendation decisions, selects the latest draft, and renders Markdown', async () => {
    const [adapter] = createContentIntelligenceReportExportAdapters(database());
    if (!adapter) throw new Error('analysis adapter missing');
    const result = await adapter.compose(compose({}, { format: 'md' }));
    expect(result.document.completeness.selectedItems).toBe(7);
    expect(result.document.subject[0]?.value).toBe(site.displayName);
    expect(result.document.artifacts[0]).toMatchObject({ format: 'md', label: `${analysisId}.md` });
    expect(result.document.blocks[0]).toMatchObject({ type: 'table' });
    await expect(adapter.render({
      document: result.document, format: 'md', snapshotCreatedAt: completedAt,
    })).resolves.toMatchObject({ format: 'md' });
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ purpose: 'persist', sourceVersion: 'stale' })))
      .rejects.toMatchObject({ status: 409 });
  });

  it('supports explicit draft versions, legacy brief/draft fallbacks, filters sections, and fails unknown drafts', async () => {
    const [adapter] = createContentIntelligenceReportExportAdapters(database());
    if (!adapter) throw new Error('analysis adapter missing');
    const selected = await adapter.compose(compose({
      sections: ['draft'], draftVersion: 'draft-v1',
    }, { format: 'md' }));
    expect(selected.document.artifacts[0]?.label).toBe(`${analysisId}.md`);

    mocked.analysis.mockResolvedValueOnce(analysis({
      briefVersions: [],
      draftVersions: [],
      brief: { title: 'Legacy brief' },
      draft: 'Legacy markdown',
      completedAt: null,
    }));
    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    const legacy = await adapter.compose(compose({ sections: ['brief', 'draft'] }, { format: 'md' }));
    expect(legacy.document.subject[0]?.value).toBe(site.domain);
    expect(legacy.document.artifacts[0]).toMatchObject({ format: 'md' });

    mocked.analysis.mockResolvedValueOnce(analysis({ draftVersions: [], draft: { structured: true } }));
    await expect(adapter.compose(compose({ sections: ['scorecard'] }, { format: 'md' })))
      .rejects.toMatchObject({ status: 409 });

    mocked.analysis.mockResolvedValueOnce(analysis());
    await expect(adapter.compose(compose({ sections: ['draft'], draftVersion: 'missing' }, { format: 'md' })))
      .rejects.toMatchObject({ status: 404 });
  });

  it('handles empty brief/draft/citation inputs and epoch observation fallback', async () => {
    mocked.analysis.mockResolvedValueOnce(analysis({
      completedAt: null,
      requestedAt: null,
      brief: null,
      briefVersions: [],
      draft: null,
      draftVersions: [],
      citations: [],
      recommendations: [],
      recommendationStates: [],
    }));
    const [adapter] = createContentIntelligenceReportExportAdapters(database());
    if (!adapter) throw new Error('analysis adapter missing');
    const result = await adapter.compose(compose({
      sections: ['recommendations', 'brief', 'draft', 'citations'],
    }));
    expect(result.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());
    expect(result.document.artifacts).toEqual([]);
  });
});

describe('recommendation outcome export adapter', () => {
  it('exports unavailable evidence with the decision-state fallback', async () => {
    const [, adapter] = createContentIntelligenceReportExportAdapters(database());
    if (!adapter) throw new Error('outcome adapter missing');
    const result = await adapter.compose(compose({}, { resourceId: `${analysisId}:${recommendationId}` }));
    expect(result.document.completeness.selectedItems).toBe(0);
    expect(result.document.subject[0]?.value).toBe(site.displayName);
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: completedAt }))
        .resolves.toMatchObject({ format });
    }
    await expect(adapter.assertAccess(access({ resourceId: `${analysisId}:${recommendationId}` })))
      .resolves.toBeUndefined();

    mocked.analysis.mockResolvedValueOnce(analysis({ recommendations: [], recommendationStates: [] }));
    await expect(adapter.compose(compose({}, { resourceId: `${analysisId}:missing` })))
      .resolves.toMatchObject({ document: { completeness: { selectedItems: 0 } } });
  });

  it('exports available outcome series, both availability states, and date fallbacks', async () => {
    const [, adapter] = createContentIntelligenceReportExportAdapters(database());
    if (!adapter) throw new Error('outcome adapter missing');
    mocked.outcome.mockResolvedValueOnce(availableOutcome());
    let result = await adapter.compose(compose({ window: 28 }, {
      resourceId: `${analysisId}:${recommendationId}`,
    }));
    expect(result.document.completeness.selectedItems).toBe(2);

    mocked.outcome.mockResolvedValueOnce(availableOutcome({ dataAvailable: false, series: [] }));
    result = await adapter.compose(compose({ version: 'v1' }, {
      resourceId: `${analysisId}:${recommendationId}`,
    }));
    expect(result.document.completeness.selectedItems).toBe(0);

    mocked.outcome.mockResolvedValueOnce(unavailableOutcome());
    mocked.analysis.mockResolvedValueOnce(analysis({ completedAt: null, requestedAt: null }));
    vi.mocked(getSite).mockResolvedValueOnce({ ...site, displayName: '' });
    result = await adapter.compose(compose({}, { resourceId: `${analysisId}:${recommendationId}` }));
    expect(result.document.subject[0]?.value).toBe(site.domain);
    expect(result.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());
  });
});

describe('content inventory export adapter', () => {
  it('exports every finding family, filters selected pages, clusters, flags, and gaps, and renders all formats', async () => {
    const [, , adapter] = createContentIntelligenceReportExportAdapters(database());
    if (!adapter) throw new Error('inventory adapter missing');
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    const full = await adapter.compose(compose({}, { format: 'csv' }));
    expect(full.document.completeness.selectedItems).toBe(11);
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: full.document, format, snapshotCreatedAt: completedAt }))
        .resolves.toMatchObject({ format });
    }

    const filtered = await adapter.compose(compose({
      page: ['https://example.test/a'],
      cluster: ['cluster-b'],
      flag: ['thin'],
      gap: ['gap-b'],
    }));
    expect(filtered.document.completeness.selectedItems).toBe(7);

    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    await expect(adapter.compose(compose({ page: ['https://example.test/a'] })))
      .resolves.toMatchObject({ document: { subject: [{ value: site.domain }] } });
  });

  it('handles missing findings, absent explanation, and requested/epoch observation fallbacks', async () => {
    const [, , adapter] = createContentIntelligenceReportExportAdapters(database());
    if (!adapter) throw new Error('inventory adapter missing');
    mocked.inventory.mockResolvedValueOnce(inventory({ findings: null, completedAt: null }));
    let result = await adapter.compose(compose({}));
    expect(result.document.sourceDates[0]?.observedAt).toBe(requestedAt);

    mocked.inventory.mockResolvedValueOnce(inventory({
      completedAt: null,
      requestedAt: null,
      pages: [],
      findings: {
        clusters: [], duplicates: [], thinPages: [], orphanPages: [], cannibalization: [], gaps: [],
        opportunityExplanation: null,
      },
    }));
    result = await adapter.compose(compose({}));
    expect(result.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());
    expect(result.document.completeness.selectedItems).toBe(0);
  });
});
