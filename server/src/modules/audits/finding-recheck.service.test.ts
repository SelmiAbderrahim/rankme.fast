/**
 * The targeted re-check's wall clock: URLs not reached
 * before the deadline stay unverified instead of holding the request open.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { actionEvents } from '../../db/schema/action-events.js';
import { hashActionId, hashSourceIdRef } from '../actions/actions.identity.js';
import type { PageProber } from '../../shared/security/site-probe.js';
import { Site } from '../sites/index.js';
import { AuditRun } from './audit-run.model.js';
import { ReportSnapshot } from './report-snapshot.model.js';
import {
  FINDING_RECHECK_DEADLINE_MS,
  FINDING_RECHECK_MAX_URLS,
  runFindingRecheck,
  setFindingRecheckProber,
} from './finding-recheck.service.js';

const accountId = new Types.ObjectId().toHexString();

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
afterEach(() => setFindingRecheckProber(null));

describe('runFindingRecheck', () => {
  it('requests at most the bound, stops at the deadline and leaves the rest unverified', async () => {
    const site = await Site.create({ accountId, url: 'https://example.com', domain: 'example.com' });
    const siteId = String(site._id);
    const targets = Array.from({ length: FINDING_RECHECK_MAX_URLS + 5 }, (_, i) => `https://example.com/t${String(i).padStart(2, '0')}`);
    const run = await AuditRun.create({ accountId, siteId, pageCap: 10, status: 'succeeded' });
    await ReportSnapshot.create({
      runId: run._id,
      siteId,
      accountId,
      findings: [{ ruleId: 'broken-internal-links', bucket: 'fix-now', severity: 'critical', affectedUrls: ['https://example.com/'], meta: { brokenLinkTargets: targets } }],
      counts: { fixNow: 1, watch: 0, passed: 0, notEvaluated: 0 },
    });
    const base = { accountId, siteId, sourceType: 'audit_finding' as const, sourceId: 'broken-internal-links' };
    await getTestDb().insert(actionEvents).values({
      accountId, siteId, actionId: hashActionId(base), sourceType: 'audit_finding', sourceIdRef: hashSourceIdRef(base),
      priorState: 'open', newState: 'dismissed', eventKind: 'dismiss', actorUserId: 'u1', note: null, ordinal: 1, idempotencyKey: 'k1',
    });
    let clock = 0;
    const probe = vi.fn(async (url: string) => {
      clock += FINDING_RECHECK_DEADLINE_MS / 2;
      return { url, statusCode: 404, finalUrl: null, redirectChain: [], contentType: null, failure: null };
    });
    setFindingRecheckProber({ probe } as PageProber);
    const result = await runFindingRecheck(
      { accountId, siteId, runId: String(run._id), ruleId: 'broken-internal-links', locale: 'en', db: getTestDb() as never },
      { now: () => clock },
    );
    expect(result.totalUrls).toBe(FINDING_RECHECK_MAX_URLS + 5);
    expect(result.checked).toBe(FINDING_RECHECK_MAX_URLS);
    // Concurrent workers each start one request before the clock passes the deadline.
    expect(probe.mock.calls.length).toBeLessThan(FINDING_RECHECK_MAX_URLS);
    expect(result.stillFailing).toBe(probe.mock.calls.length);
    expect(result.unverified).toBe(FINDING_RECHECK_MAX_URLS - probe.mock.calls.length);
  });
});
