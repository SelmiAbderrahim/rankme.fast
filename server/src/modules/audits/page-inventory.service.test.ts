import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
import { readLatestCompletedPageInventory } from './page-inventory.service.js';

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
