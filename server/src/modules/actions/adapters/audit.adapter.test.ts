/**
 * Audit-finding Next Actions source adapter tests.
 *
 * Locked contract under test: only the LATEST succeeded site audit feeds the
 * adapter; `fix-now` and `watch` findings become candidates; `passed`
 * findings are absent; sourceId is the bare `ruleId` (run-independent, so a
 * decision survives a retest); audit candidates are the only retestable
 * source.
 */
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../../shared/testing/mongo.js';
import { AuditRun } from '../../audits/audit-run.model.js';
import { ReportSnapshot } from '../../audits/report-snapshot.model.js';
import { auditActionAdapter } from './audit.adapter.js';

const HOSTILE_META = 'hostile-vendor-meta-SECRET-excerpt';

// The audit adapter never touches Postgres — a inert stand-in keeps the
// harness Mongo-only.
const unusedDb = {} as never;

function ids() {
  return {
    accountId: new mongoose.Types.ObjectId().toHexString(),
    siteId: new mongoose.Types.ObjectId().toHexString(),
  };
}

async function seedRun(input: {
  accountId: string;
  siteId: string;
  status?: 'succeeded' | 'failed' | 'running';
  kind?: 'site' | 'lead';
  finishedAt?: Date | null;
  findings?: Array<{
    ruleId: string;
    bucket: 'fix-now' | 'watch' | 'passed';
    severity: 'critical' | 'warning' | 'info';
    affectedUrls?: string[];
    meta?: Record<string, unknown> | null;
  }>;
  snapshot?: boolean;
}) {
  const run = await AuditRun.create({
    accountId: input.accountId,
    siteId: input.siteId,
    status: input.status ?? 'succeeded',
    kind: input.kind ?? 'site',
    pageCap: 25,
    finishedAt:
      input.finishedAt === undefined
        ? new Date('2026-07-01T12:00:00.000Z')
        : input.finishedAt,
  });
  if (input.snapshot !== false) {
    await ReportSnapshot.create({
      runId: run._id,
      siteId: input.siteId,
      accountId: input.accountId,
      findings: input.findings ?? [],
      counts: { fixNow: 0, watch: 0, passed: 0 },
    });
  }
  return String(run._id);
}

beforeAll(async () => {
  await mongoose.connect(await startMemoryMongo());
});

afterAll(async () => {
  await mongoose.disconnect();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

afterEach(async () => {
  await clearCollections();
});

describe('auditActionAdapter', () => {
  it('returns empty for non-ObjectId account/site ids without touching Mongo', async () => {
    expect(
      await auditActionAdapter({ accountId: 'nope', siteId: 'x', db: unusedDb }),
    ).toEqual({ actions: [], status: 'available' });
    expect(
      await auditActionAdapter({
        accountId: new mongoose.Types.ObjectId().toHexString(),
        siteId: 'not-an-id',
        db: unusedDb,
      }),
    ).toEqual({ actions: [], status: 'available' });
  });

  it('returns empty available when no succeeded run exists', async () => {
    const { accountId, siteId } = ids();
    await seedRun({ accountId, siteId, status: 'failed' });
    const result = await auditActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result).toEqual({ actions: [], status: 'available' });
  });

  it('marks the source stale when the succeeded run has no frozen report', async () => {
    const { accountId, siteId } = ids();
    await seedRun({ accountId, siteId, snapshot: false });
    const result = await auditActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result).toEqual({ actions: [], status: 'stale' });
  });

  it('emits fix-now and watch findings; passed findings are absent', async () => {
    const { accountId, siteId } = ids();
    const runId = await seedRun({
      accountId,
      siteId,
      findings: [
        {
          ruleId: 'missing-title',
          bucket: 'fix-now',
          severity: 'critical',
          affectedUrls: ['https://ex.test/a#frag', 'https://ex.test/a', 'nota-url'],
          meta: { vendor: HOSTILE_META },
        },
        {
          ruleId: 'thin-content',
          bucket: 'watch',
          severity: 'warning',
          affectedUrls: ['https://ex.test/b'],
        },
        { ruleId: 'https-ok', bucket: 'passed', severity: 'info' },
      ],
    });

    const result = await auditActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result.status).toBe('available');
    expect(result.lastObservedAt).toBe('2026-07-01T12:00:00.000Z');
    // Run-independent identity: the rule id alone. The observing run stays
    // reachable through the evidence ref.
    expect(result.actions.map((a) => a.sourceId)).toEqual([
      'missing-title',
      'thin-content',
    ]);
    expect(result.actions[0]!.evidence[0]!.sourceRef).toBe(
      `${runId}:missing-title`,
    );

    const first = result.actions[0]!;
    expect(first.sourceType).toBe('audit_finding');
    expect(first.severity).toBe('critical');
    expect(first.confidence).toBe('high');
    expect(first.firstPartyImpact).toBe('none');
    expect(first.effort).toBe('medium');
    expect(first.sourceState).toBe('open');
    expect(first.retestAvailable).toBe(true);
    expect(first.retestReasonKey).toBeUndefined();
    // URL canonicalize + dedupe: fragment stripped, non-URL dropped.
    expect(first.affectedUrls).toEqual(['https://ex.test/a']);
    expect(first.copyKeys).toEqual({
      problem: 'auditRules.missing-title.title',
      whyItMatters: 'auditRules.missing-title.why',
      nextStep: 'auditRules.missing-title.fix',
    });
    expect(first.evidence).toEqual([
      {
        sourceRef: `${runId}:missing-title`,
        observation: expect.objectContaining({
          sourceKind: 'provider_observation',
          observedAt: '2026-07-01T12:00:00.000Z',
          freshness: 'fresh',
        }),
      },
    ]);
    expect(result.actions[1]!.severity).toBe('warning');

    // Finding meta (raw vendor detail) must never leave the snapshot.
    expect(JSON.stringify(result)).not.toContain(HOSTILE_META);
  });

  it('adds code-fix metadata only for actionable technical findings with evidence', async () => {
    const { accountId, siteId } = ids();
    await seedRun({
      accountId,
      siteId,
      findings: [
        {
          ruleId: 'title-missing-or-weak',
          bucket: 'fix-now',
          severity: 'critical',
          affectedUrls: ['https://ex.test/a', 'https://ex.test/b'],
        },
        {
          ruleId: 'sitemap-errors',
          bucket: 'watch',
          severity: 'warning',
          meta: { insufficientData: 'no-sitemaps' },
        },
        {
          ruleId: 'headings-weak',
          bucket: 'watch',
          severity: 'warning',
          meta: { error: true },
        },
        {
          ruleId: 'thin-content',
          bucket: 'fix-now',
          severity: 'warning',
        },
      ],
    });

    const result = await auditActionAdapter({ accountId, siteId, db: unusedDb });
    const byRule = new Map(result.actions.map((action) => [action.sourceId, action]));

    expect(byRule.get('title-missing-or-weak')?.codeFixPrompt).toEqual({
      reference: 'title-missing-or-weak',
      recommendedFixKey: 'auditRules.title-missing-or-weak.fix',
      affectedUrlCount: 2,
    });
    expect(byRule.get('sitemap-errors')?.codeFixPrompt).toBeUndefined();
    expect(byRule.get('headings-weak')?.codeFixPrompt).toBeUndefined();
    expect(byRule.get('thin-content')?.codeFixPrompt).toBeUndefined();
  });

  it('counts zero affected URLs when a stored eligible finding has no URL list', async () => {
    const { accountId, siteId } = ids();
    const runId = await seedRun({
      accountId,
      siteId,
      findings: [{ ruleId: 'llms-txt-missing', bucket: 'fix-now', severity: 'warning' }],
    });
    await ReportSnapshot.collection.updateOne(
      { runId: new mongoose.Types.ObjectId(runId) },
      { $unset: { 'findings.0.affectedUrls': '' } },
    );

    const result = await auditActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result.actions[0]?.codeFixPrompt).toEqual({
      reference: 'llms-txt-missing',
      recommendedFixKey: 'auditRules.llms-txt-missing.fix',
      affectedUrlCount: 0,
    });
  });

  it('reads only the LATEST succeeded site run — newer failed and lead runs do not shadow it', async () => {
    const { accountId, siteId } = ids();
    await seedRun({
      accountId,
      siteId,
      findings: [
        { ruleId: 'old-rule', bucket: 'fix-now', severity: 'warning' },
      ],
    });
    const newest = await seedRun({
      accountId,
      siteId,
      findings: [
        { ruleId: 'new-rule', bucket: 'fix-now', severity: 'critical' },
      ],
    });
    await seedRun({ accountId, siteId, status: 'failed', snapshot: false });
    await seedRun({
      accountId,
      siteId,
      kind: 'lead',
      findings: [
        { ruleId: 'lead-rule', bucket: 'fix-now', severity: 'critical' },
      ],
    });

    const result = await auditActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result.actions.map((a) => a.sourceId)).toEqual(['new-rule']);
    expect(result.actions[0]!.evidence[0]!.sourceRef).toBe(
      `${newest}:new-rule`,
    );
  });

  it('falls back to the snapshot createdAt when finishedAt is missing', async () => {
    const { accountId, siteId } = ids();
    await seedRun({
      accountId,
      siteId,
      finishedAt: null,
      findings: [{ ruleId: 'r1', bucket: 'watch', severity: 'info' }],
    });
    const result = await auditActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result.actions).toHaveLength(1);
    expect(Date.parse(result.actions[0]!.observedAt)).not.toBeNaN();
    expect(result.actions[0]!.lastVerifiedAt).toBe(result.actions[0]!.observedAt);
  });

  it('dedupes duplicate ruleIds and tolerates raw snapshots without findings', async () => {
    const { accountId, siteId } = ids();
    const runId = await seedRun({
      accountId,
      siteId,
      findings: [
        { ruleId: 'dup', bucket: 'fix-now', severity: 'critical' },
        { ruleId: 'dup', bucket: 'watch', severity: 'info' },
      ],
    });
    const result = await auditActionAdapter({ accountId, siteId, db: unusedDb });
    expect(result.actions.map((a) => a.sourceId)).toEqual(['dup']);
    expect(result.actions[0]!.severity).toBe('critical');

    // Degraded document: strip the findings array entirely (bypass schema).
    await ReportSnapshot.collection.updateOne(
      { runId: new mongoose.Types.ObjectId(runId) },
      { $unset: { findings: '' } },
    );
    const degraded = await auditActionAdapter({ accountId, siteId, db: unusedDb });
    expect(degraded.actions).toEqual([]);
    expect(degraded.status).toBe('available');
  });

  it('emits an empty affected-URL list when a stored finding has no affectedUrls field', async () => {
    const { accountId, siteId } = ids();
    const runId = await seedRun({
      accountId,
      siteId,
      findings: [
        {
          ruleId: 'missing-title',
          bucket: 'fix-now',
          severity: 'critical',
          affectedUrls: ['https://ex.test/a'],
        },
      ],
    });
    // A snapshot frozen before `affectedUrls` existed reads back with the
    // field absent (the schema default only applies on write). The adapter
    // must still mint the candidate, with no affected URLs.
    await ReportSnapshot.collection.updateOne(
      { runId: new mongoose.Types.ObjectId(runId) },
      { $unset: { 'findings.0.affectedUrls': '' } },
    );

    const result = await auditActionAdapter({ accountId, siteId, db: unusedDb });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]!.sourceId).toBe('missing-title');
    expect(result.actions[0]!.affectedUrls).toEqual([]);
    expect(result.status).toBe('available');
  });

  it('never leaks another account or site', async () => {
    const { accountId, siteId } = ids();
    await seedRun({
      accountId,
      siteId,
      findings: [{ ruleId: 'r1', bucket: 'fix-now', severity: 'critical' }],
    });

    const otherAccount = await auditActionAdapter({
      accountId: new mongoose.Types.ObjectId().toHexString(),
      siteId,
      db: unusedDb,
    });
    expect(otherAccount.actions).toEqual([]);

    const otherSite = await auditActionAdapter({
      accountId,
      siteId: new mongoose.Types.ObjectId().toHexString(),
      db: unusedDb,
    });
    expect(otherSite.actions).toEqual([]);
  });
});
