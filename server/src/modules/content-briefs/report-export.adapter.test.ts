import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({ brief: vi.fn() }));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./content-brief.service.js', () => ({ getContentBrief: mocked.brief }));

import { createContentBriefReportExportAdapter } from './report-export.adapter.js';

const accountId = 'brief-export-account';
const actorUserId = 'brief-export-user';
const siteId = '507f1f77bcf86cd799439011';
const briefId = '507f1f77bcf86cd799439012';
const requestedAt = '2026-08-10T09:00:00.000Z';
const terminalAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function brief(input: Record<string, unknown> = {}) {
  return {
    id: briefId, siteId, keyword: 'seo audit', status: 'succeeded', locale: 'en',
    serpSource: 'dataforseo', retainedDocumentCount: 1, halt: null,
    requestedAt, terminalAt, latestDraftVersion: 2, abstentions: [],
    serp: {
      checkedAt: '2026-08-09T10:00:00.000Z', rows: [],
      paaRows: [{ id: 'paa-1', question: 'What is SEO?', answer: null }],
    },
    documents: [{ id: 'doc-1', title: 'SEO guide', capturedAt: '2026-08-09T11:00:00.000Z' }],
    corpusStats: { medianWordCount: 1200 },
    outline: [{ id: 'outline-1', heading: 'Introduction', level: 2 }],
    questions: [{ question: 'How does an audit work?' }],
    secondaryTerms: [{ id: 'term-1', term: 'technical seo', frequency: 2 }],
    scoreHistory: [
      {
        version: 1, draft: '# First draft', comparison: {}, aiScore: 70,
        aiRationale: 'Solid.', aiCitations: [], aiDisclosure: {}, createdAt: requestedAt,
      },
      {
        version: 2, draft: '# Latest draft', comparison: {}, aiScore: 85,
        aiRationale: 'Better.', aiCitations: [], aiDisclosure: {}, createdAt: terminalAt,
      },
    ],
    ...input,
  };
}

function access(scope: 'site_resource' | 'site' = 'site_resource') {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: scope === 'site_resource'
      ? { scope: 'site_resource' as const, siteId, resourceId: briefId }
      : { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(selection: Record<string, unknown>, format: 'pdf' | 'json' | 'md' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  mocked.brief.mockReset().mockResolvedValue(brief());
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Brief Site',
    paused: false, pausedAt: null, createdAt: requestedAt, updatedAt: terminalAt,
  });
});

describe('content brief report export adapter', () => {
  it('validates selection and resource scope', async () => {
    const adapter = createContentBriefReportExportAdapter();
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ draftVersion: 0 }).success).toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.brief).toHaveBeenCalledWith(accountId, siteId, briefId);
    await expect(adapter.assertAccess(access('site'))).rejects.toMatchObject({ status: 404 });
  });

  it('exports every evidence section, selects the latest draft, and renders native Markdown', async () => {
    const adapter = createContentBriefReportExportAdapter();
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('Brief Site');
    expect(result.document.completeness.selectedItems).toBe(10);
    expect(result.document.artifacts[0]).toMatchObject({
      format: 'md', label: `${briefId}-v2.md`,
    });
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: terminalAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('supports explicit draft versions and an empty section set without artifacts', async () => {
    const adapter = createContentBriefReportExportAdapter();
    let result = await adapter.compose(compose({ sections: ['draft'], draftVersion: 1 }, 'md'));
    expect(result.document.artifacts[0]?.label).toBe(`${briefId}-v1.md`);

    result = await adapter.compose(compose({ sections: [] }));
    expect(result.document.completeness.selectedItems).toBe(0);
    expect(result.document.artifacts).toEqual([]);
  });

  it('rejects unknown versions and handles no draft plus terminal/domain fallbacks', async () => {
    const adapter = createContentBriefReportExportAdapter();
    await expect(adapter.compose(compose({ draftVersion: 99 }))).rejects.toMatchObject({ status: 404 });

    mocked.brief.mockResolvedValue(brief({
      terminalAt: null, latestDraftVersion: null, scoreHistory: [],
    }));
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: requestedAt, updatedAt: requestedAt,
    });
    const result = await adapter.compose(compose({ sections: ['draft'] }));
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.sourceDates[0]?.observedAt).toBe(requestedAt);
    expect(result.document.artifacts).toEqual([]);
  });
});
