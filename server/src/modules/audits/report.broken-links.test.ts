/**
 * The report carries every source → target pair behind a
 * broken-links finding with the result of re-requesting the target, the
 * dismissed ones included, and the export carries the same rows.
 */
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { Site } from '../sites/index.js';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
import {
  BROKEN_LINK_EVIDENCE_API_PREVIEW,
  BROKEN_LINK_EVIDENCE_REPORT_MAX,
  getAuditReport,
  getLatestSiteReport,
  readBrokenLinkEvidence,
  writeReportSnapshot,
} from './report.service.js';
import { auditReportExportTestables } from './report-export.adapter.js';
import { makeAuditResult } from './rules/fixtures.js';

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
beforeEach(() => clearCollections());

async function seedRun() {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({ accountId, url: 'https://example.com', domain: 'example.com' });
  const run = await AuditRun.create({ accountId, siteId: site._id, pageCap: 100, status: 'queued' });
  return { accountId: accountId.toHexString(), siteId: site.id as string, runId: run.id as string };
}

const page = (runId: string, url: string, extra: Record<string, unknown> = {}) => ({
  runId,
  url,
  statusCode: 200,
  onPageScore: 80,
  ...extra,
});

describe('readBrokenLinkEvidence', () => {
  it('lists confirmed targets first and dismissed ones last, with a row per source page', async () => {
    const ids = await seedRun();
    await AuditedPage.insertMany([
      page(ids.runId, 'https://example.com/a', {
        brokenLinks: ['https://example.com/gone', 'https://example.com/legacy'],
        brokenLinkEvidence: [
          { target: 'https://example.com/pricing', outcome: 'cleared', status: 200, finalUrl: 'https://example.com/en/pricing' },
          { target: 'https://example.com/gone', outcome: 'confirmed', status: 404, failure: 'http_error' },
        ],
      }),
      page(ids.runId, 'https://example.com/b', {
        brokenLinks: ['https://example.com/guarded'],
        brokenLinkEvidence: [{ target: 'https://example.com/guarded', outcome: 'unverified', status: 403, failure: 'http_error' }],
      }),
      page(ids.runId, 'https://example.com/clean'),
    ]);
    const { rows, total } = await readBrokenLinkEvidence(new mongoose.Types.ObjectId(ids.runId));
    expect(total).toBe(4);
    expect(rows.map((r) => [r.source, r.target, r.outcome, r.status])).toEqual([
      ['https://example.com/a', 'https://example.com/gone', 'confirmed', 404],
      ['https://example.com/b', 'https://example.com/guarded', 'unverified', 403],
      ['https://example.com/a', 'https://example.com/legacy', 'reported', null],
      ['https://example.com/a', 'https://example.com/pricing', 'cleared', 200],
    ]);
    expect(rows[0]).toMatchObject({ failure: 'http_error' });
    expect(rows[3]).toMatchObject({ finalUrl: 'https://example.com/en/pricing' });
    expect(rows[2]).not.toHaveProperty('failure');
  });

  it('reads a stored page that predates the evidence fields and a failure with no HTTP status', async () => {
    const ids = await seedRun();
    // Written straight to the collection: no schema defaults, as an old run would be.
    await AuditedPage.collection.insertOne({
      runId: new mongoose.Types.ObjectId(ids.runId),
      url: 'https://example.com/old',
      statusCode: 200,
      onPageScore: 1,
      brokenLinks: ['https://example.com/x'],
    });
    await AuditedPage.collection.insertOne({
      runId: new mongoose.Types.ObjectId(ids.runId),
      url: 'https://example.com/no-links-field',
      statusCode: 200,
      onPageScore: 1,
      brokenLinkEvidence: [{ target: 'https://example.com/loop', outcome: 'confirmed', failure: 'redirect_loop' }],
    });
    const { rows } = await readBrokenLinkEvidence(new mongoose.Types.ObjectId(ids.runId));
    expect(rows).toEqual([
      { source: 'https://example.com/no-links-field', target: 'https://example.com/loop', outcome: 'confirmed', status: null, failure: 'redirect_loop' },
      { source: 'https://example.com/old', target: 'https://example.com/x', outcome: 'reported', status: null },
    ]);
  });

  it('bounds the rows it returns but reports the true total', async () => {
    const ids = await seedRun();
    const targets = Array.from({ length: BROKEN_LINK_EVIDENCE_REPORT_MAX + 25 }, (_, i) => `https://example.com/t/${i}`);
    await AuditedPage.insertMany([page(ids.runId, 'https://example.com/a', { brokenLinks: targets })]);
    const { rows, total } = await readBrokenLinkEvidence(new mongoose.Types.ObjectId(ids.runId));
    expect(rows).toHaveLength(BROKEN_LINK_EVIDENCE_REPORT_MAX);
    expect(total).toBe(BROKEN_LINK_EVIDENCE_REPORT_MAX + 25);
  });

  it('returns nothing for a run without broken links', async () => {
    const ids = await seedRun();
    await AuditedPage.insertMany([page(ids.runId, 'https://example.com/a')]);
    expect(await readBrokenLinkEvidence(new mongoose.Types.ObjectId(ids.runId))).toEqual({ rows: [], total: 0 });
  });
});

describe('getAuditReport broken-link evidence', () => {
  it('attaches the evidence to the finding, and the true total when it was cut', async () => {
    const ids = await seedRun();
    const brokenPage = {
      url: 'https://example.com/a',
      brokenLinks: ['https://example.com/gone'],
      brokenLinkEvidence: [
        { target: 'https://example.com/gone', outcome: 'confirmed' as const, status: 404, failure: 'http_error' as const },
        { target: 'https://example.com/pricing', outcome: 'cleared' as const, status: 200 },
      ],
    };
    await writeReportSnapshot({ ...ids, result: makeAuditResult({ pages: [brokenPage] }) });
    await AuditedPage.insertMany([page(ids.runId, brokenPage.url, brokenPage)]);
    const report = await getAuditReport({ runId: ids.runId, accountId: ids.accountId, locale: 'en' });
    const finding = report.findings.find((f) => f.ruleId === 'broken-internal-links')!;
    expect(finding.brokenLinkEvidence).toHaveLength(2);
    expect(finding.brokenLinkEvidence![0]).toMatchObject({ outcome: 'confirmed', source: brokenPage.url });
    expect(finding).not.toHaveProperty('brokenLinkEvidenceTotal');
    // Other findings never carry it.
    expect(report.findings.filter((f) => 'brokenLinkEvidence' in f)).toHaveLength(1);
  });

  it('still shows what was dismissed when the finding passed after re-checking', async () => {
    const ids = await seedRun();
    const cleared = {
      url: 'https://example.com/a',
      brokenLinks: [],
      brokenLinkEvidence: [{ target: 'https://example.com/pricing', outcome: 'cleared' as const, status: 200 }],
    };
    await writeReportSnapshot({ ...ids, result: makeAuditResult({ pages: [cleared] }) });
    await AuditedPage.insertMany([page(ids.runId, cleared.url, cleared)]);
    const report = await getAuditReport({ runId: ids.runId, accountId: ids.accountId, locale: 'en' });
    const finding = report.findings.find((f) => f.ruleId === 'broken-internal-links')!;
    expect(finding.bucket).toBe('passed');
    expect(finding.meta).toEqual({ clearedTargets: 1 });
    expect(finding.brokenLinkEvidence).toEqual([
      { source: cleared.url, target: 'https://example.com/pricing', outcome: 'cleared', status: 200 },
    ]);
  });

  it('flags a cut-off evidence list with its total', async () => {
    const ids = await seedRun();
    const targets = Array.from({ length: BROKEN_LINK_EVIDENCE_REPORT_MAX + 3 }, (_, i) => `https://example.com/t/${i}`);
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult({ pages: [{ url: 'https://example.com/a', brokenLinks: ['https://example.com/t/0'] }] }),
    });
    await AuditedPage.insertMany([page(ids.runId, 'https://example.com/a', { brokenLinks: targets })]);
    const report = await getAuditReport({ runId: ids.runId, accountId: ids.accountId, locale: 'en' });
    const finding = report.findings.find((f) => f.ruleId === 'broken-internal-links')!;
    expect(finding.brokenLinkEvidence).toHaveLength(BROKEN_LINK_EVIDENCE_REPORT_MAX);
    expect(finding.brokenLinkEvidenceTotal).toBe(BROKEN_LINK_EVIDENCE_REPORT_MAX + 3);
  });

  it('gives the public API and MCP a preview with the true total, while the report keeps every row', async () => {
    const ids = await seedRun();
    await AuditRun.updateOne({ _id: ids.runId }, { $set: { status: 'succeeded' } });
    const targets = Array.from({ length: BROKEN_LINK_EVIDENCE_API_PREVIEW + 50 }, (_, i) => `https://example.com/t/${i}`);
    await writeReportSnapshot({
      ...ids,
      result: makeAuditResult({ pages: [{ url: 'https://example.com/a', brokenLinks: ['https://example.com/t/0'] }] }),
    });
    await AuditedPage.insertMany([page(ids.runId, 'https://example.com/a', { brokenLinks: targets })]);

    const latest = await getLatestSiteReport({ accountId: ids.accountId, siteId: ids.siteId, locale: 'en' });
    const preview = latest.report.findings.find((f) => f.ruleId === 'broken-internal-links')!;
    expect(preview.brokenLinkEvidence).toHaveLength(BROKEN_LINK_EVIDENCE_API_PREVIEW);
    expect(preview.brokenLinkEvidenceTotal).toBe(BROKEN_LINK_EVIDENCE_API_PREVIEW + 50);

    const full = await getAuditReport({ runId: ids.runId, accountId: ids.accountId, locale: 'en' });
    expect(full.findings.find((f) => f.ruleId === 'broken-internal-links')!.brokenLinkEvidence).toHaveLength(
      BROKEN_LINK_EVIDENCE_API_PREVIEW + 50,
    );
  });

  it('adds no evidence when there are no stored pages for the finding', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const report = await getAuditReport({ runId: ids.runId, accountId: ids.accountId, locale: 'en' });
    expect(report.findings.some((f) => 'brokenLinkEvidence' in f)).toBe(false);
  });
});

describe('audit export of broken-link evidence', () => {
  it('writes one table row per source → target pair, dismissed ones included', async () => {
    const ids = await seedRun();
    const pageWithEvidence = {
      url: 'https://example.com/a',
      brokenLinks: ['https://example.com/gone'],
      brokenLinkEvidence: [
        { target: 'https://example.com/gone', outcome: 'confirmed' as const, status: 404, failure: 'http_error' as const },
        { target: 'https://example.com/pricing', outcome: 'cleared' as const, status: 200, finalUrl: 'https://example.com/en/pricing' },
      ],
    };
    await writeReportSnapshot({ ...ids, result: makeAuditResult({ pages: [pageWithEvidence] }) });
    await AuditedPage.insertMany([page(ids.runId, pageWithEvidence.url, pageWithEvidence)]);
    const report = await getAuditReport({ runId: ids.runId, accountId: ids.accountId, locale: 'en' });
    const { blocks } = auditReportExportTestables.auditBlocks('en', report, {
      buckets: ['fixNow', 'watch', 'passed'],
      sections: ['findings'],
    });
    const table = blocks.find((block) => block.id === 'audit-broken-link-evidence');
    expect(table?.type).toBe('table');
    if (table?.type !== 'table') throw new Error('expected a table block');
    expect(table.columns.map((column) => column.key)).toEqual(['source', 'target', 'outcome', 'status', 'failure', 'final-url']);
    const cells = table.rows.map((row) => row.cells.map((cell) => cell.value.value));
    expect(cells).toEqual([
      ['https://example.com/a', 'https://example.com/gone', 'confirmed', 404, 'http_error', null],
      ['https://example.com/a', 'https://example.com/pricing', 'cleared', 200, null, 'https://example.com/en/pricing'],
    ]);
  });

  it('keeps a CSV to its single canonical table by leaving the evidence table out', async () => {
    const ids = await seedRun();
    const pageWithEvidence = {
      url: 'https://example.com/a',
      brokenLinks: ['https://example.com/gone'],
      brokenLinkEvidence: [
        { target: 'https://example.com/gone', outcome: 'confirmed' as const, status: 404, failure: 'http_error' as const },
      ],
    };
    await writeReportSnapshot({ ...ids, result: makeAuditResult({ pages: [pageWithEvidence] }) });
    await AuditedPage.insertMany([page(ids.runId, pageWithEvidence.url, pageWithEvidence)]);
    const report = await getAuditReport({ runId: ids.runId, accountId: ids.accountId, locale: 'en' });
    const selection = { buckets: ['fixNow', 'watch', 'passed'] as ('fixNow' | 'watch' | 'passed')[], sections: ['findings' as const] };
    const csv = auditReportExportTestables.auditBlocks('en', report, selection, 'csv');
    expect(csv.blocks.filter((block) => block.type === 'table').map((block) => block.id)).toEqual(['audit-diff']);
    const pdf = auditReportExportTestables.auditBlocks('en', report, selection, 'pdf');
    expect(pdf.blocks.some((block) => block.id === 'audit-broken-link-evidence')).toBe(true);
  });

  it('adds no table for a report without broken-link evidence', async () => {
    const ids = await seedRun();
    await writeReportSnapshot({ ...ids, result: makeAuditResult() });
    const report = await getAuditReport({ runId: ids.runId, accountId: ids.accountId, locale: 'en' });
    const { blocks } = auditReportExportTestables.auditBlocks('en', report, {
      buckets: ['fixNow', 'watch', 'passed'],
      sections: ['findings'],
    });
    expect(blocks.some((block) => block.id === 'audit-broken-link-evidence')).toBe(false);
  });
});
