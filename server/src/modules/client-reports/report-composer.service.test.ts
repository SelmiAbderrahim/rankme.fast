import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  auditRunFindOne: vi.fn(),
  reportSnapshotFindOne: vi.fn(),
  getAuditReport: vi.fn(),
  latestGscDate: vi.fn(),
  readGsc: vi.fn(),
  readRanks: vi.fn(),
  readRankProjection: vi.fn(),
  siteFindOne: vi.fn(),
  userFindById: vi.fn(),
}));

vi.mock('../audits/index.js', () => ({
  AuditRun: { findOne: mocked.auditRunFindOne },
  ReportSnapshot: { findOne: mocked.reportSnapshotFindOne },
  getAuditReport: mocked.getAuditReport,
}));

vi.mock('../gsc-snapshots/index.js', () => ({
  readLatestSnapshotDate: mocked.latestGscDate,
  readSearchAnalytics: mocked.readGsc,
}));

vi.mock('../ranks/index.js', () => ({
  readClientReportRankProjection: mocked.readRankProjection,
  readClientReportRankRows: mocked.readRanks,
}));

vi.mock('../sites/index.js', () => ({
  Site: { findOne: mocked.siteFindOne },
}));

vi.mock('../users/users.model.js', () => ({
  User: { findById: mocked.userFindById },
  resolveStoredUserBranding: vi.fn(() => ({
    companyName: 'Agency',
    accentColor: '#112233',
    logoPngBase64: '',
    logoWidth: null,
    logoHeight: null,
  })),
}));

import {
  composeClientReport,
  inspectClientReportCompleteness,
  type ClientReportSnapshot,
  type ComposeClientReportInput,
} from './report-composer.service.js';

const INPUT: ComposeClientReportInput = {
  accountId: 'account-1',
  siteId: 'site-1',
  locale: 'en',
  sections: { audit: false, ranks: false, gsc: false },
};

function query(value: unknown) {
  const chain = {
    sort: vi.fn(() => chain),
    select: vi.fn(() => chain),
    lean: vi.fn().mockResolvedValue(value),
  };
  return chain;
}

function report(findings: Array<{ affectedUrls: string[] }> = []) {
  return {
    counts: { fixNow: findings.length, watch: 0, passed: 0 },
    findings: findings.map((finding, index) => ({
      ruleId: `rule-${index}`,
      bucket: 'fix-now',
      severity: 'high',
      affectedUrls: finding.affectedUrls,
      copy: { title: 'Title', why: 'Why', fix: 'Fix' },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.siteFindOne.mockReturnValue(query({
    displayName: 'Site',
    domain: 'example.test',
    gscPropertyUrl: 'sc-domain:example.test',
    gscBindingGenerationId: 'legacy',
  }));
  mocked.userFindById.mockReturnValue(query(null));
  mocked.reportSnapshotFindOne.mockReturnValue(query(null));
  mocked.auditRunFindOne.mockReturnValue(query(null));
  mocked.getAuditReport.mockResolvedValue(report());
  mocked.readRanks.mockResolvedValue([]);
  mocked.readRankProjection.mockResolvedValue({ totalRows: 0 });
  mocked.latestGscDate.mockResolvedValue(null);
  mocked.readGsc.mockResolvedValue([]);
});

describe('client report composition', () => {
  it('404s a missing site before reading any report source', async () => {
    mocked.siteFindOne.mockReturnValueOnce(query(null));
    await expect(composeClientReport(INPUT, {} as never)).rejects.toMatchObject({
      status: 404,
      message: 'sites.errors.notFound',
    });
  });

  it('rejects a selection with no dated source', async () => {
    await expect(composeClientReport(INPUT, {} as never)).rejects.toMatchObject({
      status: 409,
      message: 'clientReports.errors.noSnapshot',
    });
  });

  it('ignores an audit snapshot whose successful run disappeared', async () => {
    mocked.reportSnapshotFindOne.mockReturnValueOnce(query({
      runId: 'run-1',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    }));
    mocked.auditRunFindOne.mockReturnValueOnce(query(null));
    await expect(
      composeClientReport({ ...INPUT, sections: { ...INPUT.sections, audit: true } }, {} as never),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('ignores empty rank and GSC selections at each read boundary', async () => {
    await expect(
      composeClientReport({ ...INPUT, sections: { audit: false, ranks: true, gsc: false } }, {} as never),
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      composeClientReport({ ...INPUT, sections: { audit: false, ranks: false, gsc: true } }, {} as never),
    ).rejects.toMatchObject({ status: 409 });

    mocked.latestGscDate.mockResolvedValueOnce('2026-08-01');
    mocked.readGsc.mockResolvedValueOnce([]);
    await expect(
      composeClientReport({ ...INPUT, sections: { audit: false, ranks: false, gsc: true } }, {} as never),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('composes every selected section with deterministic zero-impression ordering', async () => {
    mocked.siteFindOne.mockReturnValueOnce(query({
      displayName: '  ',
      domain: 'example.test',
      gscPropertyUrl: 'sc-domain:example.test',
      gscBindingGenerationId: 'legacy',
    }));
    mocked.reportSnapshotFindOne.mockReturnValueOnce(query({
      runId: 'run-1',
      createdAt: new Date('2026-08-02T00:00:00.000Z'),
    }));
    mocked.auditRunFindOne.mockReturnValueOnce(query({ finishedAt: null }));
    mocked.getAuditReport.mockResolvedValueOnce(report([{ affectedUrls: ['a'] }]));
    mocked.readRanks.mockResolvedValueOnce([{
      keyword: 'rank', engine: 'google', position: 2, checkedAt: '2026-08-03T00:00:00.000Z',
    }]);
    mocked.latestGscDate.mockResolvedValueOnce('2026-08-04');
    mocked.readGsc.mockResolvedValueOnce([
      { dimensionKey: 'zeta', clicks: 2, impressions: 0, ctr: 0, position: 0 },
      { dimensionKey: 'alpha', clicks: 2, impressions: 0, ctr: 0, position: 0 },
    ]);

    await expect(
      composeClientReport({
        ...INPUT,
        sections: { audit: true, ranks: true, gsc: true },
      }, {} as never),
    ).resolves.toMatchObject({
      siteLabel: 'example.test',
      generatedAt: '2026-08-04T00:00:00.000Z',
      sections: {
        gsc: {
          averageCtr: 0,
          averagePosition: 0,
          topQueries: [{ query: 'alpha' }, { query: 'zeta' }],
        },
      },
    });
  });

  it('reads legacy GSC rows when a bound site has no generation id', async () => {
    mocked.siteFindOne.mockReturnValueOnce(query({
      displayName: 'Site',
      domain: 'example.test',
      gscPropertyUrl: 'sc-domain:example.test',
    }));
    mocked.latestGscDate.mockResolvedValueOnce('2026-08-04');
    mocked.readGsc.mockResolvedValueOnce([{
      dimensionKey: 'legacy query', clicks: 1, impressions: 10, ctr: 0.1, position: 3,
    }]);

    await composeClientReport(
      { ...INPUT, sections: { audit: false, ranks: false, gsc: true } },
      {} as never,
    );

    expect(mocked.latestGscDate).toHaveBeenCalledWith(
      expect.anything(), 'site-1', 'query', 28, 'legacy',
    );
  });

  it('does not read GSC rows when the site property is disconnected', async () => {
    mocked.siteFindOne.mockReturnValueOnce(query({
      displayName: 'Site',
      domain: 'example.test',
      gscPropertyUrl: null,
      gscBindingGenerationId: null,
    }));

    await expect(composeClientReport(
      { ...INPUT, sections: { audit: false, ranks: false, gsc: true } },
      {} as never,
    )).rejects.toMatchObject({ status: 409 });
    expect(mocked.latestGscDate).not.toHaveBeenCalled();
  });
});

describe('client report completeness inspection', () => {
  const snapshot = (audit: ClientReportSnapshot['sections']['audit']): ClientReportSnapshot => ({
    siteLabel: 'Site',
    siteDomain: 'example.test',
    locale: 'en',
    branding: {} as never,
    generatedAt: '2026-08-01T00:00:00.000Z',
    sections: { audit, ranks: null, gsc: null },
  });

  it('returns zeros when no complete-count source is selected', async () => {
    await expect(
      inspectClientReportCompleteness(INPUT, snapshot(null), {} as never),
    ).resolves.toEqual({ auditFindings: 0, maxAffectedUrls: 0, rankRows: 0, gscQueries: 0 });
  });

  it('counts full audit/rank sources and tolerates a missing GSC snapshot', async () => {
    mocked.readRankProjection.mockResolvedValueOnce({ totalRows: 27 });
    const audit = {
      snapshotDate: '2026-08-01T00:00:00.000Z',
      report: report([{ affectedUrls: ['a'] }, { affectedUrls: ['a', 'b', 'c'] }]),
    } as never;
    await expect(
      inspectClientReportCompleteness(
        { ...INPUT, sections: { audit: true, ranks: true, gsc: true } },
        snapshot(audit),
        {} as never,
      ),
    ).resolves.toEqual({ auditFindings: 2, maxAffectedUrls: 3, rankRows: 27, gscQueries: 0 });
  });

  it('counts every query from the latest GSC snapshot', async () => {
    mocked.latestGscDate.mockResolvedValueOnce('2026-08-05');
    mocked.readGsc.mockResolvedValueOnce([{ dimensionKey: 'a' }, { dimensionKey: 'b' }]);
    await expect(
      inspectClientReportCompleteness(
        { ...INPUT, sections: { audit: false, ranks: false, gsc: true } },
        snapshot(null),
        {} as never,
      ),
    ).resolves.toEqual({ auditFindings: 0, maxAffectedUrls: 0, rankRows: 0, gscQueries: 2 });
  });

  it('uses legacy generation ids during completeness inspection', async () => {
    mocked.siteFindOne.mockReturnValueOnce(query({
      gscPropertyUrl: 'sc-domain:example.test',
    }));
    mocked.latestGscDate.mockResolvedValueOnce('2026-08-05');
    mocked.readGsc.mockResolvedValueOnce([{ dimensionKey: 'legacy' }]);

    await expect(inspectClientReportCompleteness(
      { ...INPUT, sections: { audit: false, ranks: false, gsc: true } },
      snapshot(null),
      {} as never,
    )).resolves.toMatchObject({ gscQueries: 1 });
    expect(mocked.latestGscDate).toHaveBeenCalledWith(
      expect.anything(), 'site-1', 'query', 28, 'legacy',
    );
  });

  it('skips GSC completeness reads for missing and disconnected sites', async () => {
    mocked.siteFindOne
      .mockReturnValueOnce(query({ gscPropertyUrl: null, gscBindingGenerationId: null }))
      .mockReturnValueOnce(query(null));
    const input = { ...INPUT, sections: { audit: false, ranks: false, gsc: true } };

    await expect(inspectClientReportCompleteness(input, snapshot(null), {} as never))
      .resolves.toMatchObject({ gscQueries: 0 });
    await expect(inspectClientReportCompleteness(input, snapshot(null), {} as never))
      .resolves.toMatchObject({ gscQueries: 0 });
    expect(mocked.latestGscDate).not.toHaveBeenCalled();
  });
});
