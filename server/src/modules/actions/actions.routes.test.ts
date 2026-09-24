/**
 * Next Actions router integration tests — real createApp() with Better
 * Auth-backed sessions, PGlite Postgres, memory Mongo, and a fake audits
 * queue. Proves auth/verified gating, localization, filters, cross-account
 * 404, state round-trips, content delegation, and the retest delegation to
 * the shipped start-audit service.
 */
import mongoose, { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Job, Queue } from 'bullmq';
import pino from 'pino';
import { createApp } from '../../app.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupTestUser,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import {
  setRateLimitMetricsDb,
  setRateLimitMetricsLogger,
} from '../../shared/middleware/rate-limit-metrics.js';
import { setSitesDb } from '../sites/index.js';
import { setSummaryDb } from '../audits/summary.db-holder.js';
import { setAuditsQueue } from '../audits/audits.queue-holder.js';
import { AuditRun } from '../audits/audit-run.model.js';
import { ReportSnapshot } from '../audits/report-snapshot.model.js';
import { hashActionId } from './actions.identity.js';
import { clearSourceRegistry, registerSource } from './actions.registry.js';
import {
  audienceResearchActionAdapter,
  auditActionAdapter,
  contentActionAdapter,
  ga4ActionAdapter,
  gscActionAdapter,
  rankActionAdapter,
} from './adapters/index.js';
import type { CandidateAction } from './actions.types.js';

const app = createApp();

interface EnqueuedJob {
  name: string;
  opts: { jobId?: string };
}

function fakeQueue() {
  const jobs: EnqueuedJob[] = [];
  const queue = {
    async add(name: string, _data: unknown, opts: { jobId?: string }): Promise<Job> {
      jobs.push({ name, opts });
      return { id: opts.jobId } as Job;
    },
  } as unknown as Queue;
  return { queue, jobs };
}

function restoreBuiltins() {
  clearSourceRegistry();
  registerSource('audit_finding', auditActionAdapter);
  registerSource('confirmed_rank_drop', rankActionAdapter);
  registerSource('gsc_decline', gscActionAdapter);
  registerSource('ga4_decline', ga4ActionAdapter);
  registerSource('content_recommendation', contentActionAdapter);
  registerSource('audience_research', audienceResearchActionAdapter);
}

function stubCandidate(over: Partial<CandidateAction> = {}): CandidateAction {
  return {
    sourceType: 'confirmed_rank_drop',
    sourceId: 'stub-1',
    affectedUrls: [],
    evidence: [],
    severity: 'warning',
    firstPartyImpact: 'none',
    confidence: 'high',
    effort: 'low',
    sourceState: 'open',
    observedAt: '2026-07-01T00:00:00.000Z',
    lastVerifiedAt: null,
    retestAvailable: false,
    retestReasonKey: 'actions.errors.retestUnsupported',
    copyKeys: {
      problem: 'actions.rankDrop.problem',
      whyItMatters: 'actions.rankDrop.whyItMatters',
      nextStep: 'actions.rankDrop.nextStep',
    },
    copyVars: { keyword: 'best shoes' },
    ...over,
  };
}

async function addSite(user: TestUser, origin = 'https://example.com'): Promise<string> {
  const res = await request(app)
    .post('/api/sites')
    .set('Cookie', user.cookie)
    .send({ url: origin });
  return (res.body as { site: { id: string } }).site.id;
}

async function seedAuditReport(input: {
  accountId: string;
  siteId: string;
  findings?: Array<{
    ruleId: string;
    bucket: 'fix-now' | 'watch' | 'passed';
    severity: 'critical' | 'warning' | 'info';
    affectedUrls?: string[];
  }>;
}) {
  const run = await AuditRun.create({
    accountId: input.accountId,
    siteId: input.siteId,
    status: 'succeeded',
    kind: 'site',
    pageCap: 25,
    finishedAt: new Date('2026-07-01T12:00:00.000Z'),
  });
  await ReportSnapshot.create({
    runId: run._id,
    siteId: input.siteId,
    accountId: input.accountId,
    findings: input.findings ?? [
      {
        ruleId: 'title-missing-or-weak',
        bucket: 'fix-now',
        severity: 'critical',
        affectedUrls: ['https://example.com/a'],
      },
    ],
    counts: { fixNow: 1, watch: 0, passed: 0 },
  });
  return String(run._id);
}

beforeAll(async () => {
  await mongoose.connect(await startMemoryMongo());
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setSummaryDb(getTestDb() as unknown as never);
  setRateLimitMetricsDb(getTestDb() as unknown as never);
  setRateLimitMetricsLogger(pino({ level: 'silent' }));
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setSummaryDb(null);
  setAuditsQueue(null);
  setRateLimitMetricsDb(null);
  setRateLimitMetricsLogger(null);
  await mongoose.disconnect();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  restoreBuiltins();
});

afterEach(async () => {
  restoreBuiltins();
  setAuditsQueue(null);
  await clearCollections();
  await truncateAllTables();
});

describe('GET /api/sites/:siteId/actions', () => {
  it('requires an authenticated, verified user', async () => {
    const anonymous = await request(app).get(
      `/api/sites/${new Types.ObjectId().toHexString()}/actions`,
    );
    expect(anonymous.status).toBe(401);

    const unverified = await signupTestUser(app, {
      email: 'unverified-actions@example.com',
    });
    const gated = await request(app)
      .get(`/api/sites/${new Types.ObjectId().toHexString()}/actions`)
      .set('Cookie', unverified.cookie);
    expect(gated.status).toBe(403);
  });

  it('lists real audit findings with localization and source status', async () => {
    const user = await signupVerifiedUser(app, { email: 'lister@example.com' });
    const siteId = await addSite(user);
    const runId = await seedAuditReport({ accountId: user.id, siteId });

    const res = await request(app)
      .get(`/api/sites/${siteId}/actions`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.sourceType).toBe('audit_finding');
    // Run-independent identity — the rule id alone, so a retest keeps the
    // user's decision. The observing run stays on the evidence ref.
    expect(item.sourceId).toBe('title-missing-or-weak');
    expect(item.evidence[0].sourceRef).toBe(`${runId}:title-missing-or-weak`);
    expect(item.id).toBe(
      hashActionId({
        accountId: user.id,
        siteId,
        sourceType: 'audit_finding',
        sourceId: 'title-missing-or-weak',
      }),
    );
    expect(item.sourceLink).toBe(
      `/sites/${siteId}/report?finding=title-missing-or-weak`,
    );
    expect(item.retest).toEqual({ available: true });
    expect(typeof item.problem).toBe('string');
    expect(item.problem.length).toBeGreaterThan(0);
    expect(res.body.sourceStatus.audit_finding.status).toBe('available');
    expect(res.body.nextCursor).toBeNull();

    // Localized copy: the same list in Arabic returns different rule copy.
    const ar = await request(app)
      .get(`/api/sites/${siteId}/actions`)
      .set('Cookie', user.cookie)
      .set('x-lang', 'ar');
    expect(ar.status).toBe(200);
    expect(ar.body.items[0].problem).not.toBe(item.problem);
  });

  it('applies repeated query filters, rejects malformed ones, and 404s cross-account', async () => {
    const alice = await signupVerifiedUser(app, { email: 'alice-filter@example.com' });
    const siteId = await addSite(alice);
    await seedAuditReport({
      accountId: alice.id,
      siteId,
      findings: [
        { ruleId: 'r-critical', bucket: 'fix-now', severity: 'critical' },
        { ruleId: 'r-warning', bucket: 'watch', severity: 'warning' },
        { ruleId: 'r-info', bucket: 'watch', severity: 'info' },
      ],
    });

    const filtered = await request(app)
      .get(`/api/sites/${siteId}/actions?severity=critical&severity=warning&source=audit_finding`)
      .set('Cookie', alice.cookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.map((i: { sourceId: string }) => i.sourceId)).toHaveLength(2);

    const malformed = await request(app)
      .get(`/api/sites/${siteId}/actions?severity=catastrophic`)
      .set('Cookie', alice.cookie);
    expect(malformed.status).toBe(400);

    const badLimit = await request(app)
      .get(`/api/sites/${siteId}/actions?limit=0`)
      .set('Cookie', alice.cookie);
    expect(badLimit.status).toBe(400);

    const badCursor = await request(app)
      .get(`/api/sites/${siteId}/actions?cursor=not-a-cursor`)
      .set('Cookie', alice.cookie);
    expect(badCursor.status).toBe(400);

    const paged = await request(app)
      .get(`/api/sites/${siteId}/actions?limit=2`)
      .set('Cookie', alice.cookie);
    expect(paged.status).toBe(200);
    expect(paged.body.items).toHaveLength(2);
    expect(paged.body.nextCursor).toBe('2');
    const lastPage = await request(app)
      .get(`/api/sites/${siteId}/actions?limit=2&cursor=2`)
      .set('Cookie', alice.cookie);
    expect(lastPage.status).toBe(200);
    expect(lastPage.body.items).toHaveLength(1);
    expect(lastPage.body.nextCursor).toBeNull();

    const bob = await signupVerifiedUser(app, { email: 'bob-filter@example.com' });
    const cross = await request(app)
      .get(`/api/sites/${siteId}/actions`)
      .set('Cookie', bob.cookie);
    expect(cross.status).toBe(404);
  });

  it('filters by ?source=audience_research and reports degraded sources', async () => {
    const user = await signupVerifiedUser(app, { email: 'degraded@example.com' });
    const siteId = await addSite(user);
    await seedAuditReport({ accountId: user.id, siteId });
    // Replace the gsc reader with a failing one; keep the rest real.
    registerSource('gsc_decline', async () => {
      throw new Error('vendor store down');
    });

    const res = await request(app)
      .get(`/api/sites/${siteId}/actions?source=audience_research`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    // The audit finding exists but is filtered out; the degraded source is
    // visible, never converted into a healthy/empty claim.
    expect(res.body.items).toEqual([]);
    expect(res.body.sourceStatus.gsc_decline).toEqual({ status: 'unavailable' });
    expect(res.body.sourceStatus.audit_finding.status).toBe('available');
    expect(res.body.sourceStatus.audience_research.status).toBe('available');
  });
});

describe('action state round-trip and history', () => {
  it('mutates state with optimistic versioning, replays idempotently, and serves history', async () => {
    const user = await signupVerifiedUser(app, { email: 'mutator@example.com' });
    const siteId = await addSite(user);
    clearSourceRegistry();
    registerSource('confirmed_rank_drop', async () => ({
      actions: [stubCandidate()],
      status: 'available',
    }));
    const actionId = hashActionId({
      accountId: user.id,
      siteId,
      sourceType: 'confirmed_rank_drop',
      sourceId: 'stub-1',
    });

    const planned = await request(app)
      .post(`/api/sites/${siteId}/actions/${actionId}/state`)
      .set('Cookie', user.cookie)
      .send({ state: 'planned', expectedVersion: 0, clientKey: 'ck-1', note: 'next sprint' });
    expect(planned.status).toBe(200);
    expect(planned.body).toMatchObject({
      actionId,
      state: 'planned',
      version: 1,
      replayed: false,
    });

    // Same-state repeat at the current version → replay, no second event.
    const repeat = await request(app)
      .post(`/api/sites/${siteId}/actions/${actionId}/state`)
      .set('Cookie', user.cookie)
      .send({ state: 'planned', expectedVersion: 1, clientKey: 'ck-1' });
    expect(repeat.status).toBe(200);
    expect(repeat.body.replayed).toBe(true);

    // Stale version → localized 409.
    const stale = await request(app)
      .post(`/api/sites/${siteId}/actions/${actionId}/state`)
      .set('Cookie', user.cookie)
      .send({ state: 'completed', expectedVersion: 0, clientKey: 'ck-2' });
    expect(stale.status).toBe(409);

    // Malformed body → zod 400.
    const malformed = await request(app)
      .post(`/api/sites/${siteId}/actions/${actionId}/state`)
      .set('Cookie', user.cookie)
      .send({ state: 'archived', expectedVersion: 0, clientKey: 'ck-3' });
    expect(malformed.status).toBe(400);

    // Malformed actionId param → zod 400 before any lookup.
    const badParam = await request(app)
      .post(`/api/sites/${siteId}/actions/not-a-hash/state`)
      .set('Cookie', user.cookie)
      .send({ state: 'planned', expectedVersion: 0, clientKey: 'ck-4' });
    expect(badParam.status).toBe(400);

    const history = await request(app)
      .get(`/api/sites/${siteId}/actions/${actionId}/history`)
      .set('Cookie', user.cookie);
    expect(history.status).toBe(200);
    expect(history.body.entries).toHaveLength(1);
    expect(history.body.entries[0]).toMatchObject({
      ordinal: 1,
      priorState: 'open',
      newState: 'planned',
      eventKind: 'plan',
      note: 'next sprint',
    });

    // Cross-account state mutation and history → 404, not 403.
    const bob = await signupVerifiedUser(app, { email: 'bob-mutator@example.com' });
    const crossState = await request(app)
      .post(`/api/sites/${siteId}/actions/${actionId}/state`)
      .set('Cookie', bob.cookie)
      .send({ state: 'planned', expectedVersion: 0, clientKey: 'ck-5' });
    expect(crossState.status).toBe(404);
    const crossHistory = await request(app)
      .get(`/api/sites/${siteId}/actions/${actionId}/history`)
      .set('Cookie', bob.cookie);
    expect(crossHistory.status).toBe(404);

    // Unknown action hash history → 404.
    const unknownHistory = await request(app)
      .get(`/api/sites/${siteId}/actions/${'f'.repeat(64)}/history`)
      .set('Cookie', user.cookie);
    expect(unknownHistory.status).toBe(404);
  });

  it('rejects content-source mutations with the delegation conflict', async () => {
    const user = await signupVerifiedUser(app, { email: 'content-mutator@example.com' });
    const siteId = await addSite(user);
    clearSourceRegistry();
    registerSource('content_recommendation', async () => ({
      actions: [
        stubCandidate({
          sourceType: 'content_recommendation',
          sourceId: 'analysis1:rec1',
        }),
        stubCandidate({
          sourceType: 'citation_gap',
          sourceId: 'citation-gap:opportunity1',
        }),
      ],
      status: 'available',
    }));

    for (const [sourceType, sourceId] of [
      ['content_recommendation', 'analysis1:rec1'],
      ['citation_gap', 'citation-gap:opportunity1'],
    ] as const) {
      const actionId = hashActionId({
        accountId: user.id,
        siteId,
        sourceType,
        sourceId,
      });
      const res = await request(app)
        .post(`/api/sites/${siteId}/actions/${actionId}/state`)
        .set('Cookie', user.cookie)
        .send({ state: 'planned', expectedVersion: 0, clientKey: `ck-${sourceType}` });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('content-intelligence');
    }
  });
});

describe('POST /api/sites/:siteId/actions/:actionId/retest', () => {
  it('delegates audit retests to the shipped start-audit service', async () => {
    const user = await signupVerifiedUser(app, { email: 'retester@example.com' });
    const siteId = await addSite(user);
    await seedAuditReport({ accountId: user.id, siteId });
    const { queue, jobs } = fakeQueue();
    setAuditsQueue(queue);

    const actionId = hashActionId({
      accountId: user.id,
      siteId,
      sourceType: 'audit_finding',
      sourceId: 'title-missing-or-weak',
    });
    const res = await request(app)
      .post(`/api/sites/${siteId}/actions/${actionId}/retest`)
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(202);
    expect(res.body.actionId).toBe(actionId);
    expect(res.body.run).toBeDefined();
    expect(jobs).toHaveLength(1);

    // A queued run exists now — the audit dedupe stays authoritative.
    const again = await request(app)
      .post(`/api/sites/${siteId}/actions/${actionId}/retest`)
      .set('Cookie', user.cookie)
      .send({});
    expect(again.status).toBe(409);
    expect(jobs).toHaveLength(1);
  });

  it('rejects non-audit and unknown actions before any spend', async () => {
    const user = await signupVerifiedUser(app, { email: 'nonaudit-retester@example.com' });
    const siteId = await addSite(user);
    clearSourceRegistry();
    // A failing reader ahead of the resolving one exercises the skip branch.
    registerSource('gsc_decline', async () => {
      throw new Error('reader down');
    });
    registerSource('confirmed_rank_drop', async () => ({
      actions: [stubCandidate()],
      status: 'available',
    }));
    const { queue, jobs } = fakeQueue();
    setAuditsQueue(queue);

    const rankActionId = hashActionId({
      accountId: user.id,
      siteId,
      sourceType: 'confirmed_rank_drop',
      sourceId: 'stub-1',
    });
    const nonAudit = await request(app)
      .post(`/api/sites/${siteId}/actions/${rankActionId}/retest`)
      .set('Cookie', user.cookie)
      .send({});
    expect(nonAudit.status).toBe(409);

    const unknown = await request(app)
      .post(`/api/sites/${siteId}/actions/${'a'.repeat(64)}/retest`)
      .set('Cookie', user.cookie)
      .send({});
    expect(unknown.status).toBe(404);
    expect(jobs).toHaveLength(0);
  });
});
