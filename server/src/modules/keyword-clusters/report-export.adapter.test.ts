import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ReportBrandingSnapshot,
  ReportLocale,
} from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';
import type {
  KeywordCluster,
  KeywordClusterMember,
} from './keyword-clusters.schemas.js';
import { getKeywordClusterRun, type KeywordClusterRunDetailDto } from './keyword-clusters.service.js';

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./keyword-clusters.service.js', () => ({ getKeywordClusterRun: vi.fn() }));

import {
  createKeywordClusterReportExportAdapter,
  keywordClusterReportExportTestables as internals,
} from './report-export.adapter.js';

const accountId = 'cluster-export-account';
const actorUserId = 'cluster-export-user';
const siteId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const observedEarly = '2026-08-01T10:00:00.000Z';
const observedLate = '2026-08-02T10:00:00.000Z';
const requestedAt = '2026-08-03T10:00:00.000Z';
const completedAt = '2026-08-03T11:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};
const keywordId = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function member(input: Partial<KeywordClusterMember> = {}): KeywordClusterMember {
  return {
    keywordId: keywordId(1), phrase: 'pivot keyword', observedAt: observedEarly,
    isPivot: true, sharedUrls: ['https://two.test/', 'https://one.test/'],
    sharedUrlCount: 2,
    ...input,
  };
}

function clusters(): KeywordCluster[] {
  return [
    {
      id: 'cluster-2', size: 1, pivotKeywordId: keywordId(5),
      sharedUrls: ['https://solo.test/'], label: null, labelSource: null,
      members: [member({
        keywordId: keywordId(5), phrase: 'solo',
        sharedUrls: ['https://solo.test/'], sharedUrlCount: 1,
      })],
    },
    {
      id: 'cluster-1', size: 4, pivotKeywordId: keywordId(1),
      sharedUrls: ['https://one.test/'], label: 'SEO tools', labelSource: 'ai',
      members: [
        member({ keywordId: keywordId(4), phrase: 'beta', isPivot: false, observedAt: observedLate }),
        member({ keywordId: keywordId(3), phrase: 'alpha', isPivot: false, observedAt: observedLate }),
        member({ keywordId: keywordId(2), phrase: 'alpha', isPivot: false, observedAt: observedLate }),
        member(),
      ],
    },
  ];
}

function run(input: Partial<KeywordClusterRunDetailDto> = {}): KeywordClusterRunDetailDto {
  return {
    id: runId,
    siteId,
    status: 'completed',
    aiStatus: 'applied',
    rulesVersion: '2026-08-04.1',
    minSharedUrls: 3,
    topUrlWindow: 10,
    keywordCount: 8,
    blockedCount: 3,
    clusterCount: 2,
    groupedClusterCount: 1,
    requestedAt,
    startedAt: requestedAt,
    completedAt,
    error: null,
    clusters: clusters(),
    blocked: [
      { keywordId: keywordId(8), phrase: 'zeta', reason: 'stale', observedAt: null },
      { keywordId: keywordId(7), phrase: 'alpha', reason: 'empty', observedAt: observedEarly },
      { keywordId: keywordId(6), phrase: 'alpha', reason: 'missing', observedAt: observedLate },
    ],
    ...input,
  };
}

function access(input: {
  scope?: 'site_resource' | 'site';
  purpose?: 'create' | 'persist';
  sourceVersion?: string;
} = {}) {
  return {
    accountId,
    actorUserId,
    purpose: input.purpose ?? 'create',
    target: input.scope === 'site'
      ? { scope: 'site' as const, siteId }
      : { scope: 'site_resource' as const, siteId, resourceId: runId },
    format: 'json' as const,
    locale: 'en' as const,
    ...(input.sourceVersion === undefined ? {} : { sourceVersion: input.sourceVersion }),
  };
}

function compose(selection: {
  minSize: number;
  maxSize: number;
  decision: 'all' | 'labeled' | 'unlabeled' | 'blocked';
}, format: 'pdf' | 'csv' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  vi.mocked(getKeywordClusterRun).mockReset().mockResolvedValue(run());
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Cluster Site',
    paused: false, pausedAt: null, createdAt: requestedAt, updatedAt: completedAt,
  });
});

describe('keyword-cluster export helpers', () => {
  it('validates size bounds and covers stable member and blocked ordering tie-breakers', () => {
    expect(internals.selectionSchema.parse({})).toEqual({
      minSize: 1, maxSize: 200, decision: 'all',
    });
    expect(internals.selectionSchema.safeParse({ minSize: 5, maxSize: 2 }).success).toBe(false);
    expect(internals.selectionSchema.safeParse({ minSize: 2, maxSize: 5 }).success).toBe(true);

    const pivot = member();
    const nonPivot = member({ keywordId: keywordId(2), isPivot: false });
    expect(internals.compareMembers(pivot, nonPivot)).toBeLessThan(0);
    expect(internals.compareMembers(nonPivot, pivot)).toBeGreaterThan(0);
    expect(internals.compareMembers(
      member({ phrase: 'alpha', isPivot: false }),
      member({ phrase: 'beta', isPivot: false }),
    )).toBeLessThan(0);
    expect(internals.compareMembers(
      member({ keywordId: keywordId(1), phrase: 'same', isPivot: false }),
      member({ keywordId: keywordId(2), phrase: 'same', isPivot: false }),
    )).toBeLessThan(0);
    expect(internals.compareBlocked(run().blocked[1]!, run().blocked[0]!)).toBeLessThan(0);
    expect(internals.compareBlocked(run().blocked[2]!, run().blocked[1]!)).toBeLessThan(0);
  });

  it('builds ranged and fallback source dates', () => {
    const ranged = internals.sourceDates('en' as ReportLocale, run());
    expect(ranged[0]).toMatchObject({ from: observedEarly, to: observedLate });
    const fallback = internals.sourceDates('en' as ReportLocale, run({
      clusters: [], blocked: [], completedAt: null,
    }));
    expect(fallback[0]?.observedAt).toBe(requestedAt);
  });

  it('builds all, blocked, labeled, unlabeled, and size-filtered document variants', () => {
    const make = (selection: Parameters<typeof internals.document>[0]['selection']) =>
      internals.document({ locale: 'en', branding, selection, siteName: 'Cluster Site', run: run() });
    expect(make({ minSize: 1, maxSize: 200, decision: 'all' }).completeness.selectedItems)
      .toBe(8);
    expect(make({ minSize: 1, maxSize: 200, decision: 'blocked' }).completeness.selectedItems)
      .toBe(3);
    expect(make({ minSize: 1, maxSize: 200, decision: 'labeled' }).completeness.selectedItems)
      .toBe(4);
    expect(make({ minSize: 1, maxSize: 200, decision: 'unlabeled' }).completeness.selectedItems)
      .toBe(1);
    expect(make({ minSize: 2, maxSize: 3, decision: 'all' }).completeness.selectedItems)
      .toBe(3);
  });
});

describe('keyword-cluster report export adapter', () => {
  it('enforces target scope, run/site ownership, and immutable persist versions', async () => {
    const adapter = createKeywordClusterReportExportAdapter();
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ scope: 'site' }))).rejects.toMatchObject({ status: 404 });
    vi.mocked(getKeywordClusterRun).mockResolvedValueOnce(run({ siteId: 'foreign-site' }));
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });

    const sourceVersion = (await adapter.compose(compose({
      minSize: 1, maxSize: 200, decision: 'all',
    }))).sourceVersion;
    await expect(adapter.assertAccess(access({ purpose: 'persist' }))).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ purpose: 'persist', sourceVersion })))
      .resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ purpose: 'persist', sourceVersion: 'stale' })))
      .rejects.toMatchObject({ status: 409 });
  });

  it('composes and renders all supported formats with a domain fallback', async () => {
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: requestedAt, updatedAt: completedAt,
    });
    const adapter = createKeywordClusterReportExportAdapter();
    const result = await adapter.compose(compose({ minSize: 1, maxSize: 200, decision: 'all' }));
    expect(result.document.subject[0]?.value).toBe('example.test');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: completedAt }))
        .resolves.toMatchObject({ format });
    }
  });
});
