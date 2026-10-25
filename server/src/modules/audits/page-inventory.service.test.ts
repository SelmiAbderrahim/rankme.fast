import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
import { ReportSnapshot } from './report-snapshot.model.js';
import { readLatestAuditPageDetail, readLatestCompletedPageInventory } from './page-inventory.service.js';

const ACCOUNT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439013';
const SITE = '507f1f77bcf86cd799439012';

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);
beforeEach(clearCollections);

describe('audit page inventory public reader', () => {
  it('returns only the latest completed account/site run with a bounded projection', async () => {
    await AuditRun.create({ accountId: OTHER, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'failed', pageCap: 10, kind: 'site' });
    const run = await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await AuditedPage.create([
      { runId: run._id, url: 'https://example.com/b', statusCode: 200, title: 'B', isIndexable: false, nonIndexableReason: 'noindex', onPageScore: 50 },
      { runId: run._id, url: 'https://example.com/a', statusCode: 200, title: null, isIndexable: true, nonIndexableReason: null, onPageScore: 80 },
    ]);
    await AuditedPage.collection.updateOne({ runId: run._id, url: 'https://example.com/b' }, { $set: { onPageScore: null } });
    const result = await readLatestCompletedPageInventory(ACCOUNT, SITE, 1);
    expect(result).toMatchObject({ runId: String(run._id), fetchedCount: 2, truncated: true, rows: [{ url: 'https://example.com/a', title: null, isIndexable: true, onPageScore: 80 }] });
    expect((await readLatestCompletedPageInventory(ACCOUNT, SITE, 2)).rows[1]).toMatchObject({ title: 'B', isIndexable: false, nonIndexableReason: 'noindex', onPageScore: null });
  });

  it('returns an empty bounded inventory for malformed or absent ownership', async () => {
    await expect(readLatestCompletedPageInventory('bad', SITE)).resolves.toEqual({ runId: null, rows: [], fetchedCount: 0, truncated: false });
    await expect(readLatestCompletedPageInventory(ACCOUNT, SITE)).resolves.toEqual({ runId: null, rows: [], fetchedCount: 0, truncated: false });
  });
});

describe('latest audit page detail', () => {
  const isPage = (target: string) => (url: string) => url.replace(/\/$/, '') === target;
  const counts = { fixNow: 1, watch: 1, passed: 0 };

  async function seedSnapshot(runId: unknown, findings: Array<Record<string, unknown>>) {
    await ReportSnapshot.create({ runId, siteId: SITE, accountId: ACCOUNT, findings, counts });
  }

  it('returns the crawl facts and the open findings that name the page, directly or through a resource', async () => {
    const run = await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await AuditedPage.create([
      { runId: run._id, url: 'https://example.com/', statusCode: 200, onPageScore: 80, clickDepth: 0, inboundInternalLinks: 5, pageSizeBytes: 1000, serverResponseMs: 120, imageCount: 4 },
      { runId: run._id, url: 'https://example.com/other', statusCode: 200, onPageScore: 70 },
    ]);
    await seedSnapshot(run._id, [
      { ruleId: 'placeholder-text', bucket: 'fix-now', severity: 'critical', affectedUrls: ['https://example.com/'] },
      { ruleId: 'broken-resources', bucket: 'fix-now', severity: 'warning', affectedUrls: [], meta: { resources: [{ url: 'https://example.com/a.png', usedOn: ['https://example.com/', 7] }, null, { usedOn: 'x' }] } },
      { ruleId: 'orphan-pages', bucket: 'watch', severity: 'warning', affectedUrls: ['https://example.com/other'] },
      { ruleId: 'large-pages', bucket: 'passed', severity: 'info', affectedUrls: [] },
      { ruleId: 'duplicate-titles', bucket: 'watch', severity: 'warning', affectedUrls: ['https://example.com/'], meta: { insufficientData: true } },
      { ruleId: 'retired-rule', bucket: 'watch', severity: 'info', affectedUrls: ['https://example.com/'] },
      { ruleId: 'redirect-chains', bucket: 'watch', severity: 'warning', affectedUrls: [], meta: { resources: 'not-a-list' } },
    ]);
    const detail = await readLatestAuditPageDetail(ACCOUNT, SITE, isPage('https://example.com'), 'fr');
    expect(detail).toMatchObject({
      runId: String(run._id),
      facts: { clickDepth: 0, inboundInternalLinks: 5, pageSizeBytes: 1000, serverResponseMs: 120 },
    });
    expect(detail?.issues.map((issue) => [issue.ruleId, issue.bucket, issue.severity])).toEqual([
      ['placeholder-text', 'fix-now', 'critical'],
      ['broken-resources', 'fix-now', 'warning'],
    ]);
    expect(detail?.issues.every((issue) => issue.title.length > 0)).toBe(true);
    const other = await readLatestAuditPageDetail(ACCOUNT, SITE, isPage('https://example.com/other'), 'en');
    expect(other).toMatchObject({ facts: {}, issues: [{ ruleId: 'orphan-pages' }] });
  });

  it('is null without a completed run, a snapshot-independent page match, or valid ownership', async () => {
    await expect(readLatestAuditPageDetail('bad', SITE, () => true, 'en')).resolves.toBeNull();
    await expect(readLatestAuditPageDetail(ACCOUNT, 'bad', () => true, 'en')).resolves.toBeNull();
    await expect(readLatestAuditPageDetail(ACCOUNT, SITE, () => true, 'en')).resolves.toBeNull();
    await AuditRun.create({ accountId: OTHER, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await expect(readLatestAuditPageDetail(ACCOUNT, SITE, () => true, 'en')).resolves.toBeNull();
    const run = await AuditRun.create({ accountId: ACCOUNT, siteId: SITE, status: 'succeeded', pageCap: 10, kind: 'site' });
    await AuditedPage.create({ runId: run._id, url: 'https://example.com/a', statusCode: 200, onPageScore: 1 });
    await expect(readLatestAuditPageDetail(ACCOUNT, SITE, () => false, 'en')).resolves.toBeNull();
    // No frozen snapshot yet: the facts are served and there are no issues.
    await expect(readLatestAuditPageDetail(ACCOUNT, SITE, () => true, 'en')).resolves.toEqual({
      runId: String(run._id),
      facts: {},
      issues: [],
    });
  });
});
