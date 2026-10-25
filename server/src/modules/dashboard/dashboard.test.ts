import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth } from '../../shared/testing/auth.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import { gscSearchAnalytics } from '../../db/schema/gsc.js';
import { setRanksDb } from '../ranks/ranks.queue-holder.js';
import { Site } from '../sites/sites.model.js';
import { getSiteHealth } from './dashboard.service.js';
import { GoogleConnection } from '../google-connections/google-connection.model.js';
import { AuditRun, ReportSnapshot } from '../audits/index.js';

const app = createApp();

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  setRanksDb(db as never);
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setRanksDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('dashboard site summaries', () => {
  it('requires a verified session and returns only owned site ids', async () => {
    const owner = await signupVerifiedUser(app, { email: 'dashboard-owner@example.com' });
    const other = await signupVerifiedUser(app, { email: 'dashboard-other@example.com' });
    const mine = await Site.create({ accountId: owner.id, url: 'https://mine.example.com', domain: 'mine.example.com' });
    const foreign = await Site.create({ accountId: other.id, url: 'https://foreign.example.com', domain: 'foreign.example.com' });
    const ids = `${mine.id},${foreign.id}`;
    expect((await request(app).get(`/api/dashboard/site-summaries?ids=${ids}`)).status).toBe(401);
    const response = await request(app).get(`/api/dashboard/site-summaries?ids=${ids}`).set('Cookie', owner.cookie);
    expect(response.status).toBe(200);
    expect(response.body.summaries).toEqual([{ id: String(mine.id),
      lastAudit: { state: 'unavailable', reason: 'no_audit' },
      openFixNow: { state: 'unavailable', reason: 'no_audit' }, trackedKeywords: 0 }]);
  });

  it('counts active stored keywords without reading vendor data', async () => {
    const owner = await signupVerifiedUser(app, { email: 'dashboard-keywords@example.com' });
    const site = await Site.create({ accountId: owner.id, url: 'https://count.example.com', domain: 'count.example.com' });
    await getTestDb().insert(keywords).values([
      { accountId: owner.id, siteId: String(site.id), phrase: 'first', locationCode: 2840, languageCode: 'en', active: true },
      { accountId: owner.id, siteId: String(site.id), phrase: 'second', locationCode: 2840, languageCode: 'en', active: false },
    ]);
    const response = await request(app).get(`/api/dashboard/site-summaries?ids=${site.id}`).set('Cookie', owner.cookie);
    expect(response.status).toBe(200);
    expect(response.body.summaries[0].trackedKeywords).toBe(1);
  });

  it('uses the newest finished audit and the newest successful report', async () => {
    const owner = await signupVerifiedUser(app, { email: 'dashboard-audits@example.com' });
    const site = await Site.create({ accountId: owner.id, url: 'https://audits.example.com', domain: 'audits.example.com' });
    const first = await AuditRun.create({ accountId: owner.id, siteId: site.id, pageCap: 100,
      status: 'succeeded', finishedAt: new Date() });
    await ReportSnapshot.create({ accountId: owner.id, siteId: site.id, runId: first.id,
      counts: { fixNow: 1, watch: 0, passed: 0 }, findings: [{ ruleId: 'missing-title', bucket: 'fix-now',
        severity: 'critical', affectedUrls: [] }] });
    await AuditRun.create({ accountId: owner.id, siteId: site.id, pageCap: 100,
      status: 'failed', finishedAt: new Date() });
    const response = await request(app).get(`/api/dashboard/site-summaries?ids=${site.id}`).set('Cookie', owner.cookie);
    expect(response.status).toBe(200);
    expect(response.body.summaries[0].lastAudit).toMatchObject({ status: 'failed' });
    expect(response.body.summaries[0].openFixNow).toMatchObject({ count: 1 });
  });
});

describe('dashboard site health', () => {
  it('counts only visible owned sites and excludes paused metrics', async () => {
    const owner = await signupVerifiedUser(app, { email: 'health-owner@example.com' });
    const other = await signupVerifiedUser(app, { email: 'health-other@example.com' });
    const active = await Site.create({ accountId: owner.id, url: 'https://active.example.com', domain: 'active.example.com' });
    const paused = await Site.create({ accountId: owner.id, url: 'https://paused.example.com', domain: 'paused.example.com', paused: true });
    const foreign = await Site.create({ accountId: other.id, url: 'https://foreign.example.com', domain: 'foreign.example.com' });
    expect((await request(app).get('/api/dashboard/site-health')).status).toBe(401);
    const response = await request(app).get('/api/dashboard/site-health').set('Cookie', owner.cookie);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ limit: 10, totalSites: 2, activeSites: 1, pausedSites: 1, hasMore: false });
    expect(response.body.sites).toEqual([expect.objectContaining({ id: String(active.id),
      openFixNow: { state: 'unavailable', reason: 'no_audit' },
      rankMovement: { state: 'unavailable', reason: 'no_keywords', tracked: 0 } })]);
    expect(response.body.pausedList).toEqual([expect.objectContaining({ id: String(paused.id) })]);
    expect(JSON.stringify(response.body)).not.toContain(String(foreign.id));
  });

  it('shows failed rank checks even when no keyword has a comparison', async () => {
    const owner = await signupVerifiedUser(app, { email: 'health-failed-rank@example.com' });
    const site = await Site.create({ accountId: owner.id, url: 'https://failure.example.com', domain: 'failure.example.com' });
    const failedAt = new Date();
    await getTestDb().insert(keywords).values({ accountId: owner.id, siteId: String(site.id), phrase: 'failed check',
      locationCode: 2840, languageCode: 'en', lastFailedCheckAt: failedAt, lastFailedReason: 'vendor_timeout' });
    const response = await request(app).get('/api/dashboard/site-health').set('Cookie', owner.cookie);
    expect(response.status).toBe(200);
    expect(response.body.sites[0].rankMovement).toMatchObject({ state: 'value', tracked: 1, compared: 0,
      notCompared: { failed: 1, skipped: 0, noPair: 0 } });
  });

  it('omits sites outside a selected team scope from every count and list', async () => {
    const owner = await signupVerifiedUser(app, { email: 'health-scope@example.com' });
    const allowed = await Site.create({ accountId: owner.id, url: 'https://allowed.example.com', domain: 'allowed.example.com' });
    await Site.create({ accountId: owner.id, url: 'https://hidden.example.com', domain: 'hidden.example.com', paused: true });
    const response = await getSiteHealth({ accountId: owner.id, allowedSiteIds: [String(allowed.id)] }, getTestDb() as never);
    expect(response).toMatchObject({ totalSites: 1, activeSites: 1, pausedSites: 0, hasMore: false, pausedList: [] });
    expect(response.sites.map((row) => row.id)).toEqual([String(allowed.id)]);
  });

  it('uses only stored GSC rows from the current binding for a connected site', async () => {
    const owner = await signupVerifiedUser(app, { email: 'health-gsc@example.com' });
    const site = await Site.create({ accountId: owner.id, url: 'https://gsc.example.com', domain: 'gsc.example.com',
      gscPropertyUrl: 'sc-domain:gsc.example.com', gscBindingGenerationId: 'current' });
    await GoogleConnection.create({ accountId: owner.id, googleAccountEmail: 'health-gsc@example.com',
      encryptedRefreshToken: { ciphertext: 'x', iv: 'x', authTag: 'x', keyVersion: 1 },
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'], status: 'connected', connectedAt: new Date() });
    await getTestDb().insert(gscSearchAnalytics).values([
      { accountId: owner.id, siteId: String(site.id), bindingGenerationId: 'current', snapshotDate: '2026-10-22',
        dimensionSet: 'query', dimensionKey: 'one', clicks: 12, impressions: 40, ctr: 0.3, position: 4 },
      { accountId: owner.id, siteId: String(site.id), bindingGenerationId: 'current', snapshotDate: '2026-09-24',
        dimensionSet: 'query', dimensionKey: 'before', clicks: 3, impressions: 20, ctr: 0.15, position: 5 },
      { accountId: owner.id, siteId: String(site.id), bindingGenerationId: 'current', snapshotDate: '2026-10-21',
        dimensionSet: 'query', dimensionKey: 'overlap', clicks: 50, impressions: 60, ctr: 0.83, position: 2 },
      { accountId: owner.id, siteId: String(site.id), bindingGenerationId: 'old', snapshotDate: '2026-10-23',
        dimensionSet: 'query', dimensionKey: 'wrong', clicks: 99, impressions: 100, ctr: 0.99, position: 1 },
    ]);
    const response = await request(app).get('/api/dashboard/site-health').set('Cookie', owner.cookie);
    expect(response.status).toBe(200);
    expect(response.body.sites[0].searchTrend).toMatchObject({ clicks: 12, impressions: 40,
      previousClicks: 3, previousImpressions: 20, asOf: '2026-10-22', source: 'query' });
  });

  it('compares only the newest two stored rank checks per keyword', async () => {
    const owner = await signupVerifiedUser(app, { email: 'health-rank-history@example.com' });
    const site = await Site.create({ accountId: owner.id, url: 'https://rank-history.example.com', domain: 'rank-history.example.com' });
    const [keyword] = await getTestDb().insert(keywords).values({ accountId: owner.id, siteId: String(site.id),
      phrase: 'movement', locationCode: 2840, languageCode: 'en' }).returning({ id: keywords.id });
    await getTestDb().insert(rankings).values([
      { keywordId: keyword!.id, checkedAt: new Date('2026-10-24T00:00:00Z'), position: 8, source: 'fresh' },
      { keywordId: keyword!.id, checkedAt: new Date('2026-10-23T00:00:00Z'), position: 10, source: 'fresh' },
      { keywordId: keyword!.id, checkedAt: new Date('2026-10-22T00:00:00Z'), position: 1, source: 'fresh' },
    ]);
    const response = await request(app).get('/api/dashboard/site-health').set('Cookie', owner.cookie);
    expect(response.status).toBe(200);
    expect(response.body.sites[0].rankMovement).toMatchObject({ improved: 1, declined: 0,
      unchanged: 0, tracked: 1, compared: 1 });
  });

  it('prefers stored daily GSC totals over query snapshots', async () => {
    const owner = await signupVerifiedUser(app, { email: 'health-gsc-daily@example.com' });
    const site = await Site.create({ accountId: owner.id, url: 'https://daily.example.com', domain: 'daily.example.com',
      gscPropertyUrl: 'sc-domain:daily.example.com', gscBindingGenerationId: 'current' });
    await GoogleConnection.create({ accountId: owner.id, googleAccountEmail: 'health-gsc-daily@example.com',
      encryptedRefreshToken: { ciphertext: 'x', iv: 'x', authTag: 'x', keyVersion: 1 },
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'], status: 'connected', connectedAt: new Date() });
    await getTestDb().insert(gscSearchAnalytics).values([
      { accountId: owner.id, siteId: String(site.id), bindingGenerationId: 'current', snapshotDate: '2026-10-22',
        windowDays: 90, dimensionSet: 'date', dimensionKey: '2026-10-22', clicks: 4, impressions: 40, ctr: 0.1, position: 4 },
      { accountId: owner.id, siteId: String(site.id), bindingGenerationId: 'current', snapshotDate: '2026-10-22',
        windowDays: 90, dimensionSet: 'date', dimensionKey: '2026-09-24', clicks: 2, impressions: 20, ctr: 0.1, position: 5 },
      { accountId: owner.id, siteId: String(site.id), bindingGenerationId: 'current', snapshotDate: '2026-10-22',
        dimensionSet: 'query', dimensionKey: 'query', clicks: 99, impressions: 100, ctr: 0.99, position: 1 },
    ]);
    const response = await request(app).get('/api/dashboard/site-health').set('Cookie', owner.cookie);
    expect(response.status).toBe(200);
    expect(response.body.sites[0].searchTrend).toMatchObject({ clicks: 4, impressions: 40,
      previousClicks: 2, previousImpressions: 20, asOf: '2026-10-22', source: 'date' });
  });
});
