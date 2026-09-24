/**
 * Next Actions controller — locale resolution at the handler seam.
 *
 * `req.language` is populated by the language middleware and is declared
 * optional on the Express request. The router integration suite always runs
 * behind that middleware, so the fallback arm is only observable by invoking
 * the exported handler on a request that never passed through it (a mount
 * order regression, or a direct handler reuse). Asserting it here keeps the
 * fallback honest: an unresolved language must render the default locale, not
 * raw i18n keys.
 */
import mongoose, { Types } from 'mongoose';
import type { Request, Response } from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { setSummaryDb } from '../audits/summary.db-holder.js';
import { Site } from '../sites/index.js';
import { listActions } from './actions.controller.js';
import { clearSourceRegistry, registerSource } from './actions.registry.js';
import type { CandidateAction } from './actions.types.js';

function candidate(): CandidateAction {
  return {
    sourceType: 'confirmed_rank_drop',
    sourceId: 'cand-locale-1',
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
  };
}

async function seedSite() {
  const accountId = new Types.ObjectId().toHexString();
  const siteId = new Types.ObjectId().toHexString();
  await Site.create({
    _id: new Types.ObjectId(siteId),
    accountId: new Types.ObjectId(accountId),
    url: `https://${siteId.slice(0, 8)}.test`,
    domain: `${siteId.slice(0, 8)}.test`,
    displayName: 'Example',
  });
  return { accountId, siteId };
}

/** Minimal express doubles — the handler only reads params/query/user. */
function fakeReq(input: {
  accountId: string;
  siteId: string;
  language?: string;
}): Request {
  return {
    user: { id: input.accountId },
    params: { siteId: input.siteId },
    query: {},
    ...(input.language === undefined ? {} : { language: input.language }),
  } as unknown as Request;
}

/**
 * `asyncHandler` returns void and routes rejections into `next`, so the
 * invocation is wrapped in a promise that settles on the first `res.json`
 * (success) or the first `next(err)` (failure). Without this a thrown
 * HttpError would silently pass the test.
 */
function invoke(req: Request): Promise<{ status?: number; body?: unknown }> {
  const captured: { status?: number; body?: unknown } = {};
  return new Promise((resolve, reject) => {
    const res = {
      setHeader() {
        return this;
      },
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(body: unknown) {
        captured.body = body;
        resolve(captured);
        return this;
      },
    } as unknown as Response;
    listActions(req, res, (err?: unknown) => {
      reject(err ?? new Error('next() called without an error'));
    });
  });
}

beforeAll(async () => {
  await mongoose.connect(await startMemoryMongo());
  await startTestPostgres();
  setSummaryDb(getTestDb() as unknown as never);
});

afterAll(async () => {
  setSummaryDb(null);
  await mongoose.disconnect();
  await stopMemoryMongo();
  await stopTestPostgres();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  clearSourceRegistry();
});

afterEach(async () => {
  clearSourceRegistry();
  await clearCollections();
  await truncateAllTables();
});

describe('listActions locale resolution', () => {
  it('renders the default locale when the request carries no resolved language', async () => {
    const { accountId, siteId } = await seedSite();
    registerSource('confirmed_rank_drop', async () => ({
      actions: [candidate()],
      status: 'available',
    }));

    const captured = await invoke(fakeReq({ accountId, siteId }));

    expect(captured.status).toBe(200);
    const body = captured.body as { items: Array<{ problem: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.problem).toBe(
      'Your Google ranking for “best shoes” dropped, and a second check confirmed it.',
    );
  });

  it('falls back to the default locale when the language is not a supported one', async () => {
    const { accountId, siteId } = await seedSite();
    registerSource('confirmed_rank_drop', async () => ({
      actions: [candidate()],
      status: 'available',
    }));

    const captured = await invoke(
      fakeReq({ accountId, siteId, language: 'kl-GL' }),
    );

    const body = captured.body as { items: Array<{ problem: string }> };
    expect(body.items[0]!.problem).toBe(
      'Your Google ranking for “best shoes” dropped, and a second check confirmed it.',
    );
  });

  it('honours a supported resolved language', async () => {
    const { accountId, siteId } = await seedSite();
    registerSource('confirmed_rank_drop', async () => ({
      actions: [candidate()],
      status: 'available',
    }));

    const captured = await invoke(
      fakeReq({ accountId, siteId, language: 'fr' }),
    );

    const body = captured.body as { items: Array<{ problem: string }> };
    expect(body.items[0]!.problem).toContain('Votre position Google');
  });
});
