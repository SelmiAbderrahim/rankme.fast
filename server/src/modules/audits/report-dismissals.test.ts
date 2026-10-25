/**
 * Unit behaviour of the one decision overlay:
 * resurfacing on growth, what leaves the counts, who is named, and the
 * no-decisions-store path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { actionEvents } from '../../db/schema/action-events.js';
import { hashActionId, hashSourceIdRef } from '../actions/actions.identity.js';
import { AUDIT_REGRESSION_ACTOR } from '../actions/actions.regression.js';
import { User } from '../users/users.model.js';
import { AuditRun } from './audit-run.model.js';
import { ReportSnapshot } from './report-snapshot.model.js';
import { FindingDismissal } from './finding-dismissal.model.js';
import {
  applyDismissals,
  isUncountedDecision,
  recordFindingDismissal,
  resurfacedBy,
  toFindingRecheckView,
  type FindingDecisionView,
} from './report-dismissals.js';
import type { AuditReport } from './report.service.js';

const accountId = new Types.ObjectId().toHexString();
const siteId = new Types.ObjectId().toHexString();

function reportFor(runId: string, findings: Array<{ ruleId: string; bucket: string; affectedUrls: string[] }>): AuditReport {
  return {
    runId,
    counts: { fixNow: findings.filter((f) => f.bucket === 'fix-now').length, watch: findings.filter((f) => f.bucket === 'watch').length, passed: 0, notEvaluated: 0 },
    findings: findings.map((f) => ({ ...f, severity: 'warning', copy: {} })) as never,
    notApplicable: [],
    localBusiness: false,
    diff: { entries: [], summary: { fixed: 0, regressed: 0, new: 0, unchanged: 0 } },
    comparison: null,
    pageSpeed: null,
    indexStatus: null,
    gscSearch: null,
    gscSitemaps: null,
    aiVisibility: null,
    localSeo: null,
    aiSummary: null,
    aiSummaryStatus: 'idle',
    aiSummaryAvailability: { requestedLocale: 'en', availableLocales: [], status: 'idle' },
  } as unknown as AuditReport;
}

async function event(ruleId: string, newState: 'dismissed' | 'completed' | 'open', actorUserId: string, ordinal = 1) {
  const base = { accountId, siteId, sourceType: 'audit_finding' as const, sourceId: ruleId };
  await getTestDb().insert(actionEvents).values({
    accountId,
    siteId,
    actionId: hashActionId(base),
    sourceType: 'audit_finding',
    sourceIdRef: hashSourceIdRef(base),
    priorState: 'open',
    newState,
    eventKind: newState === 'dismissed' ? 'dismiss' : newState === 'completed' ? 'complete' : 'reopen',
    actorUserId,
    note: null,
    ordinal,
    idempotencyKey: `${ruleId}-${ordinal}`,
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('resurfacedBy', () => {
  const latest = (affectedCount: number, detected = true) => ({ detected, affectedCount });
  it('resurfaces only a dismissal whose newest count grew', () => {
    expect(resurfacedBy({ state: 'dismissed', affectedCountAtDismissal: 65, latest: latest(77) })).toEqual({ addedCount: 12 });
    expect(resurfacedBy({ state: 'dismissed', affectedCountAtDismissal: 65, latest: latest(65) })).toBeNull();
    expect(resurfacedBy({ state: 'dismissed', affectedCountAtDismissal: 65, latest: latest(10) })).toBeNull();
    expect(resurfacedBy({ state: 'dismissed', affectedCountAtDismissal: 1, latest: latest(9, false) })).toBeNull();
    expect(resurfacedBy({ state: 'dismissed', affectedCountAtDismissal: null, latest: latest(9) })).toBeNull();
    expect(resurfacedBy({ state: 'dismissed', affectedCountAtDismissal: 1, latest: null })).toBeNull();
    expect(resurfacedBy({ state: 'completed', affectedCountAtDismissal: 1, latest: latest(9) })).toBeNull();
  });
});

describe('isUncountedDecision', () => {
  const view = (over: Partial<FindingDecisionView>): FindingDecisionView => ({
    state: 'dismissed',
    regressed: false,
    decidedAt: '2026-10-16T00:00:00.000Z',
    decidedBy: null,
    reason: null,
    affectedCountAtDismissal: null,
    latest: null,
    resurfaced: null,
    recheckable: false,
    recheck: null,
    ...over,
  });
  it('leaves dismissed and fixed findings out, never open, planned or resurfaced ones', () => {
    expect(isUncountedDecision(undefined)).toBe(false);
    expect(isUncountedDecision(view({}))).toBe(true);
    expect(isUncountedDecision(view({ state: 'completed' }))).toBe(true);
    expect(isUncountedDecision(view({ state: 'planned' }))).toBe(false);
    expect(isUncountedDecision(view({ resurfaced: { addedCount: 2 } }))).toBe(false);
  });
});

describe('toFindingRecheckView', () => {
  it('tallies every outcome and defaults a missing status', () => {
    expect(
      toFindingRecheckView({
        checkedAt: new Date('2026-10-17T00:00:00.000Z'),
        totalUrls: 4,
        results: [
          { url: 'a', outcome: 'still_failing', status: 500 },
          { url: 'b', outcome: 'cleared' },
          { url: 'c', outcome: 'unverified', status: null },
        ],
      }),
    ).toMatchObject({ totalUrls: 4, checked: 3, stillFailing: 1, cleared: 1, unverified: 1, results: [{ status: 500 }, { status: null }, { status: null }] });
  });
});

describe('applyDismissals', () => {
  it('applies no decision without a decisions store and names no newest run on a site with none', async () => {
    const applied = await applyDismissals(reportFor(new Types.ObjectId().toHexString(), [{ ruleId: 'thin-content', bucket: 'fix-now', affectedUrls: ['a'] }]), {
      accountId,
      siteId,
    });
    expect(applied.latestRunId).toBeNull();
    expect(applied.findings[0]).not.toHaveProperty('decision');
    expect(applied.openCounts).toMatchObject({ fixNow: 1 });
    expect(applied.notCounted).toEqual({ dismissed: 0, completed: 0 });
  });

  it('names the person behind a decision, never the system actor, and reads an older run against the newest', async () => {
    const owner = await User.create({ _id: new Types.ObjectId(), email: 'named@x.co', profile: { firstName: 'Nadia', lastName: '' } });
    const noName = await User.create({ _id: new Types.ObjectId(), email: 'plain@x.co' });
    const older = await AuditRun.create({ accountId, siteId, pageCap: 10, status: 'succeeded', finishedAt: new Date('2026-08-20T00:00:00.000Z') });
    const newer = await AuditRun.create({ accountId, siteId, pageCap: 10, status: 'succeeded', finishedAt: new Date('2026-10-16T00:00:00.000Z') });
    await ReportSnapshot.create({
      runId: newer._id,
      siteId,
      accountId,
      findings: [{ ruleId: 'thin-content', bucket: 'watch', severity: 'warning', affectedUrls: ['a', 'b'] }],
      counts: { fixNow: 0, watch: 1, passed: 0, notEvaluated: 0 },
    });
    await event('thin-content', 'dismissed', String(owner._id));
    await event('headings-weak', 'completed', String(noName._id));
    await event('title-missing-or-weak', 'completed', AUDIT_REGRESSION_ACTOR);
    await event('meta-description-missing', 'dismissed', 'not-an-object-id');
    await event('llms-txt-missing', 'dismissed', String(owner._id));
    await FindingDismissal.create({ accountId, siteId, ruleId: 'thin-content', reason: 'wont_fix', affectedCount: 1, actorUserId: String(owner._id), dismissedAt: new Date() });

    const applied = await applyDismissals(
      reportFor(String(older._id), [
        { ruleId: 'thin-content', bucket: 'watch', affectedUrls: ['a'] },
        { ruleId: 'headings-weak', bucket: 'fix-now', affectedUrls: [] },
        { ruleId: 'title-missing-or-weak', bucket: 'watch', affectedUrls: ['x'] },
        { ruleId: 'meta-description-missing', bucket: 'watch', affectedUrls: ['y'] },
        { ruleId: 'llms-txt-missing', bucket: 'passed', affectedUrls: [] },
      ]),
      { accountId, siteId, db: getTestDb() as never },
    );
    expect(applied.latestRunId).toBe(String(newer._id));
    const byRule = Object.fromEntries(applied.findings.map((f) => [f.ruleId, f.decision]));
    expect(byRule['thin-content']).toMatchObject({
      decidedBy: 'Nadia',
      reason: 'wont_fix',
      latest: { runId: String(newer._id), detected: true, affectedCount: 2 },
      resurfaced: { addedCount: 1 },
      recheckable: false,
    });
    expect(byRule['headings-weak']).toMatchObject({ state: 'completed', decidedBy: 'plain@x.co', latest: { detected: false, affectedCount: 0 } });
    expect(byRule['title-missing-or-weak']).toMatchObject({ decidedBy: null });
    expect(byRule['meta-description-missing']).toMatchObject({ decidedBy: null, reason: null, affectedCountAtDismissal: null });
    expect(byRule['llms-txt-missing']).toBeUndefined();
    // thin-content resurfaced (counted); the three others are not counted.
    expect(applied.notCounted).toEqual({ dismissed: 1, completed: 2 });
    expect(applied.openCounts).toMatchObject({ fixNow: 0, watch: 1 });
  });

  it('reads a newest run whose snapshot is missing as reporting nothing', async () => {
    const older = await AuditRun.create({ accountId, siteId, pageCap: 10, status: 'succeeded' });
    await AuditRun.create({ accountId, siteId, pageCap: 10, status: 'succeeded' });
    await event('thin-content', 'dismissed', 'user-x');
    const applied = await applyDismissals(reportFor(String(older._id), [{ ruleId: 'thin-content', bucket: 'watch', affectedUrls: ['a'] }]), {
      accountId,
      siteId,
      db: getTestDb() as never,
    });
    expect(applied.findings[0]?.decision?.latest).toMatchObject({ detected: false, affectedCount: 0 });
  });

  it('gives a decision no newest-audit view when the site has no finished audit', async () => {
    await event('thin-content', 'dismissed', 'user-x');
    const applied = await applyDismissals(reportFor(new Types.ObjectId().toHexString(), [{ ruleId: 'thin-content', bucket: 'fix-now', affectedUrls: ['a'] }]), {
      accountId,
      siteId,
      db: getTestDb() as never,
    });
    expect(applied.findings[0]?.decision).toMatchObject({ state: 'dismissed', latest: null, resurfaced: null });
    expect(applied.notCounted).toEqual({ dismissed: 1, completed: 0 });
  });
});

describe('recordFindingDismissal', () => {
  it('stores a null count when the newest audit has no snapshot', async () => {
    const otherSite = new Types.ObjectId().toHexString();
    const run = await AuditRun.create({ accountId, siteId: otherSite, pageCap: 10, status: 'succeeded' });
    await recordFindingDismissal({ accountId, siteId: otherSite, ruleId: 'thin-content', reason: 'other', actorUserId: 'u1' });
    expect(await FindingDismissal.findOne({ siteId: otherSite }).lean()).toMatchObject({ affectedCount: null, runId: String(run._id) });
  });

  it('stores a null count when no audit reported the rule, and replaces an earlier dismissal', async () => {
    await recordFindingDismissal({ accountId, siteId, ruleId: 'thin-content', reason: 'other', actorUserId: 'u1', now: new Date('2026-10-01T00:00:00.000Z') });
    expect(await FindingDismissal.findOne({ ruleId: 'thin-content' }).lean()).toMatchObject({ affectedCount: null, runId: null, reason: 'other' });
    const run = await AuditRun.create({ accountId, siteId, pageCap: 10, status: 'succeeded' });
    await ReportSnapshot.create({ runId: run._id, siteId, accountId, findings: [{ ruleId: 'thin-content', bucket: 'watch', severity: 'warning', affectedUrls: ['a', 'b', 'c'] }], counts: { fixNow: 0, watch: 1, passed: 0, notEvaluated: 0 } });
    await recordFindingDismissal({ accountId, siteId, ruleId: 'thin-content', reason: null, actorUserId: 'u2' });
    await recordFindingDismissal({ accountId, siteId, ruleId: 'headings-weak', reason: null, actorUserId: 'u2' });
    expect(await FindingDismissal.countDocuments({ ruleId: 'thin-content' })).toBe(1);
    expect(await FindingDismissal.findOne({ ruleId: 'thin-content' }).lean()).toMatchObject({ affectedCount: 3, runId: String(run._id), actorUserId: 'u2', reason: null });
    expect(await FindingDismissal.findOne({ ruleId: 'headings-weak' }).lean()).toMatchObject({ affectedCount: null, runId: String(run._id) });
  });
});
