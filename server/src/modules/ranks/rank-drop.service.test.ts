/**
 * Rank-drop policy + handler tests. The handler must NEVER throw: mail and
 * re-run failures are isolated from each other and from the rank job.
 */
import mongoose from 'mongoose';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { User } from '../users/index.js';
import {
  createRankDropHandler,
  detectRankDrop,
  type RankDropEvent,
} from './rank-drop.service.js';

const logger = pino({ level: 'silent' });

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
beforeEach(() => clearCollections());

describe('detectRankDrop', () => {
  it.each([
    // [previous, current, expected]
    [null, 12, false], // previously unranked — never a drop
    [null, null, false],
    [3, null, true], // fell out of vendor depth
    [10, 11, true], // fell out of top 10
    [3, 8, true], // ≥5 positions
    [3, 7, false], // 4 positions — wobble
    [3, 2, false], // rise
    [50, 55, true], // ≥5 deep in the pack
    [50, 54, false],
    [11, 12, false], // outside top 10, small wobble
  ] as Array<[number | null, number | null, boolean]>)(
    'previous=%s current=%s → %s',
    (previous, current, expected) => {
      expect(detectRankDrop(previous, current)).toBe(expected);
    },
  );
});

function makeEvent(overrides: Partial<RankDropEvent> = {}): RankDropEvent {
  return {
    accountId: new mongoose.Types.ObjectId().toHexString(),
    siteId: new mongoose.Types.ObjectId().toHexString(),
    keywordId: 'kw-1',
    keyword: 'seo audit tool',
    previousPosition: 3,
    currentPosition: 12,
    siteUrl: 'https://example.com',
    ...overrides,
  };
}

async function seedUser(accountId: string, language = 'fr') {
  await User.create({
    _id: new mongoose.Types.ObjectId(accountId),
    email: 'owner@example.com',
    language,
  });
}

describe('createRankDropHandler', () => {
  it('emails the owner in their language and requests the auto re-run', async () => {
    const event = makeEvent();
    await seedUser(event.accountId, 'fr');
    const deliverEmail = vi.fn(async () => ({ delivered: true as const }));
    const requestRerun = vi.fn(async () => ({ enqueued: true as const, runId: 'r1' }));
    const handler = createRankDropHandler({
      auditsQueue: null,
      logger,
      deliverEmail: deliverEmail as never,
      requestRerun: requestRerun as never,
    });

    await handler(event);
    expect(deliverEmail).toHaveBeenCalledTimes(1);
    expect(deliverEmail).toHaveBeenCalledWith({
      email: 'owner@example.com',
      userId: event.accountId,
      keyword: 'seo audit tool',
      previousPosition: '3',
      currentPosition: '12',
      siteUrl: 'https://example.com',
      locale: 'fr',
    });
    expect(requestRerun).toHaveBeenCalledTimes(1);
    expect(requestRerun).toHaveBeenCalledWith(
      { accountId: event.accountId, siteId: event.siteId },
      expect.objectContaining({ auditsQueue: null }),
    );
  });

  it('renders the localized "not ranked" string when the current position is null', async () => {
    const event = makeEvent({ currentPosition: null });
    await seedUser(event.accountId, 'en');
    const deliverEmail = vi.fn(async () => ({ delivered: true as const }));
    const handler = createRankDropHandler({
      auditsQueue: null,
      logger,
      deliverEmail: deliverEmail as never,
      requestRerun: vi.fn(async () => ({ enqueued: true as const, runId: 'r' })) as never,
    });

    await handler(event);
    expect(deliverEmail).toHaveBeenCalledWith(
      expect.objectContaining({ currentPosition: 'below the top 100' }),
    );
  });

  it('falls back to the default locale on an unknown user language', async () => {
    const event = makeEvent();
    // Bypass schema validation — mimics a legacy doc with a retired locale.
    await User.collection.insertOne({
      _id: new mongoose.Types.ObjectId(event.accountId),
      email: 'owner@example.com',
      language: 'xx',
    });
    const deliverEmail = vi.fn(async () => ({ delivered: true as const }));
    const handler = createRankDropHandler({
      auditsQueue: null,
      logger,
      deliverEmail: deliverEmail as never,
      requestRerun: vi.fn(async () => ({ enqueued: true as const, runId: 'r' })) as never,
    });

    await handler(event);
    expect(deliverEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }));
  });

  it('missing user → skips the email but still requests the re-run, no throw', async () => {
    const event = makeEvent();
    const deliverEmail = vi.fn(async () => ({ delivered: true as const }));
    const requestRerun = vi.fn(async () => ({ enqueued: true as const, runId: 'r' }));
    const handler = createRankDropHandler({
      auditsQueue: null,
      logger,
      deliverEmail: deliverEmail as never,
      requestRerun: requestRerun as never,
    });

    await expect(handler(event)).resolves.toBeUndefined();
    expect(deliverEmail).not.toHaveBeenCalled();
    expect(requestRerun).toHaveBeenCalledTimes(1);
  });

  it('mail failure is swallowed and the re-run still runs', async () => {
    const event = makeEvent();
    await seedUser(event.accountId);
    const deliverEmail = vi.fn(async () => {
      throw new Error('resend down');
    });
    const requestRerun = vi.fn(async () => ({ enqueued: true as const, runId: 'r' }));
    const handler = createRankDropHandler({
      auditsQueue: null,
      logger,
      deliverEmail: deliverEmail as never,
      requestRerun: requestRerun as never,
    });

    await expect(handler(event)).resolves.toBeUndefined();
    expect(requestRerun).toHaveBeenCalledTimes(1);
  });

  it('re-run failure is swallowed (mail already sent), no throw', async () => {
    const event = makeEvent();
    await seedUser(event.accountId);
    const deliverEmail = vi.fn(async () => ({ delivered: true as const }));
    const requestRerun = vi.fn(async () => {
      throw new Error('queue down');
    });
    const handler = createRankDropHandler({
      auditsQueue: null,
      logger,
      deliverEmail: deliverEmail as never,
      requestRerun: requestRerun as never,
    });

    await expect(handler(event)).resolves.toBeUndefined();
    expect(deliverEmail).toHaveBeenCalledTimes(1);
  });

  it('threads the injected clock through to the re-run deps', async () => {
    const event = makeEvent();
    const now = () => new Date('2026-07-06T00:00:00Z');
    const requestRerun = vi.fn(async () => ({ enqueued: true as const, runId: 'r' }));
    const handler = createRankDropHandler({
      auditsQueue: null,
      logger,
      deliverEmail: vi.fn(async () => ({ delivered: true as const })) as never,
      requestRerun: requestRerun as never,
      now,
    });

    await handler(event);
    expect(requestRerun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ now }),
    );
  });
});

describe('createRankDropHandler — default seams', () => {
  it('builds with the real mailer + rerun-service defaults when no seams are injected', () => {
    const handler = createRankDropHandler({
      auditsQueue: {} as never,
      logger,
    });
    expect(typeof handler).toBe('function');
  });
});
