/**
 * Router-level contract of finding decisions on the report:
 *   - the latest view and the pinned-run view of one run read the same
 *     decisions, counts and "not counted" line; dismiss and restore move
 *     both; the AI summary goes stale when they change;
 *   - the report names the site's newest run (`latestRunId`);
 *   - dismissal reason, resurfacing on growth, targeted re-check.
 * Every new or changed route answers 404 to another account.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Job, Queue } from 'bullmq';
import { createApp } from '../../app.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import type { PageProbeResult, PageProber } from '../../shared/security/site-probe.js';
import { hashActionId } from '../actions/actions.identity.js';
import { Site, setSitesDb } from '../sites/index.js';
import { setAuditsQueue } from './audits.queue-holder.js';
import { setSummaryDb } from './summary.db-holder.js';
import { setSummaryProvider } from './summary.holder.js';
import { AuditRun } from './audit-run.model.js';
import { ReportSnapshot } from './report-snapshot.model.js';
import { FindingDismissal } from './finding-dismissal.model.js';
import { setFindingRecheckProber } from './finding-recheck.service.js';
import { generateAuditSummary } from './summary.service.js';
import { createFakeSummaryProvider } from '../../shared/providers/index.js';

const app = createApp();

interface StoredFinding {
  ruleId: string;
  bucket: 'fix-now' | 'watch' | 'passed' | 'not-evaluated';
  severity: 'critical' | 'warning' | 'info';
  affectedUrls: string[];
  meta?: Record<string, unknown>;
}

const pages = (n: number, prefix = 'p') =>
  Array.from({ length: n }, (_, i) => `https://episodebrief.example/${prefix}${i}`);

const broken = (sources: number, targets: string[]): StoredFinding => ({
  ruleId: 'broken-internal-links',
  bucket: 'fix-now',
  severity: 'critical',
  affectedUrls: pages(sources),
  meta: { brokenLinkTargets: targets },
});

const titles = (n: number): StoredFinding => ({
  ruleId: 'title-missing-or-weak',
  bucket: 'watch',
  severity: 'warning',
  affectedUrls: pages(n, 't'),
});

function fakeQueue(): Queue {
  return {
    async add(_name: string, _data: unknown, opts: { jobId?: string }): Promise<Job> {
      return { id: opts.jobId } as Job;
    },
  } as unknown as Queue;
}

async function addSite(user: TestUser): Promise<string> {
  const site = await Site.create({ accountId: user.id, url: 'https://episodebrief.example', domain: 'episodebrief.example' });
  return site.id as string;
}

let clock = Date.parse('2026-08-20T19:00:00.000Z');
async function storeRun(user: TestUser, siteId: string, findings: StoredFinding[]): Promise<string> {
  clock += 3_600_000;
  const doc = await AuditRun.create({
    accountId: user.id,
    siteId,
    pageCap: 100,
    pagesCrawled: 50,
    status: 'succeeded',
    startedAt: new Date(clock - 420_000),
    finishedAt: new Date(clock),
  });
  await ReportSnapshot.create({
    runId: doc._id,
    siteId,
    accountId: user.id,
    findings,
    counts: { fixNow: 0, watch: 0, passed: 0, notEvaluated: 0 },
  });
  return doc.id as string;
}

const actionId = (user: TestUser, siteId: string, ruleId: string) =>
  hashActionId({ accountId: user.id, siteId, sourceType: 'audit_finding', sourceId: ruleId });

async function decide(
  user: TestUser,
  siteId: string,
  ruleId: string,
  body: { state: string; expectedVersion: number; reason?: string },
) {
  return request(app)
    .post(`/api/sites/${siteId}/actions/${actionId(user, siteId, ruleId)}/state`)
    .set('Cookie', user.cookie)
    .send({ clientKey: `${body.state}-${body.expectedVersion}`, ...body });
}

const report = (user: TestUser, siteId: string, runId: string) =>
  request(app).get(`/api/audits/${runId}/report`).set('Cookie', user.cookie);

const probeResult = (url: string, over: Partial<PageProbeResult>): PageProbeResult => ({
  url,
  statusCode: null,
  finalUrl: null,
  redirectChain: [],
  contentType: null,
  failure: null,
  ...over,
});

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setSummaryDb(getTestDb() as unknown as never);
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setSummaryDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setAuditsQueue(fakeQueue());
});

afterEach(() => {
  setAuditsQueue(null);
  setFindingRecheckProber(null);
  setSummaryProvider(null);
  vi.restoreAllMocks();
});

describe('one decision overlay for every view of a run', () => {
  it('reads the same counts, decisions and "not counted" line for the latest and the pinned view', async () => {
    const owner = await signupVerifiedUser(app, { email: 'dismiss@x.co' });
    const siteId = await addSite(owner);
    const runId = await storeRun(owner, siteId, [broken(65, pages(3, 'gone')), titles(18)]);

    const dismissed = await decide(owner, siteId, 'broken-internal-links', {
      state: 'dismissed',
      expectedVersion: 0,
      reason: 'false_positive',
    });
    expect(dismissed.status).toBe(200);
    const stored = await FindingDismissal.findOne({ siteId, ruleId: 'broken-internal-links' }).lean();
    expect(stored).toMatchObject({ reason: 'false_positive', affectedCount: 65, runId, actorUserId: owner.id });

    // The client's latest view and its pinned view read the same endpoint.
    const latest = await report(owner, siteId, runId);
    const pinned = await report(owner, siteId, runId);
    expect(latest.status).toBe(200);
    expect(pinned.body.openCounts).toEqual(latest.body.openCounts);
    expect(latest.body.latestRunId).toBe(runId);
    expect(latest.body.counts).toMatchObject({ fixNow: 1, watch: 1 });
    expect(latest.body.openCounts).toMatchObject({ fixNow: 0, watch: 1 });
    expect(latest.body.notCounted).toEqual({ dismissed: 1, completed: 0 });
    const decision = (latest.body.findings as Array<{ ruleId: string; decision?: Record<string, unknown> }>).find(
      (f) => f.ruleId === 'broken-internal-links',
    )?.decision;
    expect(decision).toMatchObject({
      state: 'dismissed',
      reason: 'false_positive',
      decidedBy: 'Test User',
      affectedCountAtDismissal: 65,
      latest: { runId, detected: true, affectedCount: 65 },
      resurfaced: null,
      recheckable: true,
      recheck: null,
    });

    // Restore puts it back in the counts of every view.
    expect((await decide(owner, siteId, 'broken-internal-links', { state: 'open', expectedVersion: 1 })).status).toBe(200);
    const restored = await report(owner, siteId, runId);
    expect(restored.body.openCounts).toMatchObject({ fixNow: 1, watch: 1 });
    expect(restored.body.notCounted).toEqual({ dismissed: 0, completed: 0 });
  });

  it('names the newest run on an older report and resurfaces a dismissal whose page count grew', async () => {
    const owner = await signupVerifiedUser(app, { email: 'resurface@x.co' });
    const siteId = await addSite(owner);
    const olderRunId = await storeRun(owner, siteId, [broken(2, pages(1, 'gone')), titles(4)]);
    await decide(owner, siteId, 'broken-internal-links', { state: 'dismissed', expectedVersion: 0, reason: 'other' });
    await decide(owner, siteId, 'title-missing-or-weak', { state: 'completed', expectedVersion: 0 });
    const newerRunId = await storeRun(owner, siteId, [broken(14, pages(2, 'gone')), titles(4)]);

    const older = await report(owner, siteId, olderRunId);
    expect(older.status).toBe(200);
    expect(older.body.latestRunId).toBe(newerRunId);
    const byRule = Object.fromEntries(
      (older.body.findings as Array<{ ruleId: string; decision?: Record<string, unknown> }>).map((f) => [f.ruleId, f.decision]),
    );
    // Dismissed when the newest audit counted 2 pages; it now counts 14.
    expect(byRule['broken-internal-links']).toMatchObject({
      state: 'dismissed',
      affectedCountAtDismissal: 2,
      latest: { runId: newerRunId, detected: true, affectedCount: 14 },
      resurfaced: { addedCount: 12 },
    });
    // Resurfaced = counted; the fixed title finding is not.
    expect(older.body.openCounts).toMatchObject({ fixNow: 1, watch: 0 });
    expect(older.body.notCounted).toEqual({ dismissed: 0, completed: 1 });
  });

  it('marks a stored summary stale when a dismissal changes its inputs', async () => {
    const owner = await signupVerifiedUser(app, { email: 'stale@x.co' });
    const siteId = await addSite(owner);
    const runId = await storeRun(owner, siteId, [broken(3, pages(1, 'gone')), titles(2)]);
    const summary = await generateAuditSummary(
      { accountId: owner.id, runId, locale: 'en', generationId: 'gen-1' },
      { provider: createFakeSummaryProvider(), db: getTestDb() as never },
    );
    expect(summary.inputHash).toMatch(/^[a-f0-9]{64}$/u);
    await ReportSnapshot.updateOne({ runId }, { $set: { 'aiSummaryVariantsByLocale.en': { ...summary, createdAt: new Date(summary.createdAt) } } });
    setSummaryProvider(createFakeSummaryProvider());

    const fresh = await report(owner, siteId, runId);
    expect(fresh.body.aiSummaryFreshness).toMatchObject({ stale: false });
    await decide(owner, siteId, 'broken-internal-links', { state: 'dismissed', expectedVersion: 0, reason: 'wont_fix' });
    const stale = await report(owner, siteId, runId);
    expect(stale.body.aiSummaryFreshness).toMatchObject({ stale: true, reason: 'triage_changed' });
  });
});

describe('targeted re-check of a dismissed finding', () => {
  it('previews without requesting, re-requests the stored targets, stores the result, and honours the cooldown', async () => {
    const owner = await signupVerifiedUser(app, { email: 'recheck@x.co' });
    const siteId = await addSite(owner);
    const targets = ['https://episodebrief.example/en/terms', 'https://episodebrief.example/ok', 'https://episodebrief.example/slow'];
    const runId = await storeRun(owner, siteId, [broken(65, targets)]);
    await decide(owner, siteId, 'broken-internal-links', { state: 'dismissed', expectedVersion: 0, reason: 'false_positive' });

    const probe = vi.fn(async (url: string) =>
      url.endsWith('/terms')
        ? probeResult(url, { statusCode: 500 })
        : url.endsWith('/ok')
          ? probeResult(url, { statusCode: 200, finalUrl: url })
          : probeResult(url, { failure: { kind: 'timeout' } }),
    );
    setFindingRecheckProber({ probe } as PageProber);
    const path = `/api/audits/${runId}/findings/broken-internal-links/recheck`;

    const preview = await request(app).get(path).set('Cookie', owner.cookie);
    expect(preview.status).toBe(200);
    expect(preview.body).toEqual({
      ruleId: 'broken-internal-links',
      totalUrls: 3,
      urlCount: 3,
      lastRecheck: null,
    });
    expect(probe).not.toHaveBeenCalled();

    const run = await request(app).post(path).set('Cookie', owner.cookie).send({});
    expect(run.status).toBe(200);
    expect(run.body.recheck).toMatchObject({ totalUrls: 3, checked: 3, stillFailing: 1, cleared: 1, unverified: 1 });
    expect(probe).toHaveBeenCalledTimes(3);
    expect(probe).toHaveBeenCalledWith(targets[0], { method: 'GET', checkRobots: false });

    // Within the cooldown the stored result comes back; nothing is requested.
    const again = await request(app).post(path).set('Cookie', owner.cookie).send({});
    expect(again.body.recheck).toEqual(run.body.recheck);
    expect(probe).toHaveBeenCalledTimes(3);

    const after = await report(owner, siteId, runId);
    const decision = (after.body.findings as Array<{ ruleId: string; decision?: { recheck: unknown } }>)[0]?.decision;
    expect(decision?.recheck).toEqual(run.body.recheck);
    expect((await request(app).get(path).set('Cookie', owner.cookie)).body.lastRecheck).toEqual(run.body.recheck);
  });

  it('records every URL as unverified when no prober is wired, even for a dismissal recorded before reasons', async () => {
    const owner = await signupVerifiedUser(app, { email: 'recheck-none@x.co' });
    const siteId = await addSite(owner);
    const runId = await storeRun(owner, siteId, [broken(2, ['https://episodebrief.example/a'])]);
    await decide(owner, siteId, 'broken-internal-links', { state: 'dismissed', expectedVersion: 0 });
    await FindingDismissal.deleteMany({});
    const res = await request(app)
      .post(`/api/audits/${runId}/findings/broken-internal-links/recheck`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.recheck).toMatchObject({ checked: 1, unverified: 1 });
    expect(await FindingDismissal.findOne({ ruleId: 'broken-internal-links' }).lean()).toMatchObject({
      reason: null,
      actorUserId: owner.id,
    });
  });

  it('refuses a finding that is not dismissed, has no stored targets, or is not re-checkable', async () => {
    const owner = await signupVerifiedUser(app, { email: 'recheck-no@x.co' });
    const siteId = await addSite(owner);
    const runId = await storeRun(owner, siteId, [broken(2, []), titles(2)]);
    const base = `/api/audits/${runId}/findings`;
    const open = await request(app).get(`${base}/broken-internal-links/recheck`).set('Cookie', owner.cookie);
    expect(open.status).toBe(409);
    expect(open.body.error.code).toBe('AUDITS_ERRORS_RECHECK_UNAVAILABLE');
    await decide(owner, siteId, 'broken-internal-links', { state: 'dismissed', expectedVersion: 0, reason: 'other' });
    expect((await request(app).get(`${base}/broken-internal-links/recheck`).set('Cookie', owner.cookie)).status).toBe(409);
    await decide(owner, siteId, 'title-missing-or-weak', { state: 'dismissed', expectedVersion: 0, reason: 'wont_fix' });
    expect((await request(app).post(`${base}/title-missing-or-weak/recheck`).set('Cookie', owner.cookie).send({})).status).toBe(409);
    expect((await request(app).get(`${base}/missing-rule/recheck`).set('Cookie', owner.cookie)).status).toBe(409);
    // Marked fixed is not dismissed.
    await decide(owner, siteId, 'broken-internal-links', { state: 'open', expectedVersion: 1 });
    await decide(owner, siteId, 'broken-internal-links', { state: 'completed', expectedVersion: 2 });
    expect((await request(app).get(`${base}/broken-internal-links/recheck`).set('Cookie', owner.cookie)).status).toBe(409);
    // A run that does not report the rule has nothing to re-check.
    const cleanRunId = await storeRun(owner, siteId, [titles(1)]);
    const clean = await request(app)
      .get(`/api/audits/${cleanRunId}/findings/broken-internal-links/recheck`)
      .set('Cookie', owner.cookie);
    expect(clean.status).toBe(409);
  });
});

describe('cross-account isolation (404, never 403)', () => {
  it('hides report-by-run, dismiss, restore and re-check from another account', async () => {
    const owner = await signupVerifiedUser(app, { email: 'owner05@x.co' });
    const intruder = await signupVerifiedUser(app, { email: 'intruder05@x.co' });
    const siteId = await addSite(owner);
    const runId = await storeRun(owner, siteId, [broken(2, ['https://episodebrief.example/a'])]);
    await decide(owner, siteId, 'broken-internal-links', { state: 'dismissed', expectedVersion: 0, reason: 'false_positive' });
    const probe = vi.fn();
    setFindingRecheckProber({ probe } as unknown as PageProber);

    expect((await report(intruder, siteId, runId)).status).toBe(404);
    const path = `/api/audits/${runId}/findings/broken-internal-links/recheck`;
    expect((await request(app).get(path).set('Cookie', intruder.cookie)).status).toBe(404);
    expect((await request(app).post(path).set('Cookie', intruder.cookie).send({})).status).toBe(404);
    const id = actionId(owner, siteId, 'broken-internal-links');
    const restore = await request(app)
      .post(`/api/sites/${siteId}/actions/${id}/state`)
      .set('Cookie', intruder.cookie)
      .send({ state: 'open', expectedVersion: 1, clientKey: 'x' });
    expect(restore.status).toBe(404);
    const dismiss = await request(app)
      .post(`/api/sites/${siteId}/actions/${id}/state`)
      .set('Cookie', intruder.cookie)
      .send({ state: 'dismissed', expectedVersion: 1, clientKey: 'y', reason: 'other' });
    expect(dismiss.status).toBe(404);
    expect(probe).not.toHaveBeenCalled();
    // The owner's dismissal is untouched.
    const own = await report(owner, siteId, runId);
    expect(own.body.notCounted).toEqual({ dismissed: 1, completed: 0 });
  });

  it('answers 401 to nobody and 404 to a random well-formed id on the report, run and recheck routes', async () => {
    const owner = await signupVerifiedUser(app, { email: 'a5-owner@x.co' });
    const intruder = await signupVerifiedUser(app, { email: 'a5-intruder@x.co' });
    const siteId = await addSite(owner);
    const runId = await storeRun(owner, siteId, [broken(2, ['https://episodebrief.example/a'])]);
    const randomId = '64b7f0c2a1b2c3d4e5f60718';
    const paths = [
      `/api/audits/${runId}/report`,
      `/api/audits/${runId}`,
      `/api/audits/${runId}/findings/broken-internal-links/recheck`,
    ];
    for (const path of paths) {
      expect((await request(app).get(path)).status, `anonymous ${path}`).toBe(401);
      expect((await request(app).get(path).set('Cookie', intruder.cookie)).status, `stranger ${path}`).toBe(404);
    }
    // A well-formed id nobody owns is a 404 for the real owner too.
    expect((await report(owner, siteId, randomId)).status).toBe(404);
    const missing = await request(app)
      .get(`/api/audits/${randomId}/findings/broken-internal-links/recheck`)
      .set('Cookie', owner.cookie);
    expect(missing.status).toBe(404);
  });

  it('rejects an unknown dismissal reason', async () => {
    const owner = await signupVerifiedUser(app, { email: 'reason@x.co' });
    const siteId = await addSite(owner);
    await storeRun(owner, siteId, [titles(1)]);
    const res = await decide(owner, siteId, 'title-missing-or-weak', {
      state: 'dismissed',
      expectedVersion: 0,
      reason: 'because',
    });
    expect(res.status).toBe(400);
  });
});
