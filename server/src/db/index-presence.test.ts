/**
 * Index presence assertions.
 *
 * Verifies the schema+migration set produces exactly the indexes the review
 * required: new `keywords_account_active_idx` present, redundant
 * `rankings_keyword_checkedAt_desc_idx` absent. Runs against the PGlite
 * harness applying every migration from scratch — so a re-emitted DDL in
 * the generated SQL would surface here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  startTestPostgres,
  stopTestPostgres,
  type TestDb,
} from '../shared/testing/postgres.js';
import { AuditRun } from '../modules/audits/index.js';
import { Site } from '../modules/sites/index.js';
import { AuditLog } from '../modules/audit/index.js';

let db: TestDb;

beforeAll(async () => {
  db = await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});

describe('Postgres index presence', () => {
  it('adds `keywords_account_active_idx`', async () => {
    const result = await db.execute(
      sql`select indexname from pg_indexes where tablename = 'keywords'`,
    );
    const names = result.rows.map((r) => (r as { indexname: string }).indexname);
    expect(names).toContain('keywords_account_active_idx');
  });

  it('drops the redundant `rankings_keyword_checkedAt_desc_idx`', async () => {
    const result = await db.execute(
      sql`select indexname from pg_indexes where tablename = 'rankings'`,
    );
    const names = result.rows.map((r) => (r as { indexname: string }).indexname);
    expect(names).not.toContain('rankings_keyword_checkedAt_desc_idx');
    // The unique index that serves DESC via backward scan is still there.
    expect(names).toContain('rankings_keyword_checkedAt_idx');
  });
});

describe('Mongoose index specs', () => {
  it('AuditRun ships {siteId:1,_id:-1} + {createdAt:-1}', () => {
    const specs = AuditRun.schema.indexes().map(([keys]) => keys);
    expect(specs).toContainEqual({ siteId: 1, _id: -1 });
    expect(specs).toContainEqual({ createdAt: -1 });
  });

  it('Site no longer declares a redundant single-field {accountId} index', () => {
    // Mongoose puts explicit compound + partial indexes on `schema.indexes()`
    // and inline single-field `index: true` on `schema.paths.<name>._index`.
    // Both surfaces should be empty for `accountId`.
    expect(Site.schema.paths.accountId?.options?.index).toBeFalsy();
  });

  it('AuditLog no longer declares a redundant single-field {actorUserId} index', () => {
    expect(AuditLog.schema.paths.actorUserId?.options?.index).toBeFalsy();
    // The compound one is still present.
    const specs = AuditLog.schema.indexes().map(([keys]) => keys);
    expect(specs).toContainEqual({ actorUserId: 1, createdAt: -1 });
  });
});
