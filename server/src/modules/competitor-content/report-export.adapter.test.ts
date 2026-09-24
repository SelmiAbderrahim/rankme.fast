import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite, type PublicSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('./competitor-content.runs.service.js', () => ({ getCompetitorRun: mocked.run }));
vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));

import {
  competitorContentReportExportTestables as internals,
  createCompetitorContentReportExportAdapter,
} from './report-export.adapter.js';

const accountId = 'competitor-content-export-account';
const actorUserId = 'competitor-content-export-user';
const siteId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const completedAt = '2026-08-10T12:00:00.000Z';
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

function evidence(keyword: string) {
  return {
    keyword,
    class: 'shared_behind',
    ownedPosition: 8,
    competitorPosition: 3,
    ownedUrl: 'https://example.test/owned',
    competitorUrl: 'https://alpha.test/page',
    searchVolume: 100,
    intent: 'commercial',
    provenanceIndexes: [0, 1],
  };
}

function page(url: string, role: 'owned' | 'competitor', input: Record<string, unknown> = {}) {
  return {
    url,
    role,
    facts: {
      competitorDomain: role === 'competitor' ? new URL(url).hostname : null,
      statusCode: 200,
      title: 'Page title',
      description: 'Page description',
      headings: ['Heading one'],
      wordCount: 1000,
      schemaTypes: ['Article'],
      hasSchemaOrgArticle: true,
      internalLinkCount: 10,
      externalLinkCount: 2,
      contentHash: 'hash',
      primaryTopics: ['SEO'],
      secondaryTopics: ['Audits'],
      snippet: 'A safe bounded snippet.',
      url,
      role,
      ...input,
    },
  };
}

function run(input: Record<string, unknown> = {}) {
  return {
    runId,
    siteId,
    ownedUrl: 'https://example.test/owned',
    startedAt: '2026-08-10T11:00:00.000Z',
    requestedAt: '2026-08-10T10:00:00.000Z',
    completedAt,
    input: {
      competitorDomains: ['alpha.test', 'beta.test'],
      pageMatches: [
        {
          source: 'landscape_review',
          competitorDomain: 'alpha.test',
          selectedUrl: 'https://alpha.test/page',
          suggestedRankingUrl: 'https://alpha.test/suggested',
          ownedUrl: 'https://example.test/owned',
          keywordEvidence: [evidence('seo audit')],
        },
        {
          source: 'legacy_explicit',
          competitorDomain: 'beta.test',
          selectedUrl: 'https://beta.test/page',
          suggestedRankingUrl: 'https://beta.test/page',
          ownedUrl: null,
          keywordEvidence: [],
        },
      ],
    },
    pages: [
      page('https://example.test/owned', 'owned'),
      page('https://alpha.test/page', 'competitor'),
      page('https://beta.test/page', 'competitor', {
        title: null, description: null, headings: [], schemaTypes: [],
        primaryTopics: [], secondaryTopics: [], snippet: '',
      }),
    ],
    findings: {
      ownedUrl: 'https://example.test/owned',
      deltas: [
        {
          competitorDomain: 'alpha.test',
          competitorUrl: 'https://alpha.test/page',
          ownedUrl: 'https://example.test/owned',
          wordCountDelta: 500,
          headingCountDelta: 2,
          internalLinkDelta: 3,
          externalLinkDelta: 1,
          landscapeReportId: '507f1f77bcf86cd799439099',
          missingSchemaTypes: ['FAQPage'],
          missingTopics: ['Automation'],
          ownedOnlyTopics: ['Security'],
          sharedQueries: ['seo audit'],
          keywordEvidence: [evidence('seo audit')],
        },
        {
          competitorDomain: 'beta.test',
          competitorUrl: 'https://beta.test/page',
          ownedUrl: 'https://example.test/owned',
          wordCountDelta: -10,
          headingCountDelta: 0,
          internalLinkDelta: 0,
          externalLinkDelta: 0,
          landscapeReportId: null,
          missingSchemaTypes: [],
          missingTopics: [],
          ownedOnlyTopics: [],
          sharedQueries: [],
          keywordEvidence: [],
        },
      ],
      opportunities: [
        {
          id: 'opportunity-b', kind: 'topic_gap', confidence: 'high',
          messageKey: 'contentIntelligence.competitorContent.opportunityCopy.topicGap',
          messageVars: { topic: 'automation' }, label: 'Cover automation',
          evidenceSourceIds: ['topic:automation'], keywordEvidence: [evidence('automation seo')],
        },
        {
          id: 'opportunity-a', kind: 'schema_gap', confidence: 'medium',
          messageKey: 'contentIntelligence.competitorContent.opportunityCopy.schemaGap',
          messageVars: { schemaType: 'FAQPage' }, label: 'Add FAQ schema',
          evidenceSourceIds: [], keywordEvidence: [],
        },
      ],
      aiExplanation: 'The competitor covers one additional topic.',
      partialDomains: ['zeta.test', 'gamma.test'],
    },
    ...input,
  };
}

function access(input: {
  purpose?: 'create' | 'persist';
  sourceVersion?: string;
  scope?: 'site_resource' | 'site';
  targetSiteId?: string;
} = {}) {
  const scope = input.scope ?? 'site_resource';
  return {
    accountId,
    actorUserId,
    purpose: input.purpose ?? 'create',
    target: scope === 'site_resource'
      ? { scope, siteId: input.targetSiteId ?? siteId, resourceId: runId }
      : { scope, siteId: input.targetSiteId ?? siteId },
    format: 'json' as const,
    locale: 'en' as const,
    ...(input.sourceVersion === undefined ? {} : { sourceVersion: input.sourceVersion }),
  };
}

function compose(selection: {
  domains?: string[];
  pages?: string[];
  opportunities?: Array<'topic_gap' | 'schema_gap' | 'format_gap' | 'internal_linking_gap' | 'differentiated_strength' | 'target_keyword'>;
} = {}) {
  return { ...access(), selection, branding };
}

beforeEach(() => {
  mocked.run.mockReset().mockResolvedValue(run());
  vi.mocked(getSite).mockReset().mockResolvedValue(site);
});

describe('competitor content export helpers and access', () => {
  it('projects only public keyword evidence and bounds deterministic selection labels', () => {
    expect(internals.visibleKeywordEvidence(evidence('seo audit'))).toEqual({
      keyword: 'seo audit', class: 'shared_behind', ownedPosition: 8, competitorPosition: 3,
      ownedUrl: 'https://example.test/owned', competitorUrl: 'https://alpha.test/page',
      searchVolume: 100, intent: 'commercial',
    });
    expect(internals.boundedSelectionValue(['beta', 'alpha'])).toBe('alpha, beta');
    expect(internals.boundedSelectionValue(['x'.repeat(901)])).toMatch(/^1; selection:/);
    expect(internals.selectionSchema.parse({})).toEqual({});
    expect(internals.selectionSchema.safeParse({ domains: Array.from({ length: 11 }, () => 'a.test') }).success).toBe(false);
    const match = (competitorDomain: string, selectedUrl: string, ownedUrl: string | null) => ({
      competitorDomain, selectedUrl, ownedUrl,
    });
    expect(internals.comparePageMatches(match('a', 'z', null), match('b', 'a', null))).toBeLessThan(0);
    expect(internals.comparePageMatches(match('a', 'a', null), match('a', 'b', null))).toBeLessThan(0);
    expect(internals.comparePageMatches(match('a', 'a', null), match('a', 'a', 'b'))).toBeLessThan(0);
    expect(internals.comparePageMatches(match('a', 'a', 'b'), match('a', 'a', null))).toBeGreaterThan(0);
    expect(internals.comparePageMatches(match('a', 'a', 'b'), match('a', 'a', 'b'))).toBe(0);
    expect(internals.compareDeltas({ competitorDomain: 'a', competitorUrl: 'z' }, { competitorDomain: 'b', competitorUrl: 'a' })).toBeLessThan(0);
    expect(internals.compareDeltas({ competitorDomain: 'a', competitorUrl: 'a' }, { competitorDomain: 'a', competitorUrl: 'b' })).toBeLessThan(0);
    expect(internals.compareOpportunities({ kind: 'a', id: 'z' }, { kind: 'b', id: 'a' })).toBeLessThan(0);
    expect(internals.compareOpportunities({ kind: 'a', id: 'a' }, { kind: 'a', id: 'b' })).toBeLessThan(0);
    expect(internals.findingOwnedUrl({ ownedUrl: 'finding' }, 'run')).toBe('finding');
    expect(internals.findingOwnedUrl(null, 'run')).toBe('run');
  });

  it('enforces resource scope, site binding, and source immutability', async () => {
    const adapter = createCompetitorContentReportExportAdapter();
    await expect(adapter.assertAccess(access({ scope: 'site' }))).rejects.toMatchObject({ status: 404 });
    mocked.run.mockResolvedValueOnce(run({ siteId: 'foreign-site' }));
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ purpose: 'persist' }))).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ sourceVersion: 'ignored-on-create' }))).resolves.toBeUndefined();
    const sourceVersion = (await adapter.compose(compose())).sourceVersion;
    await expect(adapter.assertAccess(access({ purpose: 'persist', sourceVersion }))).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ purpose: 'persist', sourceVersion: 'stale' })))
      .rejects.toMatchObject({ status: 409 });
  });
});

describe('competitor content export composition', () => {
  it('exports every observed, derived, generated, and partial evidence family deterministically', async () => {
    const adapter = createCompetitorContentReportExportAdapter();
    const result = await adapter.compose(compose());
    expect(result.sourceVersion).toMatch(/^competitors\.content_run:[0-9a-f]{64}$/);
    expect(result.document).toMatchObject({
      subject: [
        { value: site.displayName },
        { value: 'alpha.test, beta.test' },
      ],
      completeness: { state: 'complete', selectedItems: 12, representedItems: 12 },
      artifacts: [],
    });
    const table = result.document.blocks[0];
    expect(table).toMatchObject({ type: 'table' });
    if (table?.type !== 'table') throw new Error('content table missing');
    const values = table.rows.map((row) => row.cells.map((cell) => cell.value.value));
    expect(values.some((row) => row[0] === 'reviewed-page-match' && row[5] === 'approved')).toBe(true);
    expect(values.some((row) => row[0] === 'reviewed-page-match' && row[5] === 'legacy_explicit')).toBe(true);
    expect(values.some((row) => row[0] === 'delta-evidence' && row[4] === 'keywordEvidence')).toBe(true);
    expect(values.some((row) => row[0] === 'opportunity-evidence')).toBe(true);
    expect(values.some((row) => row[0] === 'explanation')).toBe(true);
    expect(values.filter((row) => row[0] === 'missing').map((row) => row[1])).toEqual(['gamma.test', 'zeta.test']);
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: completedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('filters by domain, selected or owned page, and opportunity kind', async () => {
    const adapter = createCompetitorContentReportExportAdapter();
    const selected = await adapter.compose(compose({
      domains: ['alpha.test'],
      pages: ['https://example.test/owned'],
      opportunities: ['schema_gap'],
    }));
    expect(selected.document.completeness.selectedItems).toBe(7);
    const table = selected.document.blocks[0];
    if (table?.type !== 'table') throw new Error('content table missing');
    const rows = table.rows.map((row) => row.cells.map((cell) => cell.value.value));
    expect(rows.some((row) => row[1] === 'beta.test')).toBe(false);
    expect(rows.some((row) => row[0] === 'opportunity' && row[3] === 'schema_gap')).toBe(true);
    expect(rows.some((row) => row[0] === 'opportunity' && row[3] === 'topic_gap')).toBe(false);

    const competitorPage = await adapter.compose(compose({
      domains: [], pages: ['https://alpha.test/page'], opportunities: [],
    }));
    expect(competitorPage.document.completeness.selectedItems).toBeGreaterThan(0);
  });

  it('handles missing findings, blank labels, and every observation-time fallback', async () => {
    const adapter = createCompetitorContentReportExportAdapter();
    mocked.run.mockResolvedValueOnce(run({ findings: null, completedAt: null }));
    vi.mocked(getSite).mockResolvedValueOnce({ ...site, displayName: '' });
    let result = await adapter.compose(compose({ domains: [], opportunities: [] }));
    expect(result.document.subject[0]?.value).toBe(site.domain);
    expect(result.document.sourceDates[0]?.observedAt).toBe('2026-08-10T11:00:00.000Z');

    mocked.run.mockResolvedValueOnce(run({ findings: null, completedAt: null, startedAt: null }));
    result = await adapter.compose(compose({ domains: [], opportunities: [] }));
    expect(result.document.sourceDates[0]?.observedAt).toBe('2026-08-10T10:00:00.000Z');

    mocked.run.mockResolvedValueOnce(run({
      findings: { ...run().findings, aiExplanation: null, partialDomains: [] },
      completedAt: null, startedAt: null, requestedAt: null,
    }));
    result = await adapter.compose(compose({ domains: [], opportunities: [] }));
    expect(result.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());
  });
});
