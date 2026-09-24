import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createApp } from '../../app.js';
import {
  accountDeletionTombstones,
  siteDeletionTombstones,
} from '../../db/schema/index.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
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
import {
  AuditRun,
  ReportSnapshot,
  writeReportSnapshot,
} from '../audits/index.js';
import { makeAuditResult } from '../audits/rules/fixtures.js';
import { upsertSearchAnalytics } from '../gsc-snapshots/index.js';
import { claimAccountDeletion } from '../legal/index.js';
import { claimSiteDeletion, Site } from '../sites/index.js';
import { User } from '../users/users.model.js';
import {
  ClientPortalToken,
  hashClientPortalToken,
  setClientReportsDb,
} from './index.js';
import { buildClientPortalDto } from './portal.service.js';

let sequence = 0;

describe('client portal DTO boundaries', () => {
  it('embeds a dimensioned logo and preserves an explicitly absent audit section', () => {
    const dto = buildClientPortalDto({
      locale: 'en',
      siteLabel: 'Example',
      branding: {
        companyName: 'Agency',
        accentColor: '#112233',
        logoPngBase64: 'cG5n',
        logoWidth: 32,
        logoHeight: 16,
      },
      sections: { audit: null, ranks: null, gsc: null },
    } as never);

    expect(dto.branding.logoDataUrl).toBe('data:image/png;base64,cG5n');
    expect(dto.locale).toBe('en');
    expect(dto.sections.audit).toBeNull();
  });
});

interface SeededPortal {
  accountId: string;
  siteId: string;
  rawToken: string;
  tokenId: string;
}

async function seedPortal(
  options: {
    withAudit?: boolean;
    sections?: { audit: boolean; ranks: boolean; gsc: boolean };
  } = {},
): Promise<SeededPortal> {
  sequence += 1;
  const user = await User.create({
    email: `portal-lifecycle-${sequence}@example.test`,
    emailVerified: true,
  });
  const site = await Site.create({
    accountId: user._id,
    url: `https://portal-${sequence}.example.test`,
    domain: `portal-${sequence}.example.test`,
    displayName: `Stable portal ${sequence}`,
    gscPropertyUrl: `sc-domain:portal-${sequence}.example.test`,
    gscBindingGenerationId: 'legacy',
    gscBindingSource: 'legacy',
  });
  if (options.withAudit) {
    const run = await AuditRun.create({
      accountId: user.id as string,
      siteId: site._id,
      pageCap: 100,
      status: 'succeeded',
      finishedAt: new Date('2026-08-05T10:00:00.000Z'),
    });
    await writeReportSnapshot({
      runId: run.id as string,
      siteId: site.id as string,
      accountId: user.id as string,
      result: makeAuditResult(),
    });
  }
  const rawToken = randomBytes(32).toString('base64url');
  const token = await ClientPortalToken.create({
    accountId: user._id,
    siteId: site._id,
    clientLabel: 'Private label',
    tokenHash: hashClientPortalToken(rawToken),
    locale: 'en',
    sections: options.sections ?? { audit: true, ranks: false, gsc: false },
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
  });
  return {
    accountId: user.id as string,
    siteId: site.id as string,
    rawToken,
    tokenId: token.id as string,
  };
}

async function seedDatedRankAndGsc(target: SeededPortal): Promise<void> {
  const [keyword] = await getTestDb().insert(keywords).values({
    accountId: target.accountId,
    siteId: target.siteId,
    phrase: 'stable rank phrase',
    locationCode: 2_848,
    languageCode: 'en',
    device: 'desktop',
    engine: 'google',
    engineTarget: null,
    active: true,
  }).returning({ id: keywords.id });
  await getTestDb().insert(rankings).values({
    keywordId: keyword!.id,
    engine: 'google',
    position: 3,
    checkedAt: new Date('2026-08-05T11:00:00.000Z'),
    source: 'fresh',
  });
  await upsertSearchAnalytics(getTestDb() as never, {
    accountId: target.accountId,
    siteId: target.siteId,
    bindingGenerationId: 'legacy',
    snapshotDate: '2026-08-05',
    dimensionSet: 'query',
    windowDays: 28,
    rows: [{
      keys: ['stable search query'],
      clicks: 7,
      impressions: 70,
      ctr: 0.1,
      position: 3,
    }],
  });
}

function pauseNextAuditSnapshotRead(): {
  started: Promise<void>;
  resume: () => void;
  restore: () => void;
} {
  let markStarted!: () => void;
  let resumeRead!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resumeRead = resolve;
  });
  let intercepted = false;
  const queryPrototype = mongoose.Query.prototype as unknown as {
    exec: (...args: unknown[]) => Promise<unknown>;
  };
  const originalExec = queryPrototype.exec;
  const spy = vi.spyOn(queryPrototype, 'exec').mockImplementation(async function (
    this: { model?: { modelName?: string }; op?: string },
    ...args: unknown[]
  ): Promise<unknown> {
    if (
      !intercepted &&
      this.model?.modelName === ReportSnapshot.modelName &&
      this.op === 'findOne'
    ) {
      intercepted = true;
      markStarted();
      await resumed;
    }
    return Reflect.apply(originalExec, this, args) as Promise<unknown>;
  });
  return {
    started,
    resume: resumeRead,
    restore: () => spy.mockRestore(),
  };
}

async function invalidPortalResponse() {
  return request(createApp()).get(`/api/client-portal/${'x'.repeat(43)}`);
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setClientReportsDb(getTestDb() as never);
});

afterAll(async () => {
  setClientReportsDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.restoreAllMocks();
});

describe('public client portal deletion consistency', () => {
  it('fails a corrupted stored portal locale closed as the ordinary 404', async () => {
    const target = await seedPortal({ withAudit: true });
    const invalid = await invalidPortalResponse();
    await ClientPortalToken.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(target.tokenId) },
      { $set: { locale: 'pt' } },
    );
    const response = await request(createApp()).get(`/api/client-portal/${target.rawToken}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual(invalid.body);
  });

  it('holds renewable account then site leases across every composed section read', async () => {
    const target = await seedPortal({
      withAudit: true,
      sections: { audit: true, ranks: true, gsc: true },
    });
    await seedDatedRankAndGsc(target);
    const pause = pauseNextAuditSnapshotRead();
    const pending = request(createApp())
      .get(`/api/client-portal/${target.rawToken}`)
      .then((response) => response);

    await pause.started;
    const duringRead = await Site.findById(target.siteId).select('workLeases').lean();
    expect(duringRead?.workLeases).toHaveLength(1);
    expect(await claimSiteDeletion({
      accountId: target.accountId,
      siteId: target.siteId,
    })).toEqual({ status: 'busy' });

    pause.resume();
    const response = await pending;
    pause.restore();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      site: { label: expect.stringMatching(/^Stable portal /) },
      sections: {
        audit: { snapshotDate: '2026-08-05T10:00:00.000Z' },
        ranks: {
          snapshotDate: '2026-08-05T11:00:00.000Z',
          rows: [{ keyword: 'stable rank phrase', position: 3 }],
        },
        gsc: {
          snapshotDate: '2026-08-05',
          totalClicks: 7,
          totalImpressions: 70,
        },
      },
    });
    expect((await Site.findById(target.siteId).lean())?.workLeases).toEqual([]);
    expect(await claimSiteDeletion({
      accountId: target.accountId,
      siteId: target.siteId,
    })).toMatchObject({ status: 'claimed' });
  });

  it('turns lease loss plus a winning deletion claim into 404, never a partial 200', async () => {
    const target = await seedPortal({ withAudit: true });
    const invalid = await invalidPortalResponse();
    const pause = pauseNextAuditSnapshotRead();
    const pending = request(createApp())
      .get(`/api/client-portal/${target.rawToken}`)
      .then((response) => response);

    await pause.started;
    await Site.updateOne({ _id: target.siteId }, { $set: { workLeases: [] } });
    expect(await claimSiteDeletion({
      accountId: target.accountId,
      siteId: target.siteId,
    })).toMatchObject({ status: 'claimed' });
    pause.resume();

    const response = await pending;
    pause.restore();
    expect(response.status).toBe(404);
    expect(response.body).toEqual(invalid.body);
    expect(response.body.sections).toBeUndefined();
  });

  it('rechecks revocation after a slow composition and returns the same 404', async () => {
    const target = await seedPortal({ withAudit: true });
    const invalid = await invalidPortalResponse();
    const pause = pauseNextAuditSnapshotRead();
    const pending = request(createApp())
      .get(`/api/client-portal/${target.rawToken}`)
      .then((response) => response);

    await pause.started;
    await ClientPortalToken.findByIdAndUpdate(target.tokenId, {
      $set: { revokedAt: new Date() },
    });
    pause.resume();

    const response = await pending;
    pause.restore();
    expect(response.status).toBe(404);
    expect(response.body).toEqual(invalid.body);
  });

  it('makes cross-account references, claims, and permanent tombstones indistinguishable', async () => {
    const target = await seedPortal({ withAudit: true });
    const invalid = await invalidPortalResponse();

    await getTestDb().insert(siteDeletionTombstones).values({
      siteId: target.siteId,
      deletionStartedAt: new Date(),
    });
    const siteTombstoned = await request(createApp())
      .get(`/api/client-portal/${target.rawToken}`);
    expect(siteTombstoned.status).toBe(404);
    expect(siteTombstoned.body).toEqual(invalid.body);
    await getTestDb().delete(siteDeletionTombstones);

    await getTestDb().insert(accountDeletionTombstones).values({
      accountId: target.accountId,
      deletionStartedAt: new Date(),
    });
    const accountTombstoned = await request(createApp())
      .get(`/api/client-portal/${target.rawToken}`);
    expect(accountTombstoned.status).toBe(404);
    expect(accountTombstoned.body).toEqual(invalid.body);
    await getTestDb().delete(accountDeletionTombstones);

    const foreign = await seedPortal({ withAudit: true });
    await ClientPortalToken.findByIdAndUpdate(target.tokenId, {
      $set: { siteId: foreign.siteId },
    });
    const crossAccount = await request(createApp())
      .get(`/api/client-portal/${target.rawToken}`);
    expect(crossAccount.status).toBe(404);
    expect(crossAccount.body).toEqual(invalid.body);

    await ClientPortalToken.findByIdAndUpdate(target.tokenId, {
      $set: { siteId: target.siteId },
    });
    await User.findByIdAndUpdate(target.accountId, {
      $set: { deletionScheduledAt: new Date(Date.now() - 1_000) },
    });
    expect(await claimAccountDeletion(target.accountId)).toMatchObject({
      status: 'claimed',
    });
    const accountDeleting = await request(createApp())
      .get(`/api/client-portal/${target.rawToken}`);
    expect(accountDeleting.status).toBe(404);
    expect(accountDeleting.body).toEqual(invalid.body);
  });

  it('preserves the live-target no-snapshot conflict instead of masking it as deletion', async () => {
    const target = await seedPortal();
    const response = await request(createApp())
      .get(`/api/client-portal/${target.rawToken}`);
    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe(
      'No dated report data is available for the selected sections.',
    );
  });
});
