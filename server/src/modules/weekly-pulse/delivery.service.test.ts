/**
 * Weekly Pulse — delivery service (spec §10) tests.
 *
 * Uses PGlite to persist projection + subscription + delivery-event rows.
 * Injects a stub Resend transport so no real network call happens.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  sitePulseSubscriptions,
  weeklyPulseDeliveryEvents,
  weeklyPulseDigestProjections,
  weeklyPulseRuns,
} from '../../db/schema/weekly-pulse.js';
import { SUPPORTED_LOCALES, translate } from '../../shared/i18n/index.js';
import {
  deliverPulseDigest,
  MissingProjectionError,
  renderPlainTextBody,
  RetryablePulseDeliveryError,
  WEEKLY_PULSE_DELIVERY_LEASE_MS,
  weeklyPulseDeliveryTestables,
  type DeliverPulseDigestDeps,
} from './delivery.service.js';
import type { DigestProjectionPayload } from './digest.renderer.js';

type DigestEmailMessage = Parameters<DeliverPulseDigestDeps['sendEmail']>[0];

function baseProjection(): DigestProjectionPayload {
  return {
    header: {
      siteId: 'site-1',
      siteLabel: 'Example Inc',
      isoWeek: '2026-W01',
      market: { country: 'US' },
      renderedAt: '2026-01-05T09:00:00.000Z',
    },
    coverage: {
      supported: 2,
      total: 3,
      supportedCells: [
        { engine: 'chatgpt', surface: 'mentions' },
        { engine: 'perplexity', surface: 'mentions' },
      ],
      partial: true,
    },
    citations_new: [
      {
        citationId: 'c1',
        engine: 'chatgpt',
        surface: 'mentions',
        host: 'a.example',
        canonicalUrl: 'https://a.example/a',
        titleSafe: 'A',
      },
    ],
    citations_lost: [],
    citations_unknown_partial: [],
    confirmed_rank_drops: [
      { keyword: 'foo', priorRank: 3, currentRank: 8, confirmedAt: '2026-01-03T00:00:00Z' },
    ],
    actions_completed: [
      {
        actionId: 'a-c',
        messageKey: 'weeklyPulse.actions.completed',
        targetUrl: 'https://example.test/sitemap',
        state: 'completed',
      },
    ],
    actions_regressed: [],
    next_actions_top3: [
      {
        actionId: 'a-top',
        messageKey: 'weeklyPulse.actions.open',
        targetUrl: 'https://example.test/meta',
        state: 'open',
      },
    ],
    gsc_appearance: {
      status: 'available',
      window: { start: '2025-12-08', end: '2026-01-04' },
      rows: [
        {
          rawAppearance: 'AI_OVERVIEW',
          classificationSlug: 'ai_overviews',
          isGenerative: true,
          clicks: 5,
          impressions: 120,
          ctr: 0.041,
          position: 4.2,
        },
      ],
    },
    brand_deltas: [
      {
        queryHash: 'a'.repeat(64),
        brandQuerySafe: 'acme crm',
        currentScanId: 'scan-2',
        previousScanId: 'scan-1',
        hasNewScan: true,
        newMentionCount: 4,
        sentimentShift: { positive: 5, neutral: -2, negative: -3, unknown: 0 },
      },
    ],
    deep_links: {
      digest: 'https://client.example/dashboard/sites/site-1?tab=ai-visibility&pulse=run-1',
      aiVisibility: 'https://client.example/dashboard/sites/site-1?tab=ai-visibility',
      google: 'https://client.example/dashboard/sites/site-1?tab=google',
      contentIntelligence: 'https://client.example/dashboard/sites/site-1?tab=content',
      audienceResearch: 'https://client.example/dashboard/sites/site-1?tab=audience-research',
      nextActions: 'https://client.example/dashboard/next-actions',
    },
  };
}

describe('renderPlainTextBody — bounded content in every locale', () => {
  it.each(SUPPORTED_LOCALES)('renders %s without raw content', (locale) => {
    const body = renderPlainTextBody(locale, baseProjection());
    expect(body.length).toBeGreaterThan(0);
    // No raw-content contamination — subject/body should NEVER contain
    // vendor task ids, cost internals, source excerpts, or "answer" markers.
    expect(body).not.toMatch(/task_?id/i);
    expect(body).not.toMatch(/cost_micros/);
    expect(body).not.toMatch(/answer:/i);
    expect(body).not.toMatch(/prompt_text/);
    // Deep links MUST come from the projection (CLIENT_URL-derived).
    expect(body).toContain('https://client.example');
  });

  it('renders honest empty state for all-empty sections', () => {
    const projection = baseProjection();
    projection.citations_new = [];
    projection.citations_lost = [];
    projection.citations_unknown_partial = [];
    projection.confirmed_rank_drops = [];
    projection.actions_completed = [];
    projection.actions_regressed = [];
    projection.next_actions_top3 = [];
    const body = renderPlainTextBody('en', projection);
    expect(body).toContain('No new citations this week.');
    expect(body).toContain('You are up to date');
  });

  it('omits the partial-coverage warning when coverage is complete', () => {
    // The "some engines returned partial data" line is a caveat — printing it
    // on a fully-covered week would understate the result.
    const projection = baseProjection();
    projection.coverage = {
      supported: 2,
      total: 2,
      supportedCells: [
        { engine: 'chatgpt', surface: 'mentions' },
        { engine: 'perplexity', surface: 'mentions' },
      ],
      partial: false,
    };
    // Keep the GSC section off the `partial` string too, so the assertion below
    // can only fail because of the coverage caveat.
    projection.gsc_appearance = { status: 'unavailable', window: null, rows: [] };
    const body = renderPlainTextBody('en', projection);
    expect(body).not.toContain('Some engines returned partial data');
    expect(body).toContain('2 of 2');

    projection.coverage.partial = true;
    expect(renderPlainTextBody('en', projection)).toContain(
      'Some engines returned partial data',
    );
  });

  it('renders reconnect message when GSC status is reconnect_required', () => {
    const projection = baseProjection();
    projection.gsc_appearance = { status: 'reconnect_required', window: null, rows: [] };
    const body = renderPlainTextBody('en', projection);
    expect(body).toContain('Reconnect Google Search Console');
  });

  it('renders partial message when GSC status is partial', () => {
    const projection = baseProjection();
    projection.gsc_appearance = { status: 'partial', window: null, rows: [] };
    const body = renderPlainTextBody('en', projection);
    expect(body).toContain('Some engines returned partial data');
  });

  it('renders unavailable message when GSC status is unavailable', () => {
    const projection = baseProjection();
    projection.gsc_appearance = { status: 'unavailable', window: null, rows: [] };
    const body = renderPlainTextBody('en', projection);
    expect(body).toContain('No generative AI appearance');
  });

  it('renders unavailable branch when GSC status is failed (default else)', () => {
    const projection = baseProjection();
    projection.gsc_appearance = { status: 'failed', window: null, rows: [] };
    const body = renderPlainTextBody('en', projection);
    expect(body).toContain('No generative AI appearance');
  });

  it('renders "?" for null prior/current ranks', () => {
    const projection = baseProjection();
    projection.confirmed_rank_drops = [
      { keyword: 'foo', priorRank: null, currentRank: null, confirmedAt: '2026-01-03T00:00:00Z' },
    ];
    const body = renderPlainTextBody('en', projection);
    expect(body).toContain('was ?, now ?');
  });
});

describe('deliverPulseDigest — DB-backed delivery', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });

  afterAll(async () => {
    await stopTestPostgres();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  async function seedRunAndProjection({
    accountId = 'acct-1',
    siteId = 'site-1',
    isoWeek = '2026-W01',
    payload = baseProjection(),
  } = {}) {
    const insertedRun = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId,
        siteId,
        isoWeek,
        status: 'completed',
        marketSnapshot: { country: 'US' },
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        engineSurfaceSet: [
          { engine: 'chatgpt', surface: 'mentions', supported: true, reason: null },
        ],
        observationMeta: { window: { end: '2026-01-05T00:00:00Z' } },
        usageReference: {},
        counts: {},
        startedAt: new Date('2026-01-05T07:00:00.000Z'),
        finishedAt: new Date('2026-01-05T08:00:00.000Z'),
        createdAt: new Date('2026-01-05T07:00:00.000Z'),
        updatedAt: new Date('2026-01-05T08:00:00.000Z'),
      })
      .returning({ id: weeklyPulseRuns.id });
    const runId = insertedRun[0]!.id;
    await getTestDb().insert(weeklyPulseDigestProjections).values({
      pulseRunId: runId,
      payload: payload as unknown as object,
    });
    return { runId, accountId, siteId };
  }

  async function subscribe(
    accountId: string,
    siteId: string,
    userId: string,
    locale = 'en',
    disabled = false,
  ) {
    await getTestDb().insert(sitePulseSubscriptions).values({
      accountId,
      siteId,
      userId,
      locale,
      enabledAt: new Date('2026-01-04T09:00:00.000Z'),
      ...(disabled
        ? { disabledAt: new Date('2026-01-05T08:30:00.000Z') }
        : {}),
    });
  }

  function deps(overrides: Partial<DeliverPulseDigestDeps> = {}): DeliverPulseDigestDeps {
    const sendEmail = vi.fn(async () => ({ delivered: true, providerMessageId: 'msg-1' }));
    return {
      db: getTestDb() as unknown as DeliverPulseDigestDeps['db'],
      sendEmail,
      resolveRecipient: async ({ userId }) => ({
        email: `${userId}@example.com`,
        membership: 'active',
      }),
      transportAvailable: () => true,
      now: () => new Date('2026-01-05T09:00:00.000Z'),
      ...overrides,
    };
  }

  it('throws MissingProjectionError when no projection exists', async () => {
    await expect(
      deliverPulseDigest('11111111-1111-1111-1111-111111111111', deps()),
    ).rejects.toBeInstanceOf(MissingProjectionError);
  });

  it('throws MissingProjectionError when a store surfaces a projection whose run row is gone', async () => {
    // The shipped FK cascade makes this state unreachable in Postgres, so a
    // duck-typed store models a projection orphaned from its run.
    const orphanedStore = {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () =>
              table === weeklyPulseDigestProjections
                ? [{ payload: {} }]
                : [],
          }),
        }),
      }),
    } as unknown as DeliverPulseDigestDeps['db'];
    await expect(
      deliverPulseDigest(
        '22222222-2222-2222-2222-222222222222',
        deps({ db: orphanedStore }),
      ),
    ).rejects.toBeInstanceOf(MissingProjectionError);
  });

  it('delivers to one active recipient per site (one collection, one email)', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const outcome = await deliverPulseDigest(runId, deps());
    expect(outcome.delivered).toBe(1);
    expect(outcome.errors).toBe(0);
    expect(outcome.suppressed).toBe(0);

    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('delivered');
    expect(rows[0]!.providerMessageId).toBe('msg-1');
    expect(outcome.retryable).toBe(0);
  });

  it('returns an empty delivery outcome when the frozen cutoff has no recipients', async () => {
    const { runId } = await seedRunAndProjection();
    await expect(deliverPulseDigest(runId, deps())).resolves.toMatchObject({
      attempted: 0,
      delivered: 0,
      suppressed: 0,
      errors: 0,
      retryable: 0,
    });
  });

  it('uses the current clock as the recipient cutoff for legacy terminal rows', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await getTestDb()
      .update(weeklyPulseRuns)
      .set({ finishedAt: null })
      .where(eq(weeklyPulseRuns.id, runId));
    await subscribe(accountId, siteId, 'user-legacy', 'en');

    await expect(deliverPulseDigest(runId, deps())).resolves.toMatchObject({
      attempted: 1,
      delivered: 1,
    });
  });

  it('accepts an injected request fingerprint implementation', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const requestFingerprint = `request-hmac-v1:${'c'.repeat(64)}`;
    const beforeFingerprintBinding = vi.fn();

    await expect(
      deliverPulseDigest(
        runId,
        deps({
          fingerprintRequest: () => 'c'.repeat(64),
          beforeFingerprintBinding,
        }),
      ),
    ).resolves.toMatchObject({ delivered: 1 });
    expect(beforeFingerprintBinding).toHaveBeenCalledWith(
      expect.objectContaining({ requestFingerprint }),
    );
  });

  it('does not resend or rewrite a terminal delivery on retry', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const { now: _injected, ...withoutClock } = deps();
    await deliverPulseDigest(runId, withoutClock as DeliverPulseDigestDeps);
    const beforeRows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    const outcome = await deliverPulseDigest(
      runId,
      withoutClock as DeliverPulseDigestDeps,
    );
    expect(outcome.delivered).toBe(1);
    expect(withoutClock.sendEmail).toHaveBeenCalledOnce();

    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.updatedAt).toEqual(beforeRows[0]!.updatedAt);
  });

  it('is idempotent on retry (unique constraint UPSERTs same row)', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    await deliverPulseDigest(runId, deps());
    await deliverPulseDigest(runId, deps());
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows).toHaveLength(1);
  });

  it('replays a crash after provider acceptance with one opaque key and one visible email', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const providerAcceptances = new Map<string, string>();
    const keys: string[] = [];
    const sent: DigestEmailMessage[] = [];
    const sendEmail = vi.fn(async (message: DigestEmailMessage) => {
      keys.push(message.idempotencyKey);
      sent.push(message);
      const existing = providerAcceptances.get(message.idempotencyKey);
      if (existing) return { delivered: true, providerMessageId: existing };
      providerAcceptances.set(message.idempotencyKey, 'msg-crash-safe');
      return { delivered: true, providerMessageId: 'msg-crash-safe' };
    });

    await expect(
      deliverPulseDigest(
        runId,
        deps({
          sendEmail,
          afterProviderAccepted: async () => {
            throw new Error('simulated process death');
          },
        }),
      ),
    ).rejects.toThrow('simulated process death');
    const interrupted = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(interrupted[0]).toMatchObject({ status: 'queued', attempt: 1 });
    expect(interrupted[0]!.errorDetailSafe).toMatch(/^request-envelope-v1:/u);
    expect(interrupted[0]!.errorDetailSafe).not.toContain('user-1@example.com');
    expect(interrupted[0]!.errorDetailSafe).not.toContain('Weekly pulse');

    const outcome = await deliverPulseDigest(
      runId,
      deps({
        sendEmail,
        now: () =>
          new Date(
            new Date('2026-01-05T09:00:00.000Z').getTime() +
              WEEKLY_PULSE_DELIVERY_LEASE_MS +
              1,
          ),
      }),
    );
    expect(outcome).toMatchObject({ delivered: 1, retryable: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(new Set(keys).size).toBe(1);
    expect(providerAcceptances.size).toBe(1);
    expect(keys[0]).toMatch(/^weekly-pulse\/[0-9a-f-]{36}$/);
    expect(keys[0]).not.toContain('user-1');

    const settled = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(settled[0]).toMatchObject({
      status: 'delivered',
      attempt: 2,
      providerMessageId: 'msg-crash-safe',
    });
  });

  it('reports a delivery event removed after provider acceptance', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');

    await expect(
      deliverPulseDigest(
        runId,
        deps({
          afterProviderAccepted: async () => {
            await getTestDb()
              .delete(weeklyPulseDeliveryEvents)
              .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
          },
        }),
      ),
    ).rejects.toThrow('weekly pulse delivery event disappeared');
  });

  it('replays the exact frozen recipient payload after preference or identity changes', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const sent: DigestEmailMessage[] = [];
    const sendEmail = vi.fn(async (message: DigestEmailMessage) => {
      sent.push(message);
      return { delivered: true, providerMessageId: 'msg-original-target' };
    });
    await expect(
      deliverPulseDigest(
        runId,
        deps({
          sendEmail,
          afterProviderAccepted: async () => {
            throw new Error('simulated process death');
          },
        }),
      ),
    ).rejects.toThrow('simulated process death');

    const resolveChangedRecipient = vi.fn(async () => ({
      email: 'changed-target@example.com',
      membership: 'active' as const,
    }));
    const outcome = await deliverPulseDigest(
      runId,
      deps({
        sendEmail,
        now: () => new Date('2026-01-05T09:00:31.000Z'),
        resolveRecipient: resolveChangedRecipient,
      }),
    );
    expect(outcome).toMatchObject({ errors: 0, retryable: 0, delivered: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(resolveChangedRecipient).not.toHaveBeenCalled();
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[1]!.to).toBe('user-1@example.com');
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows[0]).toMatchObject({
      status: 'delivered',
      attempt: 2,
      errorCode: null,
    });
    expect(rows[0]!.errorDetailSafe).toBeNull();
  });

  it.each([
    {
      name: 'eligibility',
      prepare: async (accountId: string, siteId: string) => {
        await getTestDb()
          .update(sitePulseSubscriptions)
          .set({ disabledAt: new Date('2026-01-05T09:00:01.000Z') })
          .where(
            and(
              eq(sitePulseSubscriptions.accountId, accountId),
              eq(sitePulseSubscriptions.siteId, siteId),
            ),
          );
        return {};
      },
    },
    {
      name: 'identity',
      prepare: async () => ({ resolveRecipient: async () => null }),
    },
    {
      name: 'transport availability',
      prepare: async () => ({ transportAvailable: () => false }),
    },
  ])('ignores mutable $name state after the exact request is frozen', async ({
    prepare,
  }) => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const sendEmail = vi.fn(async () => ({
      delivered: true,
      providerMessageId: 'msg-ambiguous',
    }));
    await expect(
      deliverPulseDigest(
        runId,
        deps({
          sendEmail,
          afterProviderAccepted: async () => {
            throw new Error('simulated process death');
          },
        }),
      ),
    ).rejects.toThrow('simulated process death');

    const overrides = await prepare(accountId, siteId);
    await expect(
      deliverPulseDigest(
        runId,
        deps({
          sendEmail,
          now: () => new Date('2026-01-05T09:00:31.000Z'),
          ...overrides,
        }),
      ),
    ).resolves.toMatchObject({ errors: 0, retryable: 0, delivered: 1 });
    const [row] = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(row).toMatchObject({ status: 'delivered', errorCode: null });
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('fails closed when another claimant binds a different request fingerprint', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const sendEmail = vi.fn(async () => ({ delivered: true }));
    const competingFingerprint = `request-hmac-v1:${'b'.repeat(64)}`;
    const outcome = await deliverPulseDigest(
      runId,
      deps({
        sendEmail,
        beforeFingerprintBinding: async ({ eventId }) => {
          await getTestDb()
            .update(weeklyPulseDeliveryEvents)
            .set({ errorDetailSafe: competingFingerprint })
            .where(eq(weeklyPulseDeliveryEvents.id, eventId));
        },
      }),
    );
    expect(outcome).toMatchObject({ errors: 1, retryable: 0, delivered: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    const [row] = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(row).toMatchObject({
      status: 'not_delivered',
      errorCode: 'provider_outcome_unknown_payload_drift',
      errorDetailSafe: competingFingerprint,
    });
  });

  it('continues when another claimant binds the same exact encrypted request', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const sendEmail = vi.fn(async () => ({ delivered: true }));

    const outcome = await deliverPulseDigest(
      runId,
      deps({
        sendEmail,
        beforeFingerprintBinding: async ({ eventId, requestEnvelope }) => {
          await getTestDb()
            .update(weeklyPulseDeliveryEvents)
            .set({ errorDetailSafe: requestEnvelope })
            .where(eq(weeklyPulseDeliveryEvents.id, eventId));
        },
      }),
    );

    expect(outcome).toMatchObject({ delivered: 1, errors: 0 });
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('replays a proven historical-English request byte-for-byte without rendering', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'legacy-user', 'en');
    const [event] = await getTestDb().insert(weeklyPulseDeliveryEvents).values({
      pulseRunId: runId,
      userId: 'legacy-user',
      channel: 'email',
      locale: 'en' as const,
      status: 'queued',
      attempt: 1,
      createdAt: new Date('2026-01-05T08:00:00.000Z'),
      updatedAt: new Date('2026-01-05T08:00:00.000Z'),
    }).returning();
    const base = {
      version: 'rankmefast.weekly-pulse-email.legacy-en.v1' as const,
      historicalEnglishProvenance: true as const,
      senderIdentity: 'reports@example.test',
      to: 'historical@example.test',
      subject: 'Historical weekly pulse',
      text: 'Exact historical English bytes.',
      idempotencyKey: `weekly-pulse/${event!.id}`,
    };
    const frozenDeps = deps();
    const requestFingerprint = weeklyPulseDeliveryTestables.fingerprintPayload(
      frozenDeps,
      weeklyPulseDeliveryTestables.historicalEnglishFingerprintPayload(base),
    );
    const envelope = weeklyPulseDeliveryTestables.sealFrozenPulseRequest(event!.id, {
      ...base,
      requestFingerprint,
    });
    expect(weeklyPulseDeliveryTestables.openFrozenPulseRequest(
      deps({ fingerprintRequest: () => '0'.repeat(64) }),
      event!.id,
      envelope,
    )).toBeNull();
    await getTestDb().update(weeklyPulseDeliveryEvents).set({
      errorDetailSafe: envelope,
    }).where(eq(weeklyPulseDeliveryEvents.id, event!.id));
    const resolveRecipient = vi.fn(async () => null);
    const sent: DigestEmailMessage[] = [];

    await expect(deliverPulseDigest(runId, deps({
      resolveRecipient,
      transportAvailable: () => false,
      sendEmail: async (message) => {
        sent.push(message);
        return { delivered: true, providerMessageId: 'legacy-msg' };
      },
    }))).resolves.toMatchObject({ delivered: 1, errors: 0 });

    expect(resolveRecipient).not.toHaveBeenCalled();
    expect(sent).toEqual([{
      to: base.to,
      subject: base.subject,
      text: base.text,
      idempotencyKey: base.idempotencyKey,
      expectedSenderIdentity: base.senderIdentity,
    }]);
  });

  it('fails a corrupt frozen replay closed and classifies a non-Error fingerprint failure', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'corrupt-frozen-user', 'en');
    const [event] = await getTestDb().insert(weeklyPulseDeliveryEvents).values({
      pulseRunId: runId,
      userId: 'corrupt-frozen-user',
      channel: 'email',
      locale: 'en',
      status: 'queued',
      attempt: 1,
      createdAt: new Date('2026-01-05T08:00:00.000Z'),
      updatedAt: new Date('2026-01-05T08:00:00.000Z'),
    }).returning();
    const base = {
      version: 'rankmefast.weekly-pulse-email.legacy-en.v1' as const,
      historicalEnglishProvenance: true as const,
      senderIdentity: null,
      to: 'historical@example.test',
      subject: 'Historical weekly pulse',
      text: 'Exact historical English bytes.',
      idempotencyKey: `weekly-pulse/${event!.id}`,
    };
    expect(weeklyPulseDeliveryTestables.historicalEnglishFingerprintPayload(base))
      .toContain('"from":""');
    const requestFingerprint = weeklyPulseDeliveryTestables.fingerprintPayload(
      deps(),
      weeklyPulseDeliveryTestables.historicalEnglishFingerprintPayload(base),
    );
    const envelope = weeklyPulseDeliveryTestables.sealFrozenPulseRequest(event!.id, {
      ...base,
      requestFingerprint,
    });
    await getTestDb().update(weeklyPulseDeliveryEvents).set({
      errorDetailSafe: envelope,
    }).where(eq(weeklyPulseDeliveryEvents.id, event!.id));
    const logger = { warn: vi.fn() };
    const sendEmail = vi.fn(async () => ({ delivered: true }));

    await expect(deliverPulseDigest(runId, deps({
      fingerprintRequest: () => { throw 'fingerprint unavailable'; },
      logger: logger as never,
      sendEmail,
    }))).rejects.toBeInstanceOf(UnrecoverableError);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'NonError', runId }),
      'weekly-pulse frozen request failed closed',
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('classifies malformed frozen-envelope parsing as an Error without leaking it', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'malformed-envelope-user', 'en');
    const [event] = await getTestDb().insert(weeklyPulseDeliveryEvents).values({
      pulseRunId: runId,
      userId: 'malformed-envelope-user',
      channel: 'email',
      locale: 'en',
      status: 'queued',
      attempt: 1,
      errorDetailSafe: 'request-envelope-v1:not-valid-base64-json',
      createdAt: new Date('2026-01-05T08:00:00.000Z'),
      updatedAt: new Date('2026-01-05T08:00:00.000Z'),
    }).returning();
    const logger = { warn: vi.fn() };

    await expect(deliverPulseDigest(runId, deps({ logger: logger as never })))
      .rejects.toBeInstanceOf(UnrecoverableError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'SyntaxError', runId }),
      'weekly-pulse frozen request failed closed',
    );
    const [stored] = await getTestDb().select().from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.id, event!.id));
    expect(stored).toMatchObject({
      status: 'not_delivered',
      errorCode: 'legacy_unrendered_locale_or_payload_missing',
    });
  });

  it('dead-letters a newly frozen recipient whose stored locale is unsupported', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'unsupported-locale-user', 'pt');
    const sendEmail = vi.fn(async () => ({ delivered: true }));

    await expect(deliverPulseDigest(runId, deps({ sendEmail })))
      .rejects.toBeInstanceOf(UnrecoverableError);
    expect(sendEmail).not.toHaveBeenCalled();
    const [stored] = await getTestDb().select().from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(stored).toMatchObject({
      status: 'not_delivered',
      errorCode: 'invalid_frozen_locale',
    });
  });

  it('dead-letters an unrendered legacy event with zero provider sends', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'legacy-unrendered', 'en');
    const [event] = await getTestDb().insert(weeklyPulseDeliveryEvents).values({
      pulseRunId: runId,
      userId: 'legacy-unrendered',
      channel: 'email',
      locale: 'en',
      status: 'queued',
      attempt: 1,
      createdAt: new Date('2026-01-05T08:00:00.000Z'),
      updatedAt: new Date('2026-01-05T08:00:00.000Z'),
    }).returning();
    const sendEmail = vi.fn(async () => ({ delivered: true }));

    await expect(deliverPulseDigest(runId, deps({ sendEmail })))
      .rejects.toBeInstanceOf(UnrecoverableError);
    expect(sendEmail).not.toHaveBeenCalled();
    const [stored] = await getTestDb().select().from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.id, event!.id));
    expect(stored).toMatchObject({
      status: 'not_delivered',
      errorCode: 'legacy_unrendered_locale_or_payload_missing',
    });
  });

  it('classifies the durable winner when an attempt-status CAS loses its race', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const outcome = await deliverPulseDigest(
      runId,
      deps({
        sendEmail: vi.fn(async () => ({ delivered: false })),
        beforePersistAttemptStatus: async ({ eventId }) => {
          await getTestDb()
            .update(weeklyPulseDeliveryEvents)
            .set({ status: 'delivered', providerMessageId: 'msg-race-winner' })
            .where(eq(weeklyPulseDeliveryEvents.id, eventId));
        },
      }),
    );
    expect(outcome).toMatchObject({ delivered: 1, errors: 0, retryable: 0 });
  });

  it('fences a concurrent replay while the first provider request owns the lease', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    let releaseProvider!: () => void;
    let providerEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const sendEmail = vi.fn(async () => {
      providerEntered();
      await release;
      return { delivered: true, providerMessageId: 'msg-concurrent' };
    });

    const first = deliverPulseDigest(runId, deps({ sendEmail }));
    await entered;
    const concurrent = await deliverPulseDigest(runId, deps({ sendEmail })).catch(
      (caught: unknown) => caught,
    );
    expect(concurrent).toBeInstanceOf(RetryablePulseDeliveryError);
    expect((concurrent as RetryablePulseDeliveryError).outcome).toMatchObject({
      errors: 1,
      retryable: 1,
    });
    expect(sendEmail).toHaveBeenCalledOnce();
    releaseProvider();
    await expect(first).resolves.toMatchObject({ delivered: 1, retryable: 0 });

    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'delivered', attempt: 1 });
  });

  it('bounds known transport failures at three attempts while reusing one provider key', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const keys: string[] = [];
    const sendEmail = vi.fn(async (message: DigestEmailMessage) => {
      keys.push(message.idempotencyKey);
      return { delivered: false };
    });

    for (const second of [0, 1]) {
      await expect(
        deliverPulseDigest(
          runId,
          deps({
            sendEmail,
            now: () => new Date(`2026-01-05T09:00:0${second}.000Z`),
          }),
        ),
      ).rejects.toBeInstanceOf(RetryablePulseDeliveryError);
    }
    const terminal = await deliverPulseDigest(
      runId,
      deps({
        sendEmail,
        now: () => new Date('2026-01-05T09:00:02.000Z'),
      }),
    );
    expect(terminal).toMatchObject({ errors: 1, retryable: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(3);
    expect(new Set(keys).size).toBe(1);
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows[0]).toMatchObject({
      status: 'not_delivered',
      attempt: 3,
      errorCode: 'transport_retries_exhausted',
    });
    await expect(
      deliverPulseDigest(
        runId,
        deps({
          sendEmail,
          now: () => new Date('2026-01-05T09:00:03.000Z'),
        }),
      ),
    ).resolves.toMatchObject({ errors: 1, retryable: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it('bounds thrown transport failures and classifies non-Error throws safely', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const logError = vi.fn();
    const sendEmail = vi.fn(async () => {
      throw 'transport offline';
    });

    for (const second of [0, 1]) {
      await expect(
        deliverPulseDigest(
          runId,
          deps({
            sendEmail,
            logger: { error: logError } as never,
            now: () => new Date(`2026-01-05T09:00:0${second}.000Z`),
          }),
        ),
      ).rejects.toBeInstanceOf(RetryablePulseDeliveryError);
    }
    await expect(
      deliverPulseDigest(
        runId,
        deps({
          sendEmail,
          logger: { error: logError } as never,
          now: () => new Date('2026-01-05T09:00:02.000Z'),
        }),
      ),
    ).resolves.toMatchObject({ errors: 1, retryable: 0 });
    expect(logError).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorName: 'NonError' }),
      'weekly-pulse delivery threw',
    );
    const [row] = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(row).toMatchObject({
      attempt: 3,
      errorCode: 'provider_outcome_unknown_transport_exhausted',
    });
  });

  it('records an unknown provider outcome when response loss exhausts retries', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const sendEmail = vi.fn(async () => ({
      delivered: false,
      outcomeUnknown: true,
    }));

    for (const second of [0, 1]) {
      await expect(
        deliverPulseDigest(
          runId,
          deps({
            sendEmail,
            now: () => new Date(`2026-01-05T09:00:0${second}.000Z`),
          }),
        ),
      ).rejects.toBeInstanceOf(RetryablePulseDeliveryError);
    }
    await expect(
      deliverPulseDigest(
        runId,
        deps({
          sendEmail,
          now: () => new Date('2026-01-05T09:00:02.000Z'),
        }),
      ),
    ).resolves.toMatchObject({ errors: 1, retryable: 0 });

    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows[0]).toMatchObject({
      status: 'not_delivered',
      attempt: 3,
      errorCode: 'provider_outcome_unknown_transport_exhausted',
    });
  });

  it('expires an ambiguous queued request before Resend can forget its key', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const sendEmail = vi.fn(async () => ({
      delivered: true,
      providerMessageId: 'msg-accepted',
    }));
    await expect(
      deliverPulseDigest(
        runId,
        deps({
          sendEmail,
          afterProviderAccepted: async () => {
            throw new Error('simulated process death');
          },
        }),
      ),
    ).rejects.toThrow('simulated process death');

    const terminal = await deliverPulseDigest(
      runId,
      deps({
        sendEmail,
        now: () => new Date('2026-01-06T08:00:00.001Z'),
      }),
    );
    expect(terminal).toMatchObject({ errors: 1, retryable: 0 });
    expect(sendEmail).toHaveBeenCalledOnce();
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows[0]).toMatchObject({
      status: 'not_delivered',
      attempt: 3,
      errorCode: 'idempotency_window_expired',
    });
  });

  it('reclaims an interrupted queued request at the normal-attempt ceiling', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    await expect(
      deliverPulseDigest(
        runId,
        deps({
          afterProviderAccepted: async () => {
            throw new Error('simulated process death');
          },
        }),
      ),
    ).rejects.toThrow('simulated process death');
    await getTestDb()
      .update(weeklyPulseDeliveryEvents)
      .set({
        attempt: 3,
        updatedAt: new Date('2026-01-05T08:59:00.000Z'),
      })
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));

    await expect(
      deliverPulseDigest(
        runId,
        deps({ now: () => new Date('2026-01-05T09:00:31.000Z') }),
      ),
    ).resolves.toMatchObject({ delivered: 1, retryable: 0 });
    const [row] = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(row).toMatchObject({ status: 'delivered', attempt: 3 });
  });

  it('returns null when a replay-claim CAS loses', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    await expect(
      deliverPulseDigest(
        runId,
        deps({ sendEmail: vi.fn(async () => ({ delivered: false })) }),
      ),
    ).rejects.toBeInstanceOf(RetryablePulseDeliveryError);
    const [event] = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    const losingDb = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [] }),
        }),
      }),
    } as unknown as DeliverPulseDigestDeps['db'];

    await expect(
      weeklyPulseDeliveryTestables.claimReplayAttempt(
        deps({ db: losingDb }),
        event!,
        new Date('2026-01-05T09:00:01.000Z'),
      ),
    ).resolves.toBeNull();
    await expect(
      weeklyPulseDeliveryTestables.claimReplayAttempt(
        deps(),
        { ...event!, errorCode: 'provider_outcome_unknown_transport_exhausted' },
        new Date('2026-01-05T09:00:01.000Z'),
      ),
    ).resolves.toBeNull();
  });

  it('fails closed when a decoded request loses its durable envelope marker', async () => {
    const eventId = '77777777-7777-4777-8777-777777777777';
    const frozenDeps = deps();
    const base = {
      version: 'rankmefast.weekly-pulse-email.v1' as const,
      locale: 'en' as const,
      senderIdentity: null,
      to: 'recipient@example.test',
      subject: 'Weekly pulse',
      text: 'Frozen text',
      html: '<p>Frozen text</p>',
      idempotencyKey: `weekly-pulse/${eventId}`,
    };
    const requestFingerprint = weeklyPulseDeliveryTestables.fingerprintPayload(
      frozenDeps,
      weeklyPulseDeliveryTestables.requestFingerprintPayload(base),
    );
    const envelope = weeklyPulseDeliveryTestables.sealFrozenPulseRequest(eventId, {
      ...base,
      requestFingerprint,
    });
    let startsWithCalls = 0;
    const markerThatDrifts = {
      startsWith: () => {
        startsWithCalls += 1;
        return startsWithCalls > 1;
      },
      slice: (start: number) => envelope.slice(start),
    } as unknown as string;
    const event = {
      id: eventId,
      pulseRunId: '88888888-8888-4888-8888-888888888888',
      userId: 'recipient',
      channel: 'email' as const,
      locale: 'en',
      status: 'queued' as const,
      providerMessageId: null,
      attempt: 1,
      errorCode: null,
      errorDetailSafe: markerThatDrifts,
      costMicros: 0,
      createdAt: new Date('2026-01-05T09:00:00.000Z'),
      updatedAt: new Date('2026-01-05T09:00:00.000Z'),
    };
    const fakeDb = {
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => [{ ...event, ...values }],
          }),
        }),
      }),
    } as unknown as DeliverPulseDigestDeps['db'];

    await expect(weeklyPulseDeliveryTestables.deliverOne(
      { ...frozenDeps, db: fakeDb },
      {
        runId: event.pulseRunId,
        accountId: 'account',
        siteId: 'site',
        event,
        ownsInitialAttempt: true,
        projection: baseProjection(),
        transportUp: true,
        now: event.updatedAt,
      },
    )).resolves.toMatchObject({ status: 'not_delivered', retryable: false });
  });

  it('localizes only same-origin digest links and preserves malformed or prefixed URLs', () => {
    const app = new URL(env.APP_URL);
    expect(weeklyPulseDeliveryTestables.localizedDigestLink('en', `${app.origin}/report`))
      .toBe(`${app.origin}/report`);
    expect(weeklyPulseDeliveryTestables.localizedDigestLink('pt', `${app.origin}/report`))
      .toBe(`${app.origin}/report`);
    expect(weeklyPulseDeliveryTestables.localizedDigestLink('fr', 'not a url'))
      .toBe('not a url');
    expect(weeklyPulseDeliveryTestables.localizedDigestLink('fr', 'https://other.example/report'))
      .toBe('https://other.example/report');
    expect(weeklyPulseDeliveryTestables.localizedDigestLink('fr', `${app.origin}/fr/report`))
      .toBe(`${app.origin}/fr/report`);
    expect(weeklyPulseDeliveryTestables.localizedDigestLink('fr', `${app.origin}/report`))
      .toBe(`${app.origin}/fr/report`);

    const OriginalUrl = globalThis.URL;
    class PathlessUrl {
      origin = app.origin;
      pathname: string;
      constructor(raw: string | URL) {
        this.pathname = String(raw) === 'pathless' ? 'report' : '/';
      }
      toString() {
        return `${this.origin}${this.pathname}`;
      }
    }
    vi.stubGlobal('URL', PathlessUrl);
    try {
      expect(weeklyPulseDeliveryTestables.localizedDigestLink('fr', 'pathless'))
        .toBe(`${app.origin}/fr/report`);
    } finally {
      vi.stubGlobal('URL', OriginalUrl);
    }
  });

  it('does not add a subscriber who opted in after the frozen run cutoff', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const sendEmail = vi.fn(async () => ({ delivered: true }));
    await deliverPulseDigest(runId, deps({ sendEmail }));
    await getTestDb().insert(sitePulseSubscriptions).values({
      accountId,
      siteId,
      userId: 'user-late',
      locale: 'fr',
      enabledAt: new Date('2026-01-05T08:30:00.000Z'),
    });
    await deliverPulseDigest(runId, deps({ sendEmail }));
    expect(sendEmail).toHaveBeenCalledOnce();
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows.map((row) => row.userId)).toEqual(['user-1']);
  });

  it('one recipient failure does not block the others', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-a', 'en');
    await subscribe(accountId, siteId, 'user-b', 'en');
    const sendEmail = vi.fn(async ({ to }: { to: string }) => {
      if (to === 'user-a@example.com') {
        throw new Error('transport blew up');
      }
      return { delivered: true };
    });
    const logError = vi.fn();
    const error = await deliverPulseDigest(
      runId,
      deps({ sendEmail, logger: { error: logError } as never }),
    ).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(RetryablePulseDeliveryError);
    const outcome = (error as RetryablePulseDeliveryError).outcome;
    expect(outcome.attempted).toBe(2);
    expect(outcome.delivered).toBe(1);
    expect(outcome.errors).toBe(1);
    expect(outcome.retryable).toBe(1);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'Error' }),
      'weekly-pulse delivery threw',
    );

    const rowA = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(
        and(
          eq(weeklyPulseDeliveryEvents.pulseRunId, runId),
          eq(weeklyPulseDeliveryEvents.userId, 'user-a'),
        ),
      );
    expect(rowA[0]!.status).toBe('not_delivered');
    expect(rowA[0]!.errorCode).toBe('transport_exception');
  });

  it('records suppressed_no_transport when transport is unavailable', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const sendEmail = vi.fn(async () => ({ delivered: false }));
    const outcome = await deliverPulseDigest(
      runId,
      deps({ sendEmail, transportAvailable: () => false }),
    );
    expect(outcome.suppressed).toBe(1);
    expect(outcome.delivered).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows[0]!.status).toBe('suppressed_no_transport');
  });

  it('records suppressed_membership_removed when the account resolver returns removed', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const outcome = await deliverPulseDigest(
      runId,
      deps({
        resolveRecipient: async () => ({
          email: 'user-1@example.com',
          membership: 'removed',
        }),
      }),
    );
    expect(outcome.suppressed).toBe(1);
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows[0]!.status).toBe('suppressed_membership_removed');
  });

  it('records suppressed_membership_removed when resolver returns null', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const outcome = await deliverPulseDigest(
      runId,
      deps({ resolveRecipient: async () => null }),
    );
    expect(outcome.suppressed).toBe(1);
  });

  it('records suppressed_membership_removed when recipient has no email', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const outcome = await deliverPulseDigest(
      runId,
      deps({
        resolveRecipient: async () => ({ email: null, membership: 'active' }),
      }),
    );
    expect(outcome.suppressed).toBe(1);
  });

  it('isolates recipient-store failures and records a terminal error', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const sendEmail = vi.fn(async () => ({ delivered: true }));
    const logError = vi.fn();
    const error = await deliverPulseDigest(
      runId,
      deps({
        sendEmail,
        resolveRecipient: async () => {
          throw new Error('identity store down');
        },
        logger: { error: logError } as never,
      }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RetryablePulseDeliveryError);
    const outcome = (error as RetryablePulseDeliveryError).outcome;
    expect(outcome).toMatchObject({ attempted: 1, errors: 1, delivered: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledOnce();
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows[0]).toMatchObject({
      status: 'not_delivered',
      errorCode: 'recipient_resolution_exception',
    });
  });

  it('classifies a non-Error recipient-store failure without leaking it', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const logError = vi.fn();

    const error = await deliverPulseDigest(
      runId,
      deps({
        resolveRecipient: async () => {
          throw 'identity store offline';
        },
        logger: { error: logError } as never,
      }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RetryablePulseDeliveryError);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'NonError' }),
      'weekly-pulse recipient resolution threw',
    );
  });

  it('records suppressed_unsubscribed when subscription has disabledAt', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en', true);
    const outcome = await deliverPulseDigest(runId, deps());
    expect(outcome.suppressed).toBe(1);
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows[0]!.status).toBe('suppressed_unsubscribed');
  });

  it('records not_delivered when the transport reports delivered:false', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    await subscribe(accountId, siteId, 'user-1', 'en');
    const error = await deliverPulseDigest(
      runId,
      deps({ sendEmail: vi.fn(async () => ({ delivered: false })) }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RetryablePulseDeliveryError);
    const outcome = (error as RetryablePulseDeliveryError).outcome;
    expect(outcome.errors).toBe(1);
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseDeliveryEvents)
      .where(eq(weeklyPulseDeliveryEvents.pulseRunId, runId));
    expect(rows[0]!.status).toBe('not_delivered');
    expect(rows[0]!.errorCode).toBe('transport_reported_failure');
  });

  it('renders every recipient in the frozen subscription locale with Arabic RTL HTML', async () => {
    const { runId, accountId, siteId } = await seedRunAndProjection();
    for (const locale of SUPPORTED_LOCALES) {
      await subscribe(accountId, siteId, `user-${locale}`, locale);
    }
    const captured: DigestEmailMessage[] = [];
    const sendEmail = vi.fn(async (msg: DigestEmailMessage) => {
      captured.push(msg);
      return { delivered: true };
    });
    await deliverPulseDigest(runId, deps({ sendEmail }));
    expect(captured).toHaveLength(SUPPORTED_LOCALES.length);
    for (const locale of SUPPORTED_LOCALES) {
      const message = captured.find((item) => item.to === `user-${locale}@example.com`);
      expect(message?.html).toContain(`lang="${locale}"`);
    }
    const en = captured.find((m) => m.to === 'user-en@example.com')!;
    const fr = captured.find((m) => m.to === 'user-fr@example.com')!;
    const ar = captured.find((m) => m.to === 'user-ar@example.com')!;
    expect(en.subject).toMatch(/Weekly pulse/i);
    expect(fr.subject).toMatch(/Bilan hebdomadaire/i);
    expect(ar.subject).toMatch(/النبض/);
    expect(ar.html).toContain('dir="rtl"');
  });

  it('MissingProjectionError also fires when the run row disappears (FK cascade takes projection with it)', async () => {
    const { runId } = await seedRunAndProjection();
    await getTestDb()
      .delete(weeklyPulseRuns)
      .where(eq(weeklyPulseRuns.id, runId));
    // After cascade, the projection is gone, so the first missing-projection
    // guard fires — proves the invariant end-to-end.
    await expect(deliverPulseDigest(runId, deps())).rejects.toBeInstanceOf(MissingProjectionError);
  });

  it('reports a disappeared frozen delivery event instead of inventing an outcome', async () => {
    await expect(
      weeklyPulseDeliveryTestables.readDeliveryEvent(
        deps(),
        '99999999-9999-4999-8999-999999999999',
      ),
    ).rejects.toThrow('weekly pulse delivery event disappeared');
  });
});

describe('renderPlainTextBody — Brand Radar deltas (07b §3)', () => {
  it.each(SUPPORTED_LOCALES)('renders the %s brand section with bounded values', (locale) => {
    const body = renderPlainTextBody(locale, baseProjection());
    expect(body).toContain(translate(locale, 'weeklyPulse.brandDeltas.sectionTitle'));
    // The scope note is what keeps the account-scoped section honest against
    // the site-scoped pulse around it.
    expect(body).toContain(translate(locale, 'weeklyPulse.brandDeltas.scopeNote'));
    expect(body).toContain(
      translate(locale, 'weeklyPulse.brandDeltas.queryLine', {
        query: 'acme crm',
        delta: '+4',
      }),
    );
    expect(body).toContain(
      translate(locale, 'weeklyPulse.brandDeltas.sentimentLine', {
        positive: '+5',
        neutral: '-2',
        negative: '-3',
        unknown: '0',
      }),
    );
    // Never a snippet, a mention URL, or a digest sentence.
    expect(body).not.toMatch(/snippet/i);
    expect(body).not.toMatch(/digestSentence/i);
  });

  it('renders the first-scan line when there is no comparison baseline', () => {
    const projection = baseProjection();
    projection.brand_deltas = [
      {
        queryHash: 'a'.repeat(64),
        brandQuerySafe: 'acme crm',
        currentScanId: 'scan-1',
        previousScanId: null,
        hasNewScan: true,
        newMentionCount: null,
        sentimentShift: null,
      },
    ];
    const body = renderPlainTextBody('en', projection);
    expect(body).toContain('acme crm — first scan, nothing to compare yet.');
    expect(body).not.toContain('mentions +0');
  });

  it('renders the first-scan line when only the sentiment shift is missing', () => {
    const projection = baseProjection();
    projection.brand_deltas = [
      {
        queryHash: 'a'.repeat(64),
        brandQuerySafe: 'acme crm',
        currentScanId: 'scan-1',
        previousScanId: 'scan-0',
        hasNewScan: true,
        newMentionCount: 2,
        sentimentShift: null,
      },
    ];
    expect(renderPlainTextBody('en', projection)).toContain(
      'acme crm — first scan, nothing to compare yet.',
    );
  });

  it('renders the no-new-scan line for a query with no settled scan this period', () => {
    const projection = baseProjection();
    projection.brand_deltas = [
      {
        queryHash: 'a'.repeat(64),
        brandQuerySafe: 'acme crm',
        currentScanId: 'scan-1',
        previousScanId: null,
        hasNewScan: false,
        newMentionCount: null,
        sentimentShift: null,
      },
    ];
    expect(renderPlainTextBody('en', projection)).toContain(
      'acme crm — no new scan this period.',
    );
  });

  it('renders the honest empty state for an account that has never scanned', () => {
    const projection = baseProjection();
    projection.brand_deltas = [];
    expect(renderPlainTextBody('en', projection)).toContain(
      'No brand scans to compare yet.',
    );
  });

  it('renders the empty state for a projection frozen before 07b-3 shipped', () => {
    const projection = baseProjection();
    delete projection.brand_deltas;
    expect(renderPlainTextBody('en', projection)).toContain(
      'No brand scans to compare yet.',
    );
  });

  it('keeps a hostile brand query inert and never renders it as markup', () => {
    const projection = baseProjection();
    projection.brand_deltas = [
      {
        queryHash: 'a'.repeat(64),
        brandQuerySafe: '<script>alert(1)</script>',
        currentScanId: 'scan-2',
        previousScanId: 'scan-1',
        hasNewScan: true,
        newMentionCount: -1,
        sentimentShift: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
      },
    ];
    const body = renderPlainTextBody('en', projection);
    // Plain text — the value is carried verbatim, never interpolated into
    // markup, and the negative delta keeps its sign.
    expect(body).toContain('<script>alert(1)</script> — mentions -1');
    expect(body).not.toContain('<b>');
  });
});
