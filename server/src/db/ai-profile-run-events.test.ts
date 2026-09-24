import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiProfileRunEvent } from '../shared/ai-profiles/index.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  type TestDb,
} from '../shared/testing/postgres.js';
import {
  createAiProfileRunRecorder,
  writeAiProfileRunEvent,
} from './ai-profile-run-events.js';
import { aiProfileRunEvents } from './schema/ai-profile-run-events.js';

let db: TestDb;

beforeAll(async () => {
  db = await startTestPostgres();
});
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

function event(overrides: Partial<AiProfileRunEvent> = {}): AiProfileRunEvent {
  return {
    accountId: 'account-1', siteId: 'site-1', jobId: 'job-1',
    correlationId: 'profile-run-1', task: 'audit_summary', profileVersion: '1.0.0',
    outputSchemaVersion: '1', promptTemplateId: 'audit-summary',
    promptTemplateVersion: '1', status: 'partial', provider: 'openai',
    model: 'operator-model', attempts: 2, fallbackUsed: true, latencyMs: 25,
    costMicros: 42n, qualityFlags: ['citation_rejected', 'partial', 'provider_fallback'],
    createdAt: new Date('2026-07-15T12:00:00Z'),
    ...overrides,
  };
}

describe('content-free AI profile run events', () => {
  it('persists safe comparison dimensions without prompt or completion columns', async () => {
    expect(await writeAiProfileRunEvent(db, event())).toBe(true);
    const rows = await db.select().from(aiProfileRunEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task: 'audit_summary', profileVersion: '1.0.0', outputSchemaVersion: '1',
      promptTemplateId: 'audit-summary', promptTemplateVersion: '1', status: 'partial',
      provider: 'openai', attempts: 2, fallbackUsed: true, latencyMs: 25,
      costMicros: 42n, qualityFlags: ['citation_rejected', 'partial', 'provider_fallback'],
    });
    expect(Object.keys(rows[0] ?? {})).not.toEqual(expect.arrayContaining([
      'prompt', 'systemInstruction', 'completion', 'pageContent', 'excerpt',
      'competitorSnippet', 'input', 'output',
    ]));
    expect(JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? value.toString() : value))
      .not.toContain('generated completion');
  });

  it('is idempotent and exposes the recorder adapter', async () => {
    const record = createAiProfileRunRecorder(db);
    await record(event());
    expect(await writeAiProfileRunEvent(db, event())).toBe(false);
    expect(await db.select().from(aiProfileRunEvents)).toHaveLength(1);
  });

  it('creates profile/time, provider/time, status/time, account/time, and correlation indexes', async () => {
    const indexes = await db.execute(sql`
      select indexname from pg_indexes where tablename = 'ai_profile_run_events'
    `);
    expect(indexes.rows.map((row) => String(row.indexname))).toEqual(expect.arrayContaining([
      'ai_profile_run_events_account_correlation_uidx',
      'ai_profile_run_events_account_created_idx',
      'ai_profile_run_events_task_created_idx',
      'ai_profile_run_events_provider_created_idx',
      'ai_profile_run_events_status_created_idx',
    ]));
  });
});
