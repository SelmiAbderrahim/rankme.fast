import { UnrecoverableError, type Job } from 'bullmq';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { createFakeGscProvider } from '../../shared/providers/index.js';
import {
  readSearchAnalytics,
  upsertSearchAnalytics,
  upsertSitemaps,
} from '../gsc-snapshots/index.js';
import { Site } from '../sites/index.js';
import {
  createGscSyncProcessor,
  setGoogleConnectionsDb,
  upsertConnection,
  type GscInsightsPersistence,
  type GscSyncDeps,
  SCOPE_GSC,
} from './index.js';

// endDate = FIXED_NOW - 3 days (Google's data lag).
const FIXED_NOW = () => new Date('2026-07-07T12:00:00.000Z');
const EXPECTED_END = '2026-07-04';
const SITE_ID = 'cccccccccccccccccccccccc';

/** Real Postgres persist seam so the processor's rows actually land. */
function pgPersist(): GscInsightsPersistence {
  const db = getTestDb() as never;
  return {
    upsertSearchAnalytics: (input) => upsertSearchAnalytics(db, input),
    upsertSitemaps: (input) => upsertSitemaps(db, input),
    readPreviousTotals: async () => null,
  };
}

/** Minimal BullMQ Job stand-in — the processor only reads `job.data`. */
function job(data: unknown): Job {
  return { data } as unknown as Job;
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
  setGoogleConnectionsDb(getTestDb() as unknown as never);
});

async function seedConnected(): Promise<string> {
  const accountId = new mongoose.Types.ObjectId().toString();
  await upsertConnection({
    accountId,
    googleAccountEmail: 'user@example.com',
    refreshToken: 'r',
    scopes: [SCOPE_GSC],
  });
  return accountId;
}

describe('createGscSyncProcessor', () => {
  it('parses a valid job and delegates to runGscSync with the parsed data', async () => {
    const accountId = await seedConnected();
    await Site.create({
      _id: SITE_ID,
      accountId,
      url: 'https://example.com',
      domain: 'example.com',
      gscPropertyUrl: 'sc-domain:example.com',
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
    });
    const deps: GscSyncDeps = {
      gscProvider: createFakeGscProvider(),
      persist: pgPersist(),
      now: FIXED_NOW,
    };
    const processor = createGscSyncProcessor(deps);
    const result = await processor(
      job({ accountId, siteId: SITE_ID, domain: 'example.com' }),
    );
    // A real run happened for THIS account+site+domain: the credential is
    // connected and the Site is bound, so the snapshot persisted at endDate.
    expect(result.status).toBe('ok');
    expect(result.snapshotDate).toBe(EXPECTED_END);
    expect(result.counts.query).toBeGreaterThan(0);
    // The parsed siteId reached the persistence layer.
    const rows = await readSearchAnalytics(getTestDb() as never, SITE_ID, 'query', {
      since: EXPECTED_END,
      until: EXPECTED_END,
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('returns the delegated status when the account is not connected', async () => {
    const accountId = new mongoose.Types.ObjectId().toString();
    const processor = createGscSyncProcessor({
      gscProvider: createFakeGscProvider(),
      persist: pgPersist(),
      now: FIXED_NOW,
    });
    const result = await processor(
      job({ accountId, siteId: SITE_ID, domain: 'example.com' }),
    );
    expect(result.status).toBe('not-connected');
    expect(result.snapshotDate).toBeNull();
  });

  it('throws UnrecoverableError on a malformed payload (straight to dead-letter, no retries)', async () => {
    const processor = createGscSyncProcessor({
      gscProvider: createFakeGscProvider(),
      persist: pgPersist(),
    });
    await expect(processor(job({ accountId: 'not-hex' }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
