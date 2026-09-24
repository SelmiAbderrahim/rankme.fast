import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REPORT_GLOBAL_BOUNDS,
  REPORT_MAX_AFFECTED_URLS_PER_FINDING,
  REPORT_NATIVE_MEDIA_TYPES,
  type ReportBrandingSnapshot,
} from '../../shared/report-exports/index.js';
import { getSite, type PublicSite } from '../sites/index.js';
import {
  getAuditRun,
  resolveOwnedAuditRunSiteId,
} from './audits.service.js';
import { RULE_IDS, type RuleFinding } from './rules/index.js';
import { getAuditReport, type AuditReport, type LocalizedFinding } from './report.service.js';
import {
  auditReportExportTestables as internals,
  createAuditReportExportAdapter,
} from './report-export.adapter.js';

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./audits.service.js', () => ({
  getAuditRun: vi.fn(),
  resolveOwnedAuditRunSiteId: vi.fn(),
}));
vi.mock('./report.service.js', () => ({ getAuditReport: vi.fn() }));

const accountId = 'audit-export-account';
const actorUserId = 'audit-export-user';
const siteId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const finishedAt = '2026-08-10T12:00:00.000Z';
const updatedAt = '2026-08-10T13:00:00.000Z';
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
  updatedAt,
};

function finding(
  bucket: RuleFinding['bucket'],
  input: Partial<LocalizedFinding> = {},
): LocalizedFinding {
  return {
    ruleId: RULE_IDS[0],
    bucket,
    severity: 'warning',
    affectedUrls: bucket === 'passed' ? [] : ['https://example.test/b'],
    copy: {
      title: `${bucket} finding`,
      why: 'Why this matters.',
      fix: 'Fix the issue.',
      passedLabel: 'This check passed.',
      titleKey: `auditRules.${RULE_IDS[0]}.title`,
      whyKey: `auditRules.${RULE_IDS[0]}.why`,
      fixKey: `auditRules.${RULE_IDS[0]}.fix`,
      passedLabelKey: `auditRules.${RULE_IDS[0]}.passedLabel`,
    },
    ...input,
  };
}

function report(input: Partial<AuditReport> = {}): AuditReport {
  return {
    runId,
    counts: { fixNow: 1, watch: 1, passed: 1 },
    findings: [
      finding('fix-now', {
        severity: 'critical',
        affectedUrls: ['https://example.test/z', 'https://example.test/a'],
        copy: {
          title: 'Critical finding', why: 'Generic why.', reason: 'Specific reason.',
          fix: 'Fix it.', passedLabel: 'Passed.',
          titleKey: `auditRules.${RULE_IDS[0]}.title`,
          whyKey: `auditRules.${RULE_IDS[0]}.why`,
          fixKey: `auditRules.${RULE_IDS[0]}.fix`,
          passedLabelKey: `auditRules.${RULE_IDS[0]}.passedLabel`,
          reasonKey: `auditRules.${RULE_IDS[0]}.reason`,
        },
      }),
      finding('watch'),
      finding('passed', { severity: 'info' }),
    ],
    diff: {
      entries: [
        { ruleId: RULE_IDS[0], url: '', kind: 'fixed' },
        { ruleId: RULE_IDS[1], url: 'https://example.test/page', kind: 'regressed' },
      ],
      summary: { fixed: 1, regressed: 1, new: 0, unchanged: 0 },
    },
    pageSpeed: {
      status: 'ok',
      samples: [
        {
          url: 'https://example.test/', strategy: 'mobile',
          labScores: { performance: 91, accessibility: 92, bestPractices: 93, seo: 94 },
          coreWebVitals: { lcpMs: 1800, inp: 120, cls: 0.05, category: 'good' },
          mobileFriendly: true, fieldDataLevel: 'url',
        },
        {
          url: 'https://example.test/no-field', strategy: 'desktop',
          labScores: { performance: 81, accessibility: 82, bestPractices: 83, seo: 84 },
          fieldDataLevel: 'none',
        },
      ],
    },
    indexStatus: {
      status: 'ok',
      samples: [
        {
          url: 'https://example.test/',
          inspection: {
            indexVerdict: 'PASS', coverageState: 'Indexed', robotsTxtState: 'ALLOWED',
            pageFetchState: 'SUCCESSFUL', googleCanonical: 'https://example.test/',
            lastCrawlTime: new Date(finishedAt),
            richResults: { verdict: 'PASS', items: [{ type: 'FAQ', issues: 0 }] },
          },
        },
        {
          url: 'https://example.test/unknown',
          inspection: {
            indexVerdict: 'NEUTRAL', coverageState: '', robotsTxtState: '',
            pageFetchState: null, googleCanonical: null, lastCrawlTime: null,
            richResults: { verdict: 'NEUTRAL', items: [] },
          },
        },
      ],
    },
    gscSearch: {
      status: 'ok', totalClicks: 20, totalImpressions: 200, averageCtr: 0.1,
      averagePosition: 4.2,
      topQueries: [{ query: 'seo audit', clicks: 12, impressions: 100, ctr: 0.12, position: 3.2 }],
      topPages: [{ url: 'https://example.test/', clicks: 8, impressions: 100, ctr: 0.08, position: 5.2 }],
      delta: { clicks: 2, impressions: 20 },
    },
    gscSitemaps: {
      status: 'ok',
      sitemaps: [{ path: '/sitemap.xml', errors: 0, warnings: 1, processed: 20, lastDownloaded: finishedAt }],
    },
    aiVisibility: {
      status: 'ok', aiOverviewCitedCount: 1, aiOverviewTotalChecked: 2,
      llmMentionedCount: 1, llmTotalChecked: 2, shareOfVoicePct: null,
      sentiment: { positive: 1, neutral: 0, negative: 1 },
      notMentionedPrompts: ['best audit tool'],
    },
    localSeo: {
      status: 'ok',
      listings: [{ source: 'google', consistent: true }, { source: 'bing', consistent: false }],
      reviews: { averageRating: 4.5, reviewCount: 12 },
      qa: { unansweredCount: 2 },
      localPack: { keyword: 'seo agency', position: 2, totalPackSize: 3 },
    },
    aiSummary: {
      text: 'Fix the critical findings first.', locale: 'en', model: 'fixture-model',
      truncated: false, createdAt: finishedAt,
    },
    aiSummaryStatus: 'succeeded',
    aiSummaryAvailability: {
      requestedLocale: 'en',
      availableLocales: ['en'],
      status: 'succeeded',
    },
    ...input,
  };
}

function auditRun(input: {
  status?: 'queued' | 'running' | 'succeeded' | 'failed';
  finishedAt?: string | null;
} = {}) {
  return {
    run: {
      id: runId,
      siteId,
      status: input.status ?? 'succeeded',
      pageCap: 100,
      pagesCrawled: 10,
      vendorTaskId: 'task-1',
      startedAt: '2026-08-10T11:00:00.000Z',
      finishedAt: input.finishedAt === undefined ? finishedAt : input.finishedAt,
      error: null,
      createdAt: '2026-08-10T10:00:00.000Z',
      updatedAt,
    },
    summary: { domainChecks: null, pagesCrawled: 10 },
  } satisfies Awaited<ReturnType<typeof getAuditRun>>;
}

function access(input: {
  scope?: 'site_resource' | 'site';
  targetSiteId?: string;
  purpose?: 'create' | 'persist';
  format?: 'pdf' | 'csv' | 'json';
  sourceVersion?: string;
} = {}) {
  const scope = input.scope ?? 'site_resource';
  return {
    accountId,
    actorUserId,
    purpose: input.purpose ?? 'create',
    target: scope === 'site_resource'
      ? { scope, siteId: input.targetSiteId ?? siteId, resourceId: runId }
      : { scope, siteId: input.targetSiteId ?? siteId },
    format: input.format ?? 'json',
    locale: 'en' as const,
    ...(input.sourceVersion === undefined ? {} : { sourceVersion: input.sourceVersion }),
  };
}

function composeContext(input: {
  buckets?: Array<'fixNow' | 'watch' | 'passed'>;
  sections?: Array<'findings' | 'pagespeed' | 'gsc' | 'aiVisibility' | 'localSeo' | 'summary'>;
  format?: 'pdf' | 'csv' | 'json';
} = {}) {
  return {
    ...access({ format: input.format }),
    selection: {
      buckets: input.buckets ?? ['fixNow', 'watch', 'passed'],
      sections: input.sections ?? ['findings', 'pagespeed', 'gsc', 'aiVisibility', 'localSeo', 'summary'],
    },
    branding,
  };
}

beforeEach(() => {
  vi.mocked(getSite).mockReset().mockResolvedValue(site);
  vi.mocked(getAuditRun).mockReset().mockResolvedValue(auditRun());
  vi.mocked(resolveOwnedAuditRunSiteId).mockReset().mockResolvedValue(siteId);
  vi.mocked(getAuditReport).mockReset().mockResolvedValue(report());
});

describe('audit report export composition helpers', () => {
  it('normalizes every bucket/severity and validates selection defaults', () => {
    expect(internals.auditBucket('fix-now')).toBe('fixNow');
    expect(internals.auditBucket('watch')).toBe('watch');
    expect(internals.auditBucket('passed')).toBe('passed');
    expect(internals.canonicalBucket('fix-now')).toBe('fix_now');
    expect(internals.canonicalBucket('watch')).toBe('watch');
    expect(internals.canonicalSeverity('critical')).toBe('critical');
    expect(internals.canonicalSeverity('warning')).toBe('high');
    expect(internals.canonicalSeverity('info')).toBe('info');
    expect(internals.auditExportSelectionSchema.parse({})).toEqual({
      buckets: ['fixNow', 'watch', 'passed'],
      sections: ['findings', 'pagespeed', 'gsc', 'aiVisibility', 'localSeo', 'summary'],
    });
    expect(internals.auditExportSelectionSchema.safeParse({ extra: true }).success).toBe(false);
    expect(internals.auditExportSelectionSchema.safeParse({ buckets: [] }).success).toBe(false);
    expect(internals.auditCsvRowId('stored-id', 0)).toBe('stored-id');
    expect(internals.auditCsvRowId(undefined, 1)).toBe('row-2');
  });

  it('builds the complete audit document sections with deterministic values', () => {
    const full = internals.auditBlocks('en', report(), composeContext().selection);
    expect(full.findingCount).toBe(3);
    expect(full.blocks.map((block) => block.id)).toEqual(expect.arrayContaining([
      'audit-counts', 'audit-findings', 'audit-diff', 'pagespeed-samples', 'gsc-totals',
      'gsc-queries', 'gsc-pages', 'gsc-index-status', 'gsc-sitemaps',
      'ai-visibility-values', 'ai-not-mentioned', 'local-listings', 'local-values', 'summary',
    ]));
    const findings = full.blocks.find((block) => block.id === 'audit-findings');
    expect(findings).toMatchObject({
      type: 'findings',
      items: [
        expect.objectContaining({ bucket: 'fix_now', severity: 'critical', why: 'Specific reason.', affectedUrls: ['https://example.test/a', 'https://example.test/z'] }),
        expect.objectContaining({ bucket: 'watch', severity: 'high', fix: 'Fix the issue.' }),
        expect.objectContaining({ bucket: 'passed', severity: 'info', pass: 'This check passed.' }),
      ],
    });
    const pageSpeed = full.blocks.find((block) => block.id === 'pagespeed-samples');
    expect(pageSpeed).toMatchObject({
      type: 'table',
      rows: [
        expect.any(Object),
        expect.objectContaining({
          cells: expect.arrayContaining([expect.objectContaining({ value: { type: 'null', value: null } })]),
        }),
      ],
    });
    expect(internals.sourceDates('en', finishedAt, report())).toHaveLength(6);
    expect(internals.sourceDates('en', finishedAt, report({ aiSummary: null }))).toHaveLength(5);
  });

  it('renders unavailable and omitted optional sections without inventing evidence', () => {
    const unavailable = report({
      pageSpeed: { status: 'unavailable', samples: [] },
      indexStatus: { status: 'needs-reconnect', samples: [] },
      gscSearch: {
        status: 'unavailable', totalClicks: 0, totalImpressions: 0, averageCtr: 0,
        averagePosition: 0, topQueries: [], topPages: [], delta: { clicks: null, impressions: null },
      },
      gscSitemaps: { status: 'no-sitemaps', sitemaps: [] },
      aiVisibility: { ...report().aiVisibility!, status: 'unavailable', notMentionedPrompts: [] },
      localSeo: { status: 'not-configured', listings: [], reviews: null, qa: null, localPack: null },
      aiSummary: null,
    });
    const built = internals.auditBlocks('en', unavailable, composeContext().selection);
    expect(built.blocks.map((block) => block.id)).toEqual(expect.arrayContaining([
      'pagespeed-unavailable', 'gsc-search-unavailable', 'ai-visibility-unavailable',
      'local-unavailable', 'summary-unavailable',
    ]));
    expect(built.blocks.map((block) => block.id)).not.toContain('gsc-index-status');
    expect(built.blocks.map((block) => block.id)).not.toContain('gsc-sitemaps');
    expect(built.blocks.map((block) => block.id)).not.toContain('ai-not-mentioned');

    const absent = internals.auditBlocks('en', report({
      pageSpeed: null, gscSearch: null, indexStatus: null, gscSitemaps: null,
      aiVisibility: null, localSeo: null, aiSummary: null,
    }), composeContext().selection);
    expect(absent.blocks.map((block) => block.id)).toEqual(expect.arrayContaining([
      'pagespeed-unavailable', 'gsc-search-unavailable', 'ai-visibility-unavailable',
      'local-unavailable', 'summary-unavailable',
    ]));
  });

  it('covers local null measurements and section/bucket filtering independently', () => {
    const local = report({
      localSeo: {
        status: 'ok', listings: [], reviews: { averageRating: null, reviewCount: 0 },
        qa: null, localPack: { keyword: 'seo', position: null, totalPackSize: 3 },
      },
      aiVisibility: { ...report().aiVisibility!, shareOfVoicePct: 50, notMentionedPrompts: [] },
    });
    const localBlocks = internals.auditBlocks('en', local, {
      buckets: ['fixNow'], sections: ['localSeo'],
    });
    expect(localBlocks.findingCount).toBe(1);
    expect(localBlocks.blocks.map((block) => block.id)).toEqual([
      'audit-counts', 'local-heading', 'local-listings', 'local-values',
      'audit-observation-note', 'audit-derived-note',
    ]);
    const findingsOnly = internals.auditBlocks('en', report(), {
      buckets: ['passed'], sections: ['findings'],
    });
    expect(findingsOnly.findingCount).toBe(1);
    expect(findingsOnly.blocks.map((block) => block.id)).not.toContain('summary-heading');

    const emptyPrompts = internals.auditBlocks('en', local, {
      buckets: ['fixNow'], sections: ['aiVisibility'],
    });
    expect(emptyPrompts.blocks.map((block) => block.id)).not.toContain('ai-not-mentioned');
    const missingReviews = internals.auditBlocks('en', report({
      localSeo: { status: 'ok', listings: [], reviews: null, qa: null, localPack: null },
    }), { buckets: ['fixNow'], sections: ['localSeo'] });
    expect(missingReviews.blocks.find((block) => block.id === 'local-values')).toMatchObject({
      type: 'key_value',
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'review-count', value: { type: 'null', value: null } }),
      ]),
    });
  });
});

describe('audit report export access, composition, and rendering', () => {
  it('enforces resource scope, site ownership, and immutable source versions', async () => {
    const adapter = createAuditReportExportAdapter();
    await expect(adapter.assertAccess(access({ scope: 'site' }))).rejects.toMatchObject({ status: 404 });
    vi.mocked(resolveOwnedAuditRunSiteId).mockResolvedValueOnce('foreign-site');
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });
    await expect(adapter.assertAccess(access({ format: 'pdf' }))).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ purpose: 'persist' }))).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ sourceVersion: 'ignored-on-create' }))).resolves.toBeUndefined();
    const current = await internals.auditSourceVersion(accountId, runId, 'en');
    await expect(adapter.assertAccess(access({ purpose: 'persist', sourceVersion: current }))).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ purpose: 'persist', sourceVersion: 'stale' })))
      .rejects.toMatchObject({ status: 409 });
  });

  it('rejects unfinished source-version reads and compose requests', async () => {
    vi.mocked(getAuditRun).mockResolvedValueOnce(auditRun({ status: 'failed' }));
    await expect(internals.auditSourceVersion(accountId, runId, 'en')).rejects.toMatchObject({ status: 404 });
    vi.mocked(getAuditRun).mockResolvedValueOnce(auditRun({ finishedAt: null }));
    await expect(internals.auditSourceVersion(accountId, runId, 'en')).rejects.toMatchObject({ status: 404 });
    const adapter = createAuditReportExportAdapter();
    await expect(adapter.compose({ ...composeContext(), target: { scope: 'site' as const, siteId } }))
      .rejects.toMatchObject({ status: 404 });
    vi.mocked(getAuditRun).mockResolvedValueOnce(auditRun({ status: 'running' }));
    await expect(adapter.compose(composeContext())).rejects.toMatchObject({ status: 404 });
    vi.mocked(getAuditRun).mockResolvedValueOnce(auditRun({ finishedAt: null }));
    await expect(adapter.compose(composeContext())).rejects.toMatchObject({ status: 404 });
  });

  it('uses the extended PDF finding and affected-URL bounds while allowing narrowed exports', async () => {
    const adapter = createAuditReportExportAdapter();
    vi.mocked(getAuditReport).mockResolvedValueOnce(report({
      counts: { fixNow: 201, watch: 0, passed: 0 },
      findings: Array.from({ length: 201 }, () => finding('fix-now')),
    }));
    await expect(adapter.compose(composeContext({ format: 'pdf' }))).resolves.toMatchObject({
      document: { completeness: { selectedItems: 201, representedItems: 201 } },
    });

    vi.mocked(getAuditReport).mockResolvedValueOnce(report({
      findings: [finding('fix-now', {
        affectedUrls: Array.from({ length: 11 }, (_, index) => `https://example.test/${index}`),
      })],
    }));
    await expect(adapter.compose(composeContext({ format: 'pdf' }))).resolves.toMatchObject({
      document: { completeness: { selectedItems: 1, representedItems: 1 } },
    });

    vi.mocked(getAuditReport).mockResolvedValueOnce(report({
      counts: { fixNow: REPORT_GLOBAL_BOUNDS.pdfItems + 1, watch: 0, passed: 0 },
      findings: Array.from(
        { length: REPORT_GLOBAL_BOUNDS.pdfItems + 1 },
        () => finding('fix-now'),
      ),
    }));
    await expect(adapter.compose(composeContext({ format: 'pdf' }))).rejects.toMatchObject({ status: 422 });

    vi.mocked(getAuditReport).mockResolvedValueOnce(report({
      findings: [finding('fix-now', {
        affectedUrls: Array.from(
          { length: REPORT_MAX_AFFECTED_URLS_PER_FINDING + 1 },
          (_, index) => `https://example.test/${index}`,
        ),
      })],
    }));
    await expect(adapter.compose(composeContext({ format: 'pdf' }))).rejects.toMatchObject({ status: 422 });

    vi.mocked(getAuditReport).mockResolvedValueOnce(report());
    const result = await adapter.compose(composeContext({ format: 'pdf', buckets: ['passed'] }));
    expect(result.document.completeness).toMatchObject({ selectedItems: 1, representedItems: 1 });
  });

  it('composes stable metadata, uses the domain fallback, and renders every transport safely', async () => {
    const adapter = createAuditReportExportAdapter();
    vi.mocked(getSite).mockResolvedValueOnce({ ...site, displayName: '' });
    const result = await adapter.compose(composeContext());
    expect(result.sourceVersion).toMatch(/^audit:[0-9a-f]{64}$/);
    expect(result.document).toMatchObject({
      kind: 'audit.run', locale: 'en', subject: [{ value: site.domain }],
      completeness: { state: 'complete', selectedItems: 3, representedItems: 3 },
      artifacts: [],
    });
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({
        document: result.document, format, snapshotCreatedAt: finishedAt,
      })).resolves.toMatchObject({ format });
    }
    await expect(adapter.render({
      document: {
        ...result.document,
        blocks: [{ type: 'native_artifact', id: 'native-block', artifactId: 'native' }],
        artifacts: [{
          id: 'native', label: 'Native artifact', format: 'md',
          mediaType: REPORT_NATIVE_MEDIA_TYPES.md, extension: 'md', byteLength: 12,
          sha256: '0'.repeat(64), validation: 'valid',
        }],
      },
      format: 'md',
      snapshotCreatedAt: finishedAt,
    })).rejects.toThrow('native report renderer is unavailable');

    vi.mocked(getSite).mockResolvedValueOnce(site);
    await expect(adapter.compose(composeContext({ sections: ['summary'] }))).resolves.toMatchObject({
      document: { subject: [{ value: site.displayName }] },
    });
  });
});
