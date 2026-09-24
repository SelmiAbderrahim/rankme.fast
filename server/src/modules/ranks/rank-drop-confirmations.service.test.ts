/**
 * Confirmation service unit tests.
 *
 * PGlite is the real data store so the schema CHECKs, unique constraints, and
 * FK cascades participate in every assertion. External collaborators are
 * injected fakes so the service can be exercised in isolation.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import {
  applyTestMigrations,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  type TestDb,
} from '../../shared/testing/postgres.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import { rankDropConfirmations } from '../../db/schema/rank-drop-confirmations.js';
import {
  ProviderError,
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from '../../shared/providers/errors.js';
import type {
  RankCheckInput,
  RankCheckResult,
  RankProvider,
} from '../../shared/providers/types.js';
import {
  classifyProviderError,
  confirmRankDrop,
  toConfirmationDto,
  type AlertEffects,
  type ConfirmationCandidate,
} from './rank-drop-confirmations.service.js';
import { createRankDropConfirmationHandler } from './rank-drop-confirmations.wiring.js';
import * as repo from './rank-drop-confirmations.repo.js';

vi.mock(import('./rank-drop-confirmations.repo.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, claimProviderCall: vi.fn(actual.claimProviderCall) };
});

let testDb: TestDb;

beforeEach(async () => {
  if (!testDb) {
    testDb = await startTestPostgres();
  } else {
    await truncateAllTables();
    // truncateAllTables leaves the schema in place — no need to re-migrate.
  }
});

afterAll(async () => {
  await stopTestPostgres();
});

// PgliteDatabase and postgres-js Db expose the same drizzle surface for our
// queries; the cast is only for compile-time compatibility in tests.
function asDb(): Db {
  return testDb as unknown as Db;
}

const ACCOUNT_ID = '507f1f77bcf86cd799439011';
const SITE_ID = '507f1f77bcf86cd799439012';

async function seedCandidate(): Promise<ConfirmationCandidate> {
  const [kw] = await testDb
    .insert(keywords)
    .values({
      accountId: ACCOUNT_ID,
      siteId: SITE_ID,
      phrase: 'best ai seo tool',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    })
    .returning();
  if (!kw) throw new Error('seed keyword missing');
  const observedAt = new Date('2026-07-01T12:00:00Z');
  const [rank] = await testDb
    .insert(rankings)
    .values({
      keywordId: kw.id,
      position: 15,
      checkedAt: observedAt,
      source: 'fresh',
    })
    .returning();
  if (!rank) throw new Error('seed ranking missing');
  return {
    accountId: ACCOUNT_ID,
    siteId: SITE_ID,
    siteUrl: 'https://rankme.example',
    keywordId: kw.id,
    keyword: 'best ai seo tool',
    rankingId: rank.id,
    previousPosition: 7,
    candidatePosition: 15,
    candidateObservedAt: observedAt,
    locationCode: 2840,
    languageCode: 'en',
    device: 'desktop',
    domain: 'rankme.example',
    engine: 'google',
    engineTarget: null,
  };
}

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function makeEffects(): AlertEffects & {
  deliverEmail: ReturnType<typeof vi.fn>;
  requestAutoRerun: ReturnType<typeof vi.fn>;
} {
  return {
    deliverEmail: vi.fn().mockResolvedValue(undefined),
    requestAutoRerun: vi.fn().mockResolvedValue(undefined),
  };
}

function makeProvider(result: RankCheckResult | (() => Promise<RankCheckResult>)): RankProvider {
  return {
    checkRank: vi
      .fn()
      .mockImplementation(async (_input: RankCheckInput) =>
        typeof result === 'function' ? result() : result,
      ),
    checkLocalPackRank: vi.fn(),
    checkAltEngineRank: vi
      .fn()
      .mockRejectedValue(
        new Error('unused: alt-engine rank checks are not exercised in this suite'),
      ),
    searchPublicPages: vi
      .fn()
      .mockRejectedValue(new Error('unused: makeProvider does not implement searchPublicPages')),
  };
}

describe('classifyProviderError', () => {
  it('maps every ProviderError subclass to an allowlisted reason', () => {
    const ctx = { provider: 'x', operation: 'y' } as const;
    expect(classifyProviderError(new VendorTimeoutError('t', ctx))).toBe('provider_timeout');
    expect(classifyProviderError(new VendorQuotaError('q', ctx))).toBe('provider_quota');
    expect(classifyProviderError(new VendorMalformedError('m', ctx))).toBe('provider_malformed');
    expect(classifyProviderError(new VendorAuthError('a', ctx))).toBe('provider_unavailable');
    expect(classifyProviderError(new VendorUnavailableError('u', ctx))).toBe(
      'provider_unavailable',
    );
    expect(classifyProviderError(new Error('unknown'))).toBe('provider_unavailable');
  });

  it('maps a bare ProviderError (no vendor subclass) to provider_unavailable', () => {
    // A provider that rejects with the taxonomy base class — e.g. a new
    // adapter that has not yet chosen a specific subclass — must still land on
    // an allowlisted reason instead of leaking its message.
    const err = new ProviderError('raw vendor detail', true, {
      provider: 'x',
      operation: 'y',
    });
    expect(classifyProviderError(err)).toBe('provider_unavailable');
  });
});

describe('toConfirmationDto', () => {
  it('serializes an unsettled confirmation with a null confirmation time', async () => {
    const candidate = await seedCandidate();
    const [row] = await testDb
      .insert(rankDropConfirmations)
      .values({
        accountId: candidate.accountId,
        siteId: candidate.siteId,
        keywordId: candidate.keywordId,
        rankingId: candidate.rankingId,
        state: 'unconfirmed',
        reason: 'interrupted',
        previousPosition: 7,
        candidatePosition: 15,
        confirmationPosition: null,
        candidateObservedAt: candidate.candidateObservedAt,
        confirmationObservedAt: null,
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        attemptReservedAt: candidate.candidateObservedAt,
        settledAt: candidate.candidateObservedAt,
      })
      .returning();

    expect(toConfirmationDto(row!)).toEqual({
      id: row!.id,
      state: 'unconfirmed',
      reason: 'interrupted',
      previousPosition: 7,
      candidatePosition: 15,
      confirmationPosition: null,
      candidateObservedAt: '2026-07-01T12:00:00.000Z',
      confirmationObservedAt: null,
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });
  });

  it('serializes the confirmation observation time as ISO when present', async () => {
    const candidate = await seedCandidate();
    const [row] = await testDb
      .insert(rankDropConfirmations)
      .values({
        accountId: candidate.accountId,
        siteId: candidate.siteId,
        keywordId: candidate.keywordId,
        rankingId: candidate.rankingId,
        state: 'confirmed',
        reason: null,
        previousPosition: 7,
        candidatePosition: 15,
        confirmationPosition: 22,
        candidateObservedAt: candidate.candidateObservedAt,
        confirmationObservedAt: new Date('2026-07-01T12:05:00.000Z'),
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
        attemptReservedAt: candidate.candidateObservedAt,
        settledAt: candidate.candidateObservedAt,
      })
      .returning();

    const dto = toConfirmationDto(row!);
    expect(dto.state).toBe('confirmed');
    expect(dto.reason).toBeNull();
    expect(dto.confirmationPosition).toBe(22);
    expect(dto.confirmationObservedAt).toBe('2026-07-01T12:05:00.000Z');
    // The DTO never exposes account/site or the operational alert columns.
    expect(dto).not.toHaveProperty('accountId');
    expect(dto).not.toHaveProperty('alertClaimedAt');
  });
});

describe('confirmRankDrop', () => {
  it('confirmed: fresh observation still meets the drop → email + audit rerun fire', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    const provider = makeProvider({
      position: 18,
      checkedAt: new Date('2026-07-01T12:05:00Z'),
    });
    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });
    expect(result).toEqual({
      state: 'confirmed',
      reason: null,
      confirmationPosition: 18,
      dispatched: true,
      duplicate: false,
    });
    expect(effects.deliverEmail).toHaveBeenCalledTimes(1);
    expect(effects.requestAutoRerun).toHaveBeenCalledTimes(1);
    const [row] = await testDb.select().from(rankDropConfirmations);
    expect(row?.state).toBe('confirmed');
    expect(row?.alertClaimedAt).not.toBeNull();
    expect(row?.alertDeliveredAt).not.toBeNull();
    expect(row?.confirmationPosition).toBe(18);
  });

  it('confirmed with null "not ranked" result: still a drop → dispatches once', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    const provider = makeProvider({
      position: null,
      checkedAt: new Date('2026-07-01T12:05:00Z'),
    });
    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });
    expect(result.state).toBe('confirmed');
    expect(result.confirmationPosition).toBeNull();
    expect(effects.deliverEmail).toHaveBeenCalledTimes(1);
  });

  it('confirms an alternative engine through the same state machine', async () => {
    const candidate = {
      ...(await seedCandidate()),
      engine: 'bing' as const,
      engineTarget: null,
    };
    const effects = makeEffects();
    const provider = makeProvider({
      position: 99,
      checkedAt: new Date('2026-07-01T12:05:00Z'),
    });
    vi.mocked(provider.checkAltEngineRank).mockResolvedValue({
      engine: 'bing',
      position: 18,
      foundUrl: 'https://rankme.example/result',
      rows: [],
      checkedAt: new Date('2026-07-01T12:06:00Z'),
      observationMeta: {
        sourceKind: 'provider_observation',
        sourceLabel: 'dataforseo',
        observedAt: '2026-07-01T12:06:00.000Z',
        freshUntil: null,
        freshness: 'fresh',
        market: null,
        sampleCount: 1,
        coverageNoteKey: null,
      },
    });

    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });

    expect(result.state).toBe('confirmed');
    expect(provider.checkRank).not.toHaveBeenCalled();
    expect(provider.checkAltEngineRank).toHaveBeenCalledWith({
      engine: 'bing',
      keyword: candidate.keyword,
      domain: candidate.domain,
      engineTarget: null,
      locationCode: candidate.locationCode,
      languageCode: candidate.languageCode,
      device: candidate.device,
    });
  });

  it('volatile: fresh observation recovered → no email, no audit rerun', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    const provider = makeProvider({
      position: 6,
      checkedAt: new Date('2026-07-01T12:05:00Z'),
    });
    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });
    expect(result.state).toBe('volatile');
    expect(result.dispatched).toBe(false);
    expect(effects.deliverEmail).not.toHaveBeenCalled();
    expect(effects.requestAutoRerun).not.toHaveBeenCalled();
    const [row] = await testDb.select().from(rankDropConfirmations);
    expect(row?.state).toBe('volatile');
    expect(row?.alertClaimedAt).toBeNull();
  });

  it('unconfirmed: provider timeout → records reason, no effects', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    const provider: RankProvider = {
      checkRank: vi.fn().mockRejectedValue(
        new VendorTimeoutError('deadline', {
          provider: 'dataforseo',
          operation: 'serp',
        }),
      ),
      checkLocalPackRank: vi.fn(),
      checkAltEngineRank: vi
        .fn()
        .mockRejectedValue(
          new Error('unused: alt-engine rank checks are not exercised in this suite'),
        ),
      searchPublicPages: vi.fn().mockRejectedValue(new Error('unused')),
    };
    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });
    expect(result.state).toBe('unconfirmed');
    expect(result.reason).toBe('provider_timeout');
    expect(effects.deliverEmail).not.toHaveBeenCalled();
  });

  it('unconfirmed: provider malformed → records reason, no effects', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    const provider: RankProvider = {
      checkRank: vi.fn().mockRejectedValue(
        new VendorMalformedError('bad shape', {
          provider: 'dataforseo',
          operation: 'serp',
        }),
      ),
      checkLocalPackRank: vi.fn(),
      checkAltEngineRank: vi
        .fn()
        .mockRejectedValue(
          new Error('unused: alt-engine rank checks are not exercised in this suite'),
        ),
      searchPublicPages: vi.fn().mockRejectedValue(new Error('unused')),
    };
    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });
    expect(result.reason).toBe('provider_malformed');
    expect(effects.deliverEmail).not.toHaveBeenCalled();
  });

  it('replay: second call with same rankingId is a no-op — one row, one dispatch', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    const provider = makeProvider({
      position: 20,
      checkedAt: new Date('2026-07-01T12:05:00Z'),
    });
    const first = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });
    const second = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });
    expect(first.dispatched).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.dispatched).toBe(false);
    expect(effects.deliverEmail).toHaveBeenCalledTimes(1);
    const rows = await testDb.select().from(rankDropConfirmations);
    expect(rows).toHaveLength(1);
    expect(provider.checkRank).toHaveBeenCalledTimes(1);
  });

  it('records email_failed and continues when the alert email throws', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    effects.deliverEmail.mockRejectedValue(new Error('smtp down: SECRET-host'));
    const provider = makeProvider({
      position: 18,
      checkedAt: new Date('2026-07-01T12:05:00Z'),
    });

    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });

    // A failed side effect never un-confirms the drop and never blocks the
    // audit rerun — the failure is recorded as a category key only.
    expect(result.state).toBe('confirmed');
    expect(result.dispatched).toBe(true);
    expect(effects.requestAutoRerun).toHaveBeenCalledTimes(1);
    const [row] = await testDb.select().from(rankDropConfirmations);
    expect(row!.alertError).toBe('email_failed');
    expect(row!.alertDeliveredAt).not.toBeNull();
  });

  it('records audit_rerun_failed and continues when the rerun request throws', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    effects.requestAutoRerun.mockRejectedValue(new Error('queue offline'));
    const provider = makeProvider({
      position: 18,
      checkedAt: new Date('2026-07-01T12:05:00Z'),
    });

    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });

    expect(result.state).toBe('confirmed');
    expect(result.dispatched).toBe(true);
    expect(effects.deliverEmail).toHaveBeenCalledTimes(1);
    const [row] = await testDb.select().from(rankDropConfirmations);
    expect(row!.alertError).toBe('audit_rerun_failed');
    expect(row!.alertDeliveredAt).not.toBeNull();
  });

  it('does NOT call the provider when a concurrent worker already crossed the vendor-call boundary', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    const provider = makeProvider({
      position: 18,
      checkedAt: new Date('2026-07-01T12:05:00Z'),
    });
    // Simulate the racer: between our attempt insert and our provider claim,
    // another worker stamped `provider_called_at`. Our claim must lose and the
    // vendor must NOT be invoked a second time.
    const actual = await vi.importActual<typeof repo>('./rank-drop-confirmations.repo.js');
    vi.mocked(repo.claimProviderCall).mockImplementationOnce(async (db, id, at) => {
      await testDb
        .update(rankDropConfirmations)
        .set({ providerCalledAt: new Date('2026-07-01T12:01:00Z') })
        .where(eq(rankDropConfirmations.rankingId, candidate.rankingId));
      return actual.claimProviderCall(db, id, at);
    });

    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });

    expect(result).toEqual({
      state: 'unconfirmed',
      reason: null,
      confirmationPosition: null,
      dispatched: false,
      duplicate: true,
    });
    expect(provider.checkRank).not.toHaveBeenCalled();
    expect(effects.deliverEmail).not.toHaveBeenCalled();
  });

  it('does NOT dispatch when a concurrent worker already claimed the alert', async () => {
    const candidate = await seedCandidate();
    const effects = makeEffects();
    // Simulate the racer settling the SAME row to confirmed and taking the
    // single-winner alert claim while our provider call was in flight.
    const provider = makeProvider(async () => {
      await testDb
        .update(rankDropConfirmations)
        .set({
          state: 'confirmed',
          reason: null,
          confirmationPosition: 18,
          confirmationObservedAt: new Date('2026-07-01T12:04:00Z'),
          alertClaimedAt: new Date('2026-07-01T12:04:30Z'),
        })
        .where(eq(rankDropConfirmations.rankingId, candidate.rankingId));
      return { position: 18, checkedAt: new Date('2026-07-01T12:05:00Z') };
    });

    const result = await confirmRankDrop(candidate, {
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });

    expect(result).toEqual({
      state: 'confirmed',
      reason: null,
      confirmationPosition: 18,
      dispatched: false,
      duplicate: false,
    });
    // At-most-one dispatch: the racer owns the alert, we must stay silent.
    expect(effects.deliverEmail).not.toHaveBeenCalled();
    expect(effects.requestAutoRerun).not.toHaveBeenCalled();
    const [stored] = await testDb.select().from(rankDropConfirmations);
    expect(stored!.alertClaimedAt?.toISOString()).toBe('2026-07-01T12:04:30.000Z');
    expect(stored!.alertDeliveredAt).toBeNull();
  });

  it('schema CHECK: forbids state != unconfirmed with reason set', async () => {
    const candidate = await seedCandidate();
    // Direct DB assertion — a bug that tries to write a confirmed row WITH a
    // reason must fail at the CHECK, never silently succeed.
    await expect(
      testDb.execute(
        sql`INSERT INTO rank_drop_confirmations
              (account_id, site_id, keyword_id, ranking_id, state, reason,
               candidate_observed_at, location_code, language_code, device,
               attempt_reserved_at, settled_at, confirmation_observed_at)
              VALUES (${candidate.accountId}, ${candidate.siteId}, ${candidate.keywordId}, ${candidate.rankingId},
                      'confirmed', 'provider_timeout',
                      NOW(), 2840, 'en', 'desktop',
                      NOW(), NOW(), NOW())`,
      ),
    ).rejects.toThrow();
  });

  it('schema CHECK: forbids alert_claimed_at on non-confirmed rows', async () => {
    const candidate = await seedCandidate();
    await expect(
      testDb.execute(
        sql`INSERT INTO rank_drop_confirmations
              (account_id, site_id, keyword_id, ranking_id, state, reason,
               candidate_observed_at, location_code, language_code, device,
               attempt_reserved_at, settled_at, alert_claimed_at)
              VALUES (${candidate.accountId}, ${candidate.siteId}, ${candidate.keywordId}, ${candidate.rankingId},
                      'unconfirmed', 'interrupted',
                      NOW(), 2840, 'en', 'desktop',
                      NOW(), NOW(), NOW())`,
      ),
    ).rejects.toThrow();
  });
});

describe('createRankDropConfirmationHandler', () => {
  it('wires the fresh provider confirmation, effects, and the injected clock', async () => {
    const candidate = await seedCandidate();
    const provider = makeProvider({
      position: 18,
      checkedAt: new Date('2026-07-01T12:05:00.000Z'),
    });
    const effects = makeEffects();
    const handler = createRankDropConfirmationHandler({
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
      now: () => new Date('2026-07-01T12:06:00.000Z'),
    });

    const result = await handler(candidate);

    expect(result.state).toBe('confirmed');
    expect(provider.checkRank).toHaveBeenCalledTimes(1);
    expect(effects.deliverEmail).toHaveBeenCalledTimes(1);
    const [row] = await testDb.select().from(rankDropConfirmations);
    expect(row!.settledAt.toISOString()).toBe('2026-07-01T12:06:00.000Z');
    expect(row!.alertDeliveredAt?.toISOString()).toBe('2026-07-01T12:06:00.000Z');
  });

  it('settles a failed alternative-engine confirmation as unconfirmed with the default clock', async () => {
    const candidate = {
      ...(await seedCandidate()),
      engine: 'bing' as const,
      engineTarget: null,
    };
    const provider = makeProvider({
      position: 99,
      checkedAt: new Date('2026-07-01T12:05:00.000Z'),
    });
    vi.mocked(provider.checkAltEngineRank).mockRejectedValue(
      new VendorTimeoutError('deadline', {
        provider: 'dataforseo',
        operation: 'alt-engine-bing-organic',
      }),
    );
    const effects = makeEffects();
    const handler = createRankDropConfirmationHandler({
      db: asDb(),
      provider,
      effects,
      logger: makeLogger(),
    });

    await expect(handler(candidate)).resolves.toMatchObject({
      state: 'unconfirmed',
      reason: 'provider_timeout',
    });
    expect(provider.checkRank).not.toHaveBeenCalled();
    expect(effects.deliverEmail).not.toHaveBeenCalled();
  });
});

describe('migration application', () => {
  it('re-running migrations against the same schema is a no-op', async () => {
    // The startTestPostgres beforeEach already applied all migrations. Apply
    // them again — drizzle records the journal and skips previously-applied
    // migrations. The absence of an error IS the regression assertion.
    await applyTestMigrations();
  });
});
