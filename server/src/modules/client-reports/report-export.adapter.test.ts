import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { reportSourceVersion, type ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import type { ReportExportAccessPurpose } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import {
  composeClientReport,
  inspectClientReportCompleteness,
} from './report-composer.service.js';

const mocked = vi.hoisted(() => ({
  compose: vi.fn(),
  inspect: vi.fn(),
  site: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ getSite: mocked.site }));
vi.mock('./report-composer.service.js', () => ({
  composeClientReport: mocked.compose,
  inspectClientReportCompleteness: mocked.inspect,
}));

import {
  clientReportExportAdapterTestables as internals,
  createClientReportExportAdapter,
} from './report-export.adapter.js';

const accountId = 'client-export-account';
const actorUserId = 'client-export-user';
const siteId = '507f1f77bcf86cd799439011';
const snapshotDate = '2026-08-10';
const generatedAt = '2026-08-10T12:00:00.000Z';
const earlier = '2026-08-03T12:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function finding(input: {
  bucket: 'fix-now' | 'watch' | 'passed';
  severity: 'critical' | 'warning' | 'info';
  reason?: string;
}) {
  return {
    ruleId: `rule-${input.bucket}`,
    bucket: input.bucket,
    severity: input.severity,
    affectedUrls: input.bucket === 'passed'
      ? []
      : ['https://example.test/z', 'https://example.test/a'],
    copy: {
      title: `${input.bucket} title`,
      why: `${input.bucket} why`,
      fix: `${input.bucket} fix`,
      passedLabel: `${input.bucket} passed`,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    },
  };
}

function auditSection(input: { summary?: boolean } = {}) {
  return {
    snapshotDate: generatedAt,
    report: {
      counts: { fixNow: 1, watch: 1, passed: 1 },
      findings: [
        finding({ bucket: 'fix-now', severity: 'critical', reason: 'specific reason' }),
        finding({ bucket: 'watch', severity: 'warning' }),
        finding({ bucket: 'passed', severity: 'info' }),
      ],
      aiSummary: input.summary === false ? null : {
        text: 'Generated summary.', createdAt: generatedAt,
      },
    },
  };
}

function rankSection(input: { empty?: boolean } = {}) {
  return {
    snapshotDate: generatedAt,
    rows: input.empty ? [] : [
      { keyword: 'beta', engine: 'google', position: null, checkedAt: generatedAt },
      { keyword: 'alpha', engine: 'google', position: 3, checkedAt: earlier },
    ],
  };
}

function gscSection() {
  return {
    snapshotDate,
    windowDays: 28,
    totalClicks: 12,
    totalImpressions: 120,
    averageCtr: 0.1,
    averagePosition: 4.2,
    topQueries: [
      { query: 'seo audit', clicks: 8, impressions: 80, ctr: 0.1, position: 3.2, snapshotDate },
      { query: 'site audit', clicks: 4, impressions: 40, ctr: 0.1, position: 6.2, snapshotDate },
    ],
  };
}

function snapshot(input: {
  audit?: ReturnType<typeof auditSection> | null;
  ranks?: ReturnType<typeof rankSection> | null;
  gsc?: ReturnType<typeof gscSection> | null;
} = {}) {
  return {
    siteLabel: 'Example Site',
    siteDomain: 'example.test',
    locale: 'en',
    branding: null,
    generatedAt,
    sections: {
      audit: input.audit === undefined ? auditSection() : input.audit,
      ranks: input.ranks === undefined ? rankSection() : input.ranks,
      gsc: input.gsc === undefined ? gscSection() : input.gsc,
    },
  };
}

function completeness(input: {
  auditFindings?: number;
  maxAffectedUrls?: number;
  rankRows?: number;
  gscQueries?: number;
} = {}) {
  return {
    auditFindings: input.auditFindings ?? 3,
    maxAffectedUrls: input.maxAffectedUrls ?? 2,
    rankRows: input.rankRows ?? 2,
    gscQueries: input.gscQueries ?? 2,
  };
}

function accessContext(input: {
  purpose?: ReportExportAccessPurpose;
  sourceVersion?: string;
  scope?: 'site' | 'site_resource';
} = {}) {
  return {
    accountId,
    actorUserId,
    purpose: input.purpose ?? 'create',
    target: input.scope === 'site_resource'
      ? { scope: 'site_resource' as const, siteId, resourceId: 'report-1' }
      : { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
    ...(input.sourceVersion === undefined ? {} : { sourceVersion: input.sourceVersion }),
  };
}

function composeContext(input: {
  audit?: boolean;
  ranks?: boolean;
  gsc?: boolean;
} = {}) {
  return {
    accountId,
    actorUserId,
    target: { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
    selection: {
      sections: {
        audit: input.audit ?? true,
        ranks: input.ranks ?? true,
        gsc: input.gsc ?? true,
      },
    },
    branding,
  };
}

const originalEnabled = env.CLIENT_REPORTS_ENABLED;

beforeEach(() => {
  env.CLIENT_REPORTS_ENABLED = true;
  mocked.site.mockReset().mockResolvedValue({
    id: siteId,
    url: 'https://example.test',
    domain: 'example.test',
    displayName: 'Example Site',
    paused: false,
    pausedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: generatedAt,
  });
  mocked.compose.mockReset().mockResolvedValue(snapshot());
  mocked.inspect.mockReset().mockResolvedValue(completeness());
});

afterEach(() => {
  env.CLIENT_REPORTS_ENABLED = originalEnabled;
  vi.restoreAllMocks();
});

describe('client report export metadata and access', () => {
  it('exposes exact formats, default sections, strict selection, and deterministic source versions', () => {
    const adapter = createClientReportExportAdapter(db);
    expect(adapter).toMatchObject({
      kind: 'client.composite', kindVersion: 1, supportedFormats: ['pdf', 'json'],
    });
    expect(adapter.selectionSchema.parse({})).toEqual({ sections: internals.allSections });
    expect(adapter.selectionSchema.safeParse({ sections: {
      audit: false, ranks: false, gsc: false,
    } }).success).toBe(false);
    expect(adapter.selectionSchema.safeParse({ extra: true }).success).toBe(false);
    expect(internals.clientSnapshotVersion(snapshot())).toBe(reportSourceVersion('client', snapshot()));
  });

  it('enforces site scope, ownership, and rollout before persistence checks', async () => {
    const adapter = createClientReportExportAdapter(db);
    await expect(adapter.assertAccess(accessContext({ scope: 'site_resource' })))
      .rejects.toMatchObject({ status: 404 });
    expect(getSite).not.toHaveBeenCalled();

    await expect(adapter.assertAccess(accessContext())).resolves.toBeUndefined();
    expect(getSite).toHaveBeenCalledWith(accountId, siteId);

    env.CLIENT_REPORTS_ENABLED = false;
    await expect(adapter.assertAccess(accessContext())).rejects.toMatchObject({
      status: 404, message: 'clientReports.errors.unavailable',
    });
    expect(composeClientReport).not.toHaveBeenCalled();
  });

  it('accepts unchanged persisted snapshots and rejects stale versions only', async () => {
    const adapter = createClientReportExportAdapter(db);
    const current = internals.clientSnapshotVersion(snapshot());
    await expect(adapter.assertAccess(accessContext({ purpose: 'read', sourceVersion: 'stale' })))
      .resolves.toBeUndefined();
    await expect(adapter.assertAccess(accessContext({ purpose: 'persist' }))).resolves.toBeUndefined();
    await expect(adapter.assertAccess(accessContext({ purpose: 'persist', sourceVersion: current })))
      .resolves.toBeUndefined();
    await expect(adapter.assertAccess(accessContext({ purpose: 'persist', sourceVersion: 'stale' })))
      .rejects.toMatchObject({ status: 409, message: 'reportExports.errors.sourceChanged' });
    expect(composeClientReport).toHaveBeenCalledTimes(2);
    expect(composeClientReport).toHaveBeenLastCalledWith(expect.objectContaining({
      sections: internals.allSections,
    }), db);
  });
});

describe('client report export bounds', () => {
  it('rejects each complete-count ceiling independently without clipping evidence', async () => {
    const adapter = createClientReportExportAdapter(db);
    const cases = [
      completeness({ auditFindings: 201 }),
      completeness({ maxAffectedUrls: 11 }),
      completeness({ rankRows: 26 }),
      completeness({ gscQueries: 6 }),
    ];
    for (const counts of cases) {
      mocked.inspect.mockResolvedValueOnce(counts);
      await expect(adapter.compose(composeContext())).rejects.toMatchObject({
        status: 422,
        message: 'reportExports.errors.scopeTooLarge',
        details: { code: 'scope_too_large', narrowingFields: ['sections'] },
      });
    }
  });

  it('refuses cross-scope composition before reading snapshots', async () => {
    const adapter = createClientReportExportAdapter(db);
    await expect(adapter.compose({
      ...composeContext(),
      target: { scope: 'site_resource', siteId, resourceId: 'report-1' },
    })).rejects.toMatchObject({ status: 404 });
    expect(composeClientReport).not.toHaveBeenCalled();
  });
});

describe('client report export composition', () => {
  it('composes complete audit, rank, and GSC evidence without re-reading selected-only snapshots', async () => {
    const adapter = createClientReportExportAdapter(db);
    const result = await adapter.compose(composeContext());
    expect(composeClientReport).toHaveBeenCalledWith({
      accountId, siteId, locale: 'en', sections: internals.allSections,
    }, db);
    expect(inspectClientReportCompleteness).toHaveBeenCalledWith({
      accountId, siteId, locale: 'en', sections: internals.allSections,
    }, expect.any(Object), db);
    expect(result.sourceVersion).toBe(internals.clientSnapshotVersion(snapshot()));
    expect(result.document).toMatchObject({
      kind: 'client.composite',
      locale: 'en',
      subject: [{ label: expect.any(String), value: 'Example Site' }],
      completeness: { state: 'complete', selectedItems: 7, representedItems: 7 },
      branding,
      artifacts: [],
    });
    expect(result.document.selection[0]?.value).toBe('audit, ranks, gsc');
    expect(result.document.sourceDates.map((source) => source.kind)).toEqual([
      'provider_observation', 'generated', 'provider_observation', 'first_party_observation',
    ]);
    expect(result.document.blocks.map((block) => block.id)).toEqual(expect.arrayContaining([
      'client-audit-heading',
      'client-audit-counts',
      'client-audit-findings',
      'client-audit-summary',
      'client-ranks-heading',
      'client-ranks',
      'client-gsc-heading',
      'client-gsc-totals',
      'client-gsc-queries',
      'client-audit-note',
      'client-summary-note',
      'client-ranks-note',
      'client-gsc-note',
    ]));
    const findings = result.document.blocks.find((block) => block.id === 'client-audit-findings');
    expect(findings).toMatchObject({
      type: 'findings',
      items: [
        expect.objectContaining({ bucket: 'fix_now', severity: 'critical', why: 'specific reason', fix: 'fix-now fix', affectedUrls: ['https://example.test/a', 'https://example.test/z'] }),
        expect.objectContaining({ bucket: 'watch', severity: 'high', why: 'watch why', fix: 'watch fix' }),
        expect.objectContaining({ bucket: 'passed', severity: 'info', pass: 'passed passed' }),
      ],
    });
    const ranks = result.document.blocks.find((block) => block.id === 'client-ranks');
    expect(ranks).toMatchObject({ type: 'table', rows: [expect.any(Object), expect.any(Object)] });
    const gscTotals = result.document.blocks.find((block) => block.id === 'client-gsc-totals');
    expect(gscTotals).toMatchObject({
      type: 'kpi_group', items: expect.arrayContaining([expect.objectContaining({ id: 'ctr', unit: '%' })]),
    });
  });

  it('uses one derived state source for wholly unavailable selected sections', async () => {
    mocked.compose.mockResolvedValueOnce(snapshot({ audit: null, ranks: null, gsc: null }));
    mocked.inspect.mockResolvedValueOnce(completeness({
      auditFindings: 0, maxAffectedUrls: 0, rankRows: 0, gscQueries: 0,
    }));
    const result = await createClientReportExportAdapter(db).compose(composeContext());
    expect(result.document.sourceDates).toHaveLength(1);
    expect(result.document.sourceDates[0]?.kind).toBe('derived');
    expect(result.document.blocks.filter((block) => block.type === 'state')).toHaveLength(3);
    expect(result.document.blocks.at(-1)?.id).toBe('client-state-note');
    expect(result.document.completeness.selectedItems).toBe(0);
  });

  it('adds missing-section state after other evidence and handles empty rank history and absent summaries', async () => {
    mocked.compose
      .mockResolvedValueOnce(snapshot({ ranks: null, gsc: null, audit: auditSection({ summary: false }) }))
      .mockResolvedValueOnce(snapshot({ audit: null, gsc: null, ranks: rankSection({ empty: true }) }));
    mocked.inspect
      .mockResolvedValueOnce(completeness({ rankRows: 0, gscQueries: 0 }))
      .mockResolvedValueOnce(completeness({ auditFindings: 0, maxAffectedUrls: 0, rankRows: 0, gscQueries: 0 }));
    const adapter = createClientReportExportAdapter(db);
    const partial = await adapter.compose(composeContext());
    expect(partial.document.sourceDates.map((source) => source.id)).toEqual([
      'client-audit', 'client-state',
    ]);
    expect(partial.document.blocks.some((block) => block.id === 'client-audit-summary')).toBe(false);

    const emptyRanks = await adapter.compose(composeContext({ audit: false, ranks: true, gsc: false }));
    expect(emptyRanks.document.sourceDates[0]).toMatchObject({
      id: 'client-ranks', from: generatedAt, to: generatedAt,
    });
    expect(emptyRanks.document.completeness.selectedItems).toBe(0);
    expect(emptyRanks.document.selection[0]?.value).toBe('ranks');
  });

  it('rejects a direct all-false selection that bypasses the public schema', async () => {
    const adapter = createClientReportExportAdapter(db);
    await expect(adapter.compose(composeContext({ audit: false, ranks: false, gsc: false })))
      .rejects.toMatchObject({ status: 409, message: 'clientReports.errors.noSnapshot' });
  });
});

describe('client report export rendering', () => {
  it('renders immutable PDF and JSON and refuses unsupported native formats', async () => {
    const adapter = createClientReportExportAdapter(db);
    const result = await adapter.compose(composeContext({ audit: true, ranks: false, gsc: false }));
    for (const format of ['pdf', 'json'] as const) {
      await expect(adapter.render({
        document: result.document, format, snapshotCreatedAt: generatedAt,
      })).resolves.toMatchObject({ format, bytes: expect.any(Uint8Array) });
    }
    await expect(adapter.render({
      document: result.document, format: 'md', snapshotCreatedAt: generatedAt,
    })).rejects.toThrow('report output failed validation');
  });
});
