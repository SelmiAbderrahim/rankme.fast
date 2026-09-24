import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  type TestDb,
} from '../shared/testing/postgres.js';
import type { AiAttemptBatch } from '../shared/providers/ai-sdk/runtime.js';
import {
  createAiSpendGuard,
  createAiUsagePruneProcessor,
  createAiUsageStore,
  getAccountAiSpendMicros,
  pruneOldAiUsageEvents,
  writeAiUsageEvents,
} from './ai-usage-events.js';
import { aiUsageEvents } from './schema/ai-usage-events.js';

let db: TestDb;

beforeAll(async () => {
  db = await startTestPostgres();
});
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

function batch(overrides: Partial<AiAttemptBatch> = {}): AiAttemptBatch {
  return {
    accountId: 'account-1',
    siteId: 'site-1',
    jobId: 'job-1',
    task: 'runtime.contract',
    correlationId: 'correlation-1',
    profileMetadata: {
      name: 'audit_summary',
      version: '1.0.0',
      outputSchemaVersion: '1',
      promptTemplateId: 'audit-summary',
      promptTemplateVersion: '1',
      qualityFlags: ['input_truncated'],
    },
    createdAt: new Date('2026-07-15T10:00:00Z'),
    attempts: [
      {
        ordinal: 1,
        provider: 'glm',
        model: 'configured-model',
        status: 'quota',
        latencyMs: 15,
        tokens: { input: null, output: null, cachedInput: null, reasoning: null },
        configuredEstimateCostMicros: 250n,
        actualOrEstimatedCostMicros: 250n,
        costSource: 'estimated',
        errorCategory: 'quota',
        errorCode: 'provider_quota',
      },
      {
        ordinal: 2,
        provider: 'deepseek',
        model: 'configured-model-2',
        status: 'success',
        latencyMs: 20,
        tokens: { input: 10, output: 4, cachedInput: 2, reasoning: 1 },
        configuredEstimateCostMicros: 300n,
        actualOrEstimatedCostMicros: 40n,
        costSource: 'actual',
        errorCategory: null,
        errorCode: null,
      },
    ],
    ...overrides,
  };
}

describe('safe AI usage event persistence', () => {
  it('writes an ordered batch with only safe metadata and bigint micros', async () => {
    expect(await writeAiUsageEvents(db, batch())).toBe(2);
    const rows = await db.select().from(aiUsageEvents).orderBy(aiUsageEvents.attemptOrdinal);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      accountId: 'account-1',
      siteId: 'site-1',
      jobId: 'job-1',
      task: 'runtime.contract',
      profileName: 'audit_summary',
      profileVersion: '1.0.0',
      outputSchemaVersion: '1',
      promptTemplateId: 'audit-summary',
      promptTemplateVersion: '1',
      qualityFlags: ['input_truncated'],
      provider: 'glm',
      attemptOrdinal: 1,
      status: 'quota',
      actualCostMicros: null,
      actualOrEstimatedCostMicros: 250n,
      errorCode: 'provider_quota',
    });
    expect(rows[1]).toMatchObject({
      provider: 'deepseek',
      inputTokens: 10,
      actualCostMicros: 40n,
      actualOrEstimatedCostMicros: 40n,
    });
    const columns = Object.keys(rows[0] ?? {});
    expect(columns).not.toEqual(expect.arrayContaining([
      'prompt', 'input', 'output', 'completion', 'systemInstruction', 'apiKey', 'authorization', 'stack',
    ]));
  });

  it('is batch-idempotent on account/correlation/ordinal', async () => {
    expect(await writeAiUsageEvents(db, batch())).toBe(2);
    expect(await writeAiUsageEvents(db, batch())).toBe(0);
    expect(await db.select().from(aiUsageEvents)).toHaveLength(2);
  });

  it('accepts an empty batch without issuing an insert', async () => {
    expect(await writeAiUsageEvents(db, batch({ attempts: [] }))).toBe(0);
  });

  it('keeps profile metadata nullable for non-profile runtime calls', async () => {
    await writeAiUsageEvents(db, batch({ profileMetadata: null }));
    const rows = await db.select().from(aiUsageEvents);
    expect(rows[0]).toMatchObject({
      profileName: null,
      profileVersion: null,
      outputSchemaVersion: null,
      promptTemplateId: null,
      promptTemplateVersion: null,
      qualityFlags: null,
    });
  });

  it('sums actual-or-estimated spend by account and rolling window', async () => {
    await writeAiUsageEvents(db, batch());
    await writeAiUsageEvents(db, batch({
      accountId: 'account-2',
      correlationId: 'correlation-2',
    }));
    expect(await getAccountAiSpendMicros(
      db,
      'account-1',
      new Date('2026-07-15T09:00:00Z'),
    )).toBe(290n);
    expect(await getAccountAiSpendMicros(
      db,
      'account-1',
      new Date('2026-07-15T11:00:00Z'),
    )).toBe(0n);
  });

  it('exposes a store and spend guard without secret-bearing configuration', async () => {
    const store = createAiUsageStore(db);
    await store.persistAttempts(batch());
    expect(await store.getAccountSpendMicros(
      'account-1',
      new Date('2026-07-15T09:00:00Z'),
    )).toBe(290n);
    const guard = createAiSpendGuard(store, 60_000, 500n);
    expect(guard).toMatchObject({ windowMs: 60_000, limitMicros: 500n });
    expect(await guard.getAccountSpendMicros(
      'account-1',
      new Date('2026-07-15T09:00:00Z'),
    )).toBe(290n);
    expect(guard).not.toHaveProperty('apiKey');
  });

  it('purges only rows strictly older than the configured retention', async () => {
    const now = new Date('2026-07-15T12:00:00Z');
    await writeAiUsageEvents(db, batch({
      correlationId: 'old',
      createdAt: new Date('2026-06-14T11:59:59Z'),
    }));
    await writeAiUsageEvents(db, batch({
      correlationId: 'boundary',
      createdAt: new Date('2026-06-15T12:00:00Z'),
    }));
    await writeAiUsageEvents(db, batch({ correlationId: 'fresh', createdAt: now }));
    expect(await pruneOldAiUsageEvents(db, 30, now)).toBe(2);
    const remaining = await db.select().from(aiUsageEvents);
    expect(new Set(remaining.map((row) => row.correlationId))).toEqual(
      new Set(['boundary', 'fresh']),
    );
  });

  it('creates all required query indexes through the forward migration', async () => {
    const indexes = await db.execute(sql`
      select indexname from pg_indexes where tablename = 'ai_usage_events'
    `);
    const names = indexes.rows.map((row) => String(row.indexname));
    expect(names).toEqual(expect.arrayContaining([
      'ai_usage_events_account_created_idx',
      'ai_usage_events_provider_created_idx',
      'ai_usage_events_task_created_idx',
      'ai_usage_events_correlation_idx',
      'ai_usage_events_account_correlation_ordinal_uidx',
    ]));
  });

  it('provides the daily scheduled-delete processor', async () => {
    await writeAiUsageEvents(db, batch({ createdAt: new Date('2020-01-01T00:00:00Z') }));
    const result = await createAiUsagePruneProcessor(db, 30)();
    expect(result).toEqual({ pruned: 2 });
  });
});
