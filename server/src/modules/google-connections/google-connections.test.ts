import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { pino } from 'pino';
import { symmetricEncrypt } from 'better-auth/crypto';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
  getTestDb,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import {
  GscReconnectRequiredError,
  VendorAuthError,
  VendorQuotaError,
  VendorUnavailableError,
  createFakeGa4Provider,
  createFakeGscProvider,
  FAKE_GA4_PROPERTIES,
  FAKE_GSC_SEARCH_ANALYTICS_COUNTRY,
  FAKE_GSC_SEARCH_ANALYTICS_DATE,
  FAKE_GSC_SEARCH_ANALYTICS_DEVICE,
  type Ga4Provider,
  type GscProperty,
  type GscSearchAnalyticsRow,
  type GscSitemapEntry,
} from '../../shared/providers/index.js';
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
import {
  __resetKeyRegistryForTests,
  __restoreKeyRegistryForTests,
  decryptSecret,
  encryptSecret,
} from '../../shared/crypto/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { AuditLog } from '../audit/index.js';
import {
  readLatestSnapshotDate,
  readPreviousSnapshotTotals,
  readSearchAnalytics,
  upsertSearchAnalytics,
  upsertSearchAppearance,
  upsertSitemaps,
} from '../gsc-snapshots/index.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import { upsertGa4Metrics } from '../ga4-snapshots/index.js';
import { GSC_DIMENSION_KEY_SEPARATOR } from '../../db/schema/gsc.js';
import { loadInventoryEvidence } from '../content-intelligence/inventory.evidence.js';
import { Site } from '../sites/index.js';
import {
  GoogleConnection,
  GoogleTokenDecryptionError,
  clearPlaintextRefreshToken,
  createCollectGscInsights,
  createCollectIndexStatus,
  getConnection,
  getGscSyncQueue,
  type GscInsightsPersistence,
  type GscSyncDeps,
  markNeedsReconnect,
  redactedLogger,
  resolveGoogleAccountFromBetterAuth,
  resolveAccessToken,
  revokeBetterAuthGoogleTokens,
  revokeAndDelete,
  runGscSync,
  setGoogleConnectionsDb,
  setGoogleGa4Provider,
  setGoogleGscProvider,
  setGa4SyncQueue,
  setGscSyncQueue,
  toIsoDate,
  upsertConnection,
  createGa4SyncProcessor,
  assertGa4StoredReadAccess,
  assertGscStoredReadAccess,
  enqueueGa4SyncForAccount,
  getGa4SyncQueue,
  rangeToWindowDays,
  runGa4Sync,
  type Ga4SyncDeps,
  SCOPE_GA4,
  SCOPE_GSC,
} from './index.js';
import {
  loadOwnedGoogleSite,
  listSiteGa4Properties,
  setSiteGoogleBindings,
} from './site-google.service.js';

// ---------------------------------------------------------------------------
// Test infra
// ---------------------------------------------------------------------------

const app = createApp();

type GoogleTestUser = TestUser & { siteId: string };

async function seedUser(email = 'owner@x.co'): Promise<GoogleTestUser> {
  const user = await signupVerifiedUser(app, { email });
  const seedDomain = `${user.id}.google-test.invalid`;
  const site = await Site.create({
    accountId: user.id,
    url: `https://${seedDomain}`,
    domain: seedDomain,
    displayName: 'Google test site',
  });
  return { ...user, siteId: String(site._id) };
}

const siteGooglePath = (siteId: string, suffix: string) =>
  `/api/sites/${siteId}/google${suffix}`;

const googlePath = (user: Pick<GoogleTestUser, 'siteId'>, suffix: string) =>
  siteGooglePath(user.siteId, suffix);

async function bindGscSite(
  accountId: string,
  siteId: string,
  propertyUrl = 'sc-domain:example.com',
): Promise<void> {
  await Site.updateOne(
    { _id: siteId, accountId },
    {
      $set: {
        gscPropertyUrl: propertyUrl,
        gscBindingGenerationId: 'legacy',
        gscBindingSource: 'legacy',
        'googleAutoMatch.gscStatus': 'bound',
      },
    },
  );
}

interface FakeGscOverrides {
  refresh?: () => Promise<{ accessToken: string; expiresIn: number }>;
  revoke?: (token: string) => Promise<void>;
  listProperties?: () => Promise<GscProperty[]>;
  inspectUrl?: GoogleGscProvider['inspectUrl'];
  querySearchAnalytics?: GoogleGscProvider['querySearchAnalytics'];
  listSitemaps?: GoogleGscProvider['listSitemaps'];
}

function makeGscProvider(overrides: FakeGscOverrides = {}): GoogleGscProvider {
  return {
    async listProperties() {
      if (overrides.listProperties) return overrides.listProperties();
      return [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }];
    },
    async inspectUrl(connection, input) {
      if (overrides.inspectUrl) return overrides.inspectUrl(connection, input);
      return {
        indexVerdict: 'PASS' as const,
        coverageState: 'Submitted and indexed',
        robotsTxtState: 'ALLOWED',
        pageFetchState: 'SUCCESSFUL',
        googleCanonical: 'https://example.com/',
        lastCrawlTime: new Date('2026-01-01T00:00:00.000Z'),
        richResults: { verdict: 'PASS' as const, items: [] },
      };
    },
    async querySearchAnalytics(connection, input) {
      if (overrides.querySearchAnalytics) {
        return overrides.querySearchAnalytics(connection, input);
      }
      return {
        rows: [
          {
            keys: ['seo audit'],
            clicks: 40,
            impressions: 2000,
            ctr: 0.02,
            position: 5.5,
          },
        ],
        sampled: true,
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
      };
    },
    async listSitemaps(connection, input) {
      if (overrides.listSitemaps) return overrides.listSitemaps(connection, input);
      return [
        {
          path: 'https://example.com/sitemap.xml',
          type: 'sitemap',
          lastSubmitted: new Date('2026-01-01T00:00:00.000Z'),
          lastDownloaded: new Date('2026-01-01T00:00:00.000Z'),
          isPending: false,
          isSitemapsIndex: false,
          errors: 0,
          warnings: 0,
          processed: 12,
        },
      ];
    },
    async refreshAccessToken() {
      if (overrides.refresh) return overrides.refresh();
      return { accessToken: 'fresh-access', expiresIn: 3600 };
    },
    async revokeToken(token) {
      if (overrides.revoke) return overrides.revoke(token);
    },
  };
}

const logger = pino({ level: 'silent' });

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setGoogleGscProvider(makeGscProvider());
  setGoogleGa4Provider(createFakeGa4Provider());
  setGoogleConnectionsDb(getTestDb() as unknown as never);
  vi.restoreAllMocks();
});

afterEach(() => {
  // The sync-queue holders are module-level; a test that injects a fake
  // queue must not leak it into the next (which asserts the no-op null path).
  setGscSyncQueue(null);
  setGa4SyncQueue(null);
});

// ---------------------------------------------------------------------------
// Auth gating
// ---------------------------------------------------------------------------

describe('google-connections routes — auth', () => {
  it('removes the global API and protects every nested site endpoint', async () => {
    expect((await request(app).get('/api/google/connection')).status).toBe(404);
    const base = '/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/google';
    expect(
      (await request(app).post(`${base}/connect/complete`).send({})).status,
    ).toBe(401);
    expect(
      (await request(app).patch(`${base}/bindings`).send({ gscPropertyUrl: 'x' }))
        .status,
    ).toBe(401);
    expect((await request(app).delete(`${base}/bindings`)).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /connect/complete
// ---------------------------------------------------------------------------

describe('POST /api/sites/:siteId/google/connect/complete', () => {
  it('encrypts + upserts the refresh token', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'live-refresh',
        googleAccountEmail: 'user@example.com',
        scopes: [SCOPE_GSC],
      });
    expect(res.status).toBe(201);
    expect(res.body.configuration.connection.status).toBe('connected');
    const doc = await GoogleConnection.findOne({ accountId: user.id });
    expect(doc).not.toBeNull();
    // Plaintext never leaves — but decrypting the ciphertext (with the
    // account-scoped AAD) returns it.
    expect(
      decryptSecret(doc!.encryptedRefreshToken as never, {
        aad: `google_connections:${user.id}:refreshToken`,
      }),
    ).toBe('live-refresh');
    expect(doc!.googleAccountEmail).toBe('user@example.com');

    const audit = await AuditLog.findOne({
      actorUserId: user.id,
      action: 'google.connect',
    }).lean();
    expect(audit).not.toBeNull();
    expect(audit?.targetType).toBe('site');
    expect(audit?.targetId).toBe(user.siteId);
  });

  it('rejects a missing GSC scope with a localized 400', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'r',
        googleAccountEmail: 'user@example.com',
        scopes: ['https://www.googleapis.com/auth/userinfo.email'],
      });
    expect(res.status).toBe(400);
  });

  it('rejects linking a different Google identity to the same account', async () => {
    const user = await seedUser('identity-owner@x.co');
    await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'first-token',
        googleAccountEmail: 'first-google@example.com',
        scopes: [SCOPE_GSC],
      })
      .expect(201);

    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'second-token',
        googleAccountEmail: 'another-google@example.com',
        scopes: [SCOPE_GSC],
      });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/same Google/i);
    const connection = await getConnection(user.id);
    expect(connection?.googleAccountEmail).toBe('first-google@example.com');
  });

  it('without a body token AND no Better Auth google row returns 404 notConnected', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({ googleAccountEmail: 'user@example.com', scopes: [SCOPE_GSC] });
    expect(res.status).toBe(404);
  });

  it('resolves the refresh token + scopes from the Better Auth account row when the body omits them', async () => {
    const user = await seedUser('google-link@x.co');
    // Seed the Better Auth `account` row as `linkSocial` would.
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'acc-google-1',
      accountId: 'google-sub-1',
      providerId: 'google',
      userId: user.id,
      refreshToken: 'resolved-from-better-auth',
      scope: `${SCOPE_GSC} https://www.googleapis.com/auth/userinfo.email`,
    });

    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.configuration.connection.status).toBe('connected');
    expect(res.body.configuration.connection.googleAccountEmail).toBe(
      'google-link@x.co',
    );

    const doc = await GoogleConnection.findOne({ accountId: user.id });
    expect(doc).not.toBeNull();
    expect(
      decryptSecret(doc!.encryptedRefreshToken as never, {
        aad: `google_connections:${user.id}:refreshToken`,
      }),
    ).toBe('resolved-from-better-auth');
    expect(doc!.scopes).toContain(SCOPE_GSC);

    // Security: the plaintext refresh token MUST be nullified in the
    // Better Auth account row once the encrypted envelope owns it.
    const accountRow = await getTestDb()
      .select({ refreshToken: accountTable.refreshToken })
      .from(accountTable)
      .where(eq(accountTable.userId, user.id));
    expect(accountRow[0]?.refreshToken).toBeNull();
  });

  it('decrypts a Better Auth encrypted refresh token before creating the product envelope', async () => {
    const user = await seedUser('google-encrypted@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    const encrypted = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: 'encrypted-google-refresh',
    });
    await getTestDb().insert(accountTable).values({
      id: 'acc-google-encrypted',
      accountId: 'google-sub-encrypted',
      providerId: 'google',
      userId: user.id,
      refreshToken: encrypted,
      scope: SCOPE_GSC,
    });

    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({});

    expect(res.status).toBe(201);
    const doc = await GoogleConnection.findOne({ accountId: user.id });
    expect(
      decryptSecret(doc!.encryptedRefreshToken as never, {
        aad: `google_connections:${user.id}:refreshToken`,
      }),
    ).toBe('encrypted-google-refresh');
    const [row] = await getTestDb()
      .select({ refreshToken: accountTable.refreshToken })
      .from(accountTable)
      .where(eq(accountTable.userId, user.id));
    expect(row?.refreshToken).toBeNull();
  });

  it('fails a malformed encrypted Better Auth token as localized not-connected', async () => {
    const user = await seedUser('google-malformed-encrypted@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'acc-google-malformed-encrypted',
      accountId: 'google-sub-malformed-encrypted',
      providerId: 'google',
      userId: user.id,
      refreshToken: '$ba$1$not-hex',
      scope: SCOPE_GSC,
    });

    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({});

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('$ba$1$not-hex');
    expect(await GoogleConnection.findOne({ accountId: user.id })).toBeNull();
  });

  it('preserves unexpected token resolver failures and rejects an empty resolved token', async () => {
    const user = await seedUser('google-resolver-boundaries@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'acc-google-resolver-boundaries',
      accountId: 'google-sub-resolver-boundaries',
      providerId: 'google',
      userId: user.id,
      refreshToken: 'stored-token',
      scope: SCOPE_GSC,
    });

    const unexpected = new Error('resolver unavailable');
    await expect(
      resolveGoogleAccountFromBetterAuth(user.id, async () => {
        throw unexpected;
      }),
    ).rejects.toBe(unexpected);
    await expect(
      resolveGoogleAccountFromBetterAuth(user.id, async () => null),
    ).rejects.toMatchObject({ status: 404, message: 'google.errors.notConnected' });
  });

  it('uses the same privacy-preserving ownership check for refresh controllers', async () => {
    const user = await seedUser('google-refresh-missing-site@x.co');
    await expect(
      loadOwnedGoogleSite(user.id, '507f1f77bcf86cd799439011'),
    ).rejects.toMatchObject({ status: 404, message: 'sites.errors.notFound' });
  });

  it('parses a COMMA-joined account.scope (real Better Auth format) — no spurious missingScope', async () => {
    // Better Auth persists the granted scopes comma-joined, not space-joined.
    // A whitespace-only split collapses this into a single element and the
    // GSC-scope check fails on every real multi-scope connection (prod bug).
    const user = await seedUser('google-comma-scope@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb()
      .insert(accountTable)
      .values({
        id: 'acc-comma-1',
        accountId: 'google-comma-sub',
        providerId: 'google',
        userId: user.id,
        refreshToken: 'comma-scope-token',
        scope: `${SCOPE_GSC},openid,https://www.googleapis.com/auth/userinfo.email`,
      });

    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.configuration.connection.status).toBe('connected');
    const doc = await GoogleConnection.findOne({ accountId: user.id });
    expect(doc!.scopes).toContain(SCOPE_GSC);
    expect(doc!.scopes).toContain('openid');
  });

  it('nullifies the plaintext refresh_token in the account row even on a re-connect (upsert)', async () => {
    const user = await seedUser('google-reconnect@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'acc-recon-1',
      accountId: 'google-recon-sub',
      providerId: 'google',
      userId: user.id,
      refreshToken: 'first-token',
      scope: SCOPE_GSC,
    });

    // First connect — encrypts + nullifies.
    await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({});
    let accountRow = await getTestDb()
      .select({ refreshToken: accountTable.refreshToken })
      .from(accountTable)
      .where(eq(accountTable.userId, user.id));
    expect(accountRow[0]?.refreshToken).toBeNull();

    // Simulate a re-connect: the client supplies the new token directly in
    // the body (the Better Auth account row is already nullified, so the
    // server-side resolve path returns 404 — the body path is the only way).
    await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'second-token',
        googleAccountEmail: 'google-reconnect@x.co',
        scopes: [SCOPE_GSC],
      });
    accountRow = await getTestDb()
      .select({ refreshToken: accountTable.refreshToken })
      .from(accountTable)
      .where(eq(accountTable.userId, user.id));
    expect(accountRow[0]?.refreshToken).toBeNull();
  });

  it('treats empty-string refreshToken/email as omitted and resolves from Better Auth', async () => {
    const user = await seedUser('google-empty@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'acc-google-empty',
      accountId: 'google-sub-empty',
      providerId: 'google',
      userId: user.id,
      refreshToken: 'resolved-empty',
      scope: `${SCOPE_GSC} https://www.googleapis.com/auth/userinfo.email`,
    });

    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      // Empty strings exercise the schema preprocess ('' → undefined) branch.
      .send({ refreshToken: '', googleAccountEmail: '' });
    expect(res.status).toBe(201);
    const doc = await GoogleConnection.findOne({ accountId: user.id });
    expect(
      decryptSecret(doc!.encryptedRefreshToken as never, {
        aad: `google_connections:${user.id}:refreshToken`,
      }),
    ).toBe('resolved-empty');
  });

  it('rejects when the Better Auth account has no scope (scope-null branch)', async () => {
    const user = await seedUser('google-noscope@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'acc-google-noscope',
      accountId: 'google-sub-noscope',
      providerId: 'google',
      userId: user.id,
      refreshToken: 'resolved-noscope',
      scope: null,
    });

    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({});
    // scope null → resolved scopes = [] → the GSC-scope guard rejects with 400.
    expect(res.status).toBe(400);
  });

  it('does not persist the deprecated account-global propertyUrl hint', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'r',
        googleAccountEmail: 'user@example.com',
        scopes: [SCOPE_GSC],
        propertyUrl: 'sc-domain:example.com',
      });
    expect(res.status).toBe(201);
    const [doc, site] = await Promise.all([
      GoogleConnection.findOne({ accountId: user.id }).select('+propertyUrl'),
      Site.findById(user.siteId),
    ]);
    expect(doc?.propertyUrl).toBeNull();
    expect(site?.gscPropertyUrl).toBeNull();
  });

  it('ignores a body refreshToken for the live provider outside test mode', async () => {
    const user = await seedUser('gate-off@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'acc-gate-off',
      accountId: 'google-gate-off',
      providerId: 'google',
      userId: user.id,
      refreshToken: 'authoritative-server-token',
      scope: SCOPE_GSC,
    });
    const { env } = await import('../../config/env.js');
    const originalNodeEnv = env.NODE_ENV;
    const originalProvider = env.PROVIDER_GSC;
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    (env as { PROVIDER_GSC: string }).PROVIDER_GSC = 'google';
    try {
      const res = await request(app)
        .post(googlePath(user, '/connect/complete'))
        .set('Cookie', user.cookie)
        .send({
          refreshToken: 'attacker-supplied',
          googleAccountEmail: 'attacker@evil.example',
          scopes: [SCOPE_GSC],
        });
      expect(res.status).toBe(201);
      const doc = await GoogleConnection.findOne({ accountId: user.id });
      // The server-resolved token wins; the body value is ignored.
      expect(decryptSecret(doc!.encryptedRefreshToken as never, {
        aad: `google_connections:${user.id}:refreshToken`,
      })).toBe('authoritative-server-token');
      // Email is the resolved server value (owner email), not the body.
      expect(doc!.googleAccountEmail).toBe('gate-off@x.co');
    } finally {
      (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
      (env as { PROVIDER_GSC: string }).PROVIDER_GSC = originalProvider;
    }
  });

  it('accepts inert body credentials for the fake provider outside test mode', async () => {
    const user = await seedUser('fake-compose-link@x.co');
    const { env } = await import('../../config/env.js');
    const originalNodeEnv = env.NODE_ENV;
    const originalProvider = env.PROVIDER_GSC;
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    (env as { PROVIDER_GSC: string }).PROVIDER_GSC = 'fake';
    try {
      const res = await request(app)
        .post(googlePath(user, '/connect/complete'))
        .set('Cookie', user.cookie)
        .send({
          refreshToken: 'fake-provider-token',
          googleAccountEmail: 'fake-compose-link@x.co',
          scopes: [SCOPE_GSC],
        });
      expect(res.status).toBe(201);
      const [doc, site] = await Promise.all([
        GoogleConnection.findOne({ accountId: user.id }),
        Site.findById(user.siteId),
      ]);
      expect(site?.gscPropertyUrl).toBeNull();
      expect(
        decryptSecret(doc!.encryptedRefreshToken as never, {
          aad: `google_connections:${user.id}:refreshToken`,
        }),
      ).toBe('fake-provider-token');
    } finally {
      (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
      (env as { PROVIDER_GSC: string }).PROVIDER_GSC = originalProvider;
    }
  });
});

// ---------------------------------------------------------------------------
// GET /connection
// ---------------------------------------------------------------------------

describe('GET /api/sites/:siteId/google/configuration', () => {
  it('returns null when there is no connection', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get(googlePath(user, '/configuration'))
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.configuration.connection).toBeNull();
    expect(res.body.configuration.gsc.propertyUrl).toBeNull();
  });

  it('returns the shared credential and the current Site bindings', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const res = await request(app)
      .get(googlePath(user, '/configuration'))
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.configuration.connection.status).toBe('connected');
    expect(res.body.configuration.gsc.propertyUrl).toBeNull();
    const properties = await request(app)
      .get(googlePath(user, '/search-properties'))
      .set('Cookie', user.cookie);
    expect(properties.status).toBe(200);
    expect(properties.body.properties).toEqual([
      {
        siteUrl: 'sc-domain:example.com',
        permissionLevel: 'siteOwner',
        inUseBy: [],
      },
    ]);
  });

  it('returns the connection without properties when needs_reconnect', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await markNeedsReconnect(user.id);
    const res = await request(app)
      .get(googlePath(user, '/configuration'))
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.configuration.connection.status).toBe('needs_reconnect');
  });

  it('keeps configuration readable when live property listing is unavailable', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    setGoogleGscProvider(
      makeGscProvider({
        listProperties: async () => {
          throw new VendorUnavailableError('down', {
            provider: 'google',
            operation: 'gsc-sites-list',
          });
        },
      }),
    );
    const res = await request(app)
      .get(googlePath(user, '/configuration'))
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.configuration.connection.status).toBe('connected');
    const properties = await request(app)
      .get(googlePath(user, '/search-properties'))
      .set('Cookie', user.cookie);
    expect(properties.status).toBe(500);
  });

  it('account isolation — user A never sees user B\'s connection', async () => {
    const userA = await seedUser('a@x.co');
    const userB = await seedUser('b@x.co');
    await upsertConnection({
      accountId: userB.id,
      googleAccountEmail: 'b@example.com',
      refreshToken: 'r-b',
      scopes: [SCOPE_GSC],
    });
    const res = await request(app)
      .get(googlePath(userA, '/configuration'))
      .set('Cookie', userA.cookie);
    expect(res.status).toBe(200);
    expect(res.body.configuration.connection).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PATCH /connection — set property
// ---------------------------------------------------------------------------

describe('PATCH /api/sites/:siteId/google/bindings', () => {
  it('persists a verified property + records an audit', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ gscPropertyUrl: 'sc-domain:example.com' });
    expect(res.status).toBe(200);
    expect(res.body.configuration.gsc.propertyUrl).toBe('sc-domain:example.com');
    const site = await Site.findById(user.siteId);
    expect(site?.gscPropertyUrl).toBe('sc-domain:example.com');

    const audit = await AuditLog.findOne({
      actorUserId: user.id,
      action: 'google.set_site_bindings',
    }).lean();
    expect(audit).not.toBeNull();
    expect(audit?.targetType).toBe('site');
    expect(audit?.targetId).toBe(user.siteId);
  });

  it('allows two Sites to reuse the same GSC and GA4 resources', async () => {
    const user = await seedUser('google-reuse@x.co');
    const secondSite = await Site.create({
      accountId: user.id,
      url: 'https://second.example.com',
      domain: 'second.example.com',
      displayName: 'Second site',
    });
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    const binding = {
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'properties/100000001',
    };

    await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send(binding)
      .expect(200);
    await request(app)
      .patch(siteGooglePath(String(secondSite._id), '/bindings'))
      .set('Cookie', user.cookie)
      .send(binding)
      .expect(200);

    const [first, second, gscResources, ga4Resources] = await Promise.all([
      Site.findById(user.siteId),
      Site.findById(secondSite._id),
      request(app)
        .get(googlePath(user, '/search-properties'))
        .set('Cookie', user.cookie),
      request(app)
        .get(googlePath(user, '/analytics-properties'))
        .set('Cookie', user.cookie),
    ]);
    expect(first).toMatchObject(binding);
    expect(second).toMatchObject(binding);
    expect(
      gscResources.body.properties[0].inUseBy
        .map((usage: { siteId: string }) => usage.siteId)
        .sort(),
    ).toEqual([user.siteId, String(secondSite._id)].sort());
    const reusedGa4 = ga4Resources.body.properties.find(
      (property: { propertyId: string }) =>
        property.propertyId === 'properties/100000001',
    );
    expect(
      reusedGa4.inUseBy
        .map((usage: { siteId: string }) => usage.siteId)
        .sort(),
    ).toEqual([user.siteId, String(secondSite._id)].sort());
  });

  it('rejects a property outside the verified list with a localized 400', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ gscPropertyUrl: 'sc-domain:not-mine.example' });
    expect(res.status).toBe(400);
    const site = await Site.findById(user.siteId);
    expect(site?.gscPropertyUrl).toBeNull();
  });

  it('400 on a blank gscPropertyUrl (schema validation)', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ gscPropertyUrl: '' });
    expect(res.status).toBe(400);
  });

  it('404 when there is no connection to update', async () => {
    const user = await seedUser();
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ gscPropertyUrl: 'sc-domain:example.com' });
    expect(res.status).toBe(404);
  });

  it('404 when the connection is not in the connected state', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await markNeedsReconnect(user.id);
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ gscPropertyUrl: 'sc-domain:example.com' });
    expect(res.status).toBe(404);
  });

  it('account isolation — user A cannot set a property on user B\'s connection', async () => {
    const userA = await seedUser('a@x.co');
    const userB = await seedUser('b@x.co');
    await upsertConnection({
      accountId: userB.id,
      googleAccountEmail: 'b@example.com',
      refreshToken: 'r-b',
      scopes: [SCOPE_GSC],
    });
    // A has no connection of its own → 404, and B's row is untouched.
    const res = await request(app)
      .patch(googlePath(userA, '/bindings'))
      .set('Cookie', userA.cookie)
      .send({ gscPropertyUrl: 'sc-domain:example.com' });
    expect(res.status).toBe(404);
    const bSite = await Site.findById(userB.siteId);
    expect(bSite?.gscPropertyUrl).toBeNull();
  });

  it('setSiteGoogleBindings runs without a logger param', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const change = await setSiteGoogleBindings(
      user.id,
      user.siteId,
      { gscPropertyUrl: 'sc-domain:example.com' },
      { gscProvider: makeGscProvider() },
    );
    expect(change.site.gscPropertyUrl).toBe('sc-domain:example.com');
  });

  it('setSiteGoogleBindings accepts a logger', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const change = await setSiteGoogleBindings(
      user.id,
      user.siteId,
      { gscPropertyUrl: 'sc-domain:example.com' },
      { gscProvider: makeGscProvider(), logger },
    );
    expect(change.site.gscPropertyUrl).toBe('sc-domain:example.com');
  });
});

// ---------------------------------------------------------------------------
// Site unlink vs account-wide credential revoke
// ---------------------------------------------------------------------------

describe('site-scoped unlink and credential revoke', () => {
  it('calls revoke, clears every binding, and deletes the shared record', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r-live',
      scopes: [SCOPE_GSC],
    });
    await setSiteGoogleBindings(
      user.id,
      user.siteId,
      { gscPropertyUrl: 'sc-domain:example.com' },
      { gscProvider: makeGscProvider() },
    );
    const revoke = vi.fn(async () => {});
    setGoogleGscProvider(makeGscProvider({ revoke }));
    const res = await request(app)
      .post(googlePath(user, '/credential/revoke'))
      .set('Cookie', user.cookie)
      .send({ acknowledgeAllSites: true });
    expect(res.status).toBe(200);
    expect(res.body.affectedSiteCount).toBe(1);
    expect(revoke).toHaveBeenCalled();
    expect(await GoogleConnection.findOne({ accountId: user.id })).toBeNull();

    const audit = await AuditLog.findOne({
      actorUserId: user.id,
      action: 'google.disconnect',
    }).lean();
    expect(audit).not.toBeNull();
    expect(audit?.targetType).toBe('user');
    expect(audit?.targetId).toBe(user.id);
    expect((await Site.findById(user.siteId))?.gscPropertyUrl).toBeNull();
  });

  it('404 when there is nothing to disconnect', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post(googlePath(user, '/credential/revoke'))
      .set('Cookie', user.cookie)
      .send({ acknowledgeAllSites: true });
    expect(res.status).toBe(404);
  });

  it('is idempotent when the record is already gone (via service call)', async () => {
    // First call — no record; direct service call resolves without throw.
    // Use a valid but nonexistent ObjectId so Mongoose does not reject the query.
    await revokeAndDelete('deadbeefdeadbeefdeadbeef', makeGscProvider());
    // Nothing to assert beyond "no throw".
  });

  it('proceeds to delete locally even when Google revoke fails', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    setGoogleGscProvider(
      makeGscProvider({
        revoke: async () => {
          throw new VendorUnavailableError('down', {
            provider: 'google',
            operation: 'gsc-token-revoke',
          });
        },
      }),
    );
    const res = await request(app)
      .post(googlePath(user, '/credential/revoke'))
      .set('Cookie', user.cookie)
      .send({ acknowledgeAllSites: true });
    expect(res.status).toBe(200);
    expect(await GoogleConnection.findOne({ accountId: user.id })).toBeNull();
  });

  it('unlinks one Site without revoking the shared credential', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await setSiteGoogleBindings(
      user.id,
      user.siteId,
      { gscPropertyUrl: 'sc-domain:example.com' },
      { gscProvider: makeGscProvider() },
    );
    const res = await request(app)
      .delete(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.configuration.gsc.propertyUrl).toBeNull();
    expect(await GoogleConnection.findOne({ accountId: user.id })).not.toBeNull();
  });
});

describe('Better Auth Google token erasure', () => {
  it('decrypts, de-duplicates, and revokes only the target account tokens', async () => {
    const target = await seedUser('oauth-delete-target@x.co');
    const control = await seedUser('oauth-delete-control@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    const encryptedAccess = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: 'token-z',
    });
    await getTestDb().insert(accountTable).values([
      {
        id: 'oauth-target-one',
        accountId: 'google-target-one',
        providerId: 'google',
        userId: target.id,
        accessToken: encryptedAccess,
        refreshToken: 'token-a',
      },
      {
        id: 'oauth-target-two',
        accountId: 'google-target-two',
        providerId: 'google',
        userId: target.id,
        accessToken: 'token-a',
      },
      {
        id: 'oauth-control',
        accountId: 'google-control',
        providerId: 'google',
        userId: control.id,
        refreshToken: 'foreign-token',
      },
    ]);
    const revoke = vi.fn(async (_token: string) => {});

    await expect(
      revokeBetterAuthGoogleTokens(target.id, makeGscProvider({ revoke })),
    ).resolves.toBe(2);
    expect(revoke.mock.calls.map(([token]) => token)).toEqual(['token-a', 'token-z']);
  });

  it('ignores ID-token-only rows and needs no configured provider', async () => {
    const user = await seedUser('oauth-id-only@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'oauth-id-only',
      accountId: 'google-id-only',
      providerId: 'google',
      userId: user.id,
      idToken: 'id-token-is-erased-locally',
    });

    await expect(revokeBetterAuthGoogleTokens(user.id, null)).resolves.toBe(0);
  });

  it('fails closed when revocable credentials exist without a provider', async () => {
    const user = await seedUser('oauth-no-provider@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'oauth-no-provider',
      accountId: 'google-no-provider',
      providerId: 'google',
      userId: user.id,
      accessToken: 'still-live-access',
    });

    await expect(revokeBetterAuthGoogleTokens(user.id, null)).rejects.toThrow(
      'Google token revocation is unavailable',
    );
  });
});

// ---------------------------------------------------------------------------
// Crypto path + service internals
// ---------------------------------------------------------------------------

describe('crypto + service internals', () => {
  it('encrypt→decrypt roundtrip preserves the refresh token', () => {
    const enc = encryptSecret('secret-refresh');
    expect(decryptSecret(enc)).toBe('secret-refresh');
  });

  it('tampered authTag fails closed', () => {
    const enc = encryptSecret('secret');
    // Flip a byte in the authTag by re-encoding a mutated buffer.
    const tampered = { ...enc, authTag: Buffer.alloc(16).toString('base64') };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rotated master key path → needs_reconnect + GscReconnectRequiredError', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    // Force decryption failure: swap out the registry key.
    __resetKeyRegistryForTests({
      keys: [{ version: 99, key: Buffer.alloc(32, 1) }],
      currentVersion: 99,
    });
    try {
      await expect(
        resolveAccessToken(user.id, makeGscProvider()),
      ).rejects.toBeInstanceOf(GscReconnectRequiredError);
      const doc = await getConnection(user.id);
      expect(doc?.status).toBe('needs_reconnect');
    } finally {
      __restoreKeyRegistryForTests();
    }
  });

  it('resolveAccessToken → invalid_grant marks needs_reconnect and rethrows', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const provider = makeGscProvider({
      refresh: async () => {
        throw new GscReconnectRequiredError('dead', {
          provider: 'google',
          operation: 'gsc-token-refresh',
        });
      },
    });
    await expect(
      resolveAccessToken(user.id, provider),
    ).rejects.toBeInstanceOf(GscReconnectRequiredError);
    expect((await getConnection(user.id))?.status).toBe('needs_reconnect');
  });

  it('resolveAccessToken → other errors rethrow without marking needs_reconnect', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const provider = makeGscProvider({
      refresh: async () => {
        throw new VendorUnavailableError('down', {
          provider: 'google',
          operation: 'gsc-token-refresh',
        });
      },
    });
    await expect(
      resolveAccessToken(user.id, provider),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
    expect((await getConnection(user.id))?.status).toBe('connected');
  });

  it('resolveAccessToken 404s when no connection exists', async () => {
    await expect(
      resolveAccessToken('deadbeefdeadbeefdeadbeef', makeGscProvider()),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('resolveAccessToken 404s on a revoked connection', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await GoogleConnection.updateOne(
      { accountId: user.id },
      { $set: { status: 'revoked' } },
    );
    await expect(
      resolveAccessToken(user.id, makeGscProvider()),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('resolveAccessToken records lastUsedAt on success', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const before = await getConnection(user.id);
    expect(before?.lastUsedAt).toBeNull();
    await resolveAccessToken(user.id, makeGscProvider());
    const after = await getConnection(user.id);
    expect(after?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('revokeAndDelete logs a warning when the revoke call fails and a logger is provided', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const provider = makeGscProvider({
      revoke: async () => {
        throw new VendorUnavailableError('down', {
          provider: 'google',
          operation: 'gsc-token-revoke',
        });
      },
    });
    await revokeAndDelete(user.id, provider, logger);
    expect(await GoogleConnection.findOne({ accountId: user.id })).toBeNull();
  });

  it('fail-closed purge mode keeps ciphertext when remote revoke is retryable', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r-retry',
      scopes: [SCOPE_GSC],
    });
    const failure = new VendorUnavailableError('down', {
      provider: 'google',
      operation: 'gsc-token-revoke',
    });
    const provider = makeGscProvider({
      revoke: async () => Promise.reject(failure),
    });

    await expect(
      revokeAndDelete(user.id, provider, logger, { failClosed: true }),
    ).rejects.toBe(failure);
    expect(await GoogleConnection.findOne({ accountId: user.id })).not.toBeNull();
  });

  it('resolveAccessToken logs a warning on decryption failure when a logger is provided', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    __resetKeyRegistryForTests({
      keys: [{ version: 99, key: Buffer.alloc(32, 2) }],
      currentVersion: 99,
    });
    try {
      await expect(
        resolveAccessToken(user.id, makeGscProvider(), logger),
      ).rejects.toBeInstanceOf(GscReconnectRequiredError);
      const doc = await GoogleConnection.findOne({ accountId: user.id });
      expect(doc?.status).toBe('needs_reconnect');
    } finally {
      __restoreKeyRegistryForTests();
    }
  });

  it('revokeAndDelete on undecryptable ciphertext still drops the record', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    __resetKeyRegistryForTests({
      keys: [{ version: 99, key: Buffer.alloc(32, 2) }],
      currentVersion: 99,
    });
    try {
      const revoke = vi.fn();
      await revokeAndDelete(user.id, makeGscProvider({ revoke }), logger);
      expect(revoke).not.toHaveBeenCalled();
      expect(await GoogleConnection.findOne({ accountId: user.id })).toBeNull();
    } finally {
      __restoreKeyRegistryForTests();
    }
  });

  it('fail-closed purge retains undecryptable ciphertext and succeeds after key recovery', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'recoverable-refresh-token',
      scopes: [SCOPE_GSC],
    });
    const revoke = vi.fn(async (_token: string) => {});
    __resetKeyRegistryForTests({
      keys: [{ version: 99, key: Buffer.alloc(32, 3) }],
      currentVersion: 99,
    });
    try {
      await expect(
        revokeAndDelete(user.id, makeGscProvider({ revoke }), logger, {
          failClosed: true,
        }),
      ).rejects.toBeInstanceOf(GoogleTokenDecryptionError);
      expect(revoke).not.toHaveBeenCalled();
      expect(await GoogleConnection.findOne({ accountId: user.id })).not.toBeNull();
    } finally {
      __restoreKeyRegistryForTests();
    }

    await expect(
      revokeAndDelete(user.id, makeGscProvider({ revoke }), logger, {
        failClosed: true,
      }),
    ).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('recoverable-refresh-token');
    expect(await GoogleConnection.findOne({ accountId: user.id })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pino log redaction
// ---------------------------------------------------------------------------

describe('redactedLogger', () => {
  it('redacts every OAuth token alias on serialized log output', async () => {
    const chunks: string[] = [];
    const stream = {
      write(chunk: string) {
        chunks.push(chunk);
      },
    };
    const base = pino({ level: 'info' }, stream as never);
    const child = redactedLogger(base);
    child.info(
      {
        accountId: 'a',
        refreshToken: 'super-secret',
        accessToken: 'access-secret',
        idToken: 'id-secret',
        access_token: 'access-snake-secret',
        refresh_token: 'refresh-snake-secret',
        id_token: 'id-snake-secret',
        encryptedRefreshToken: 'ciphertext',
        connection: { refreshToken: 'also-secret' },
      },
      'logging a connection',
    );
    const combined = chunks.join('');
    expect(combined).not.toContain('super-secret');
    expect(combined).not.toContain('also-secret');
    expect(combined).not.toContain('access-secret');
    expect(combined).not.toContain('id-secret');
    expect(combined).not.toContain('access-snake-secret');
    expect(combined).not.toContain('refresh-snake-secret');
    expect(combined).not.toContain('id-snake-secret');
    expect(combined).not.toContain('ciphertext');
    expect(combined).toContain('[REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// createCollectIndexStatus
// ---------------------------------------------------------------------------

describe('createCollectIndexStatus', () => {
  it('not-connected when no row exists', async () => {
    const user = await seedUser();
    const collect = createCollectIndexStatus(makeGscProvider(), logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com'],
    });
    expect(out).toEqual({ status: 'not-connected', samples: [] });
  });

  it('needs-reconnect when connection status is needs_reconnect', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    await markNeedsReconnect(user.id);
    const collect = createCollectIndexStatus(makeGscProvider(), logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com'],
    });
    expect(out.status).toBe('needs-reconnect');
  });

  it('needs-reconnect when refreshAccessToken throws GscReconnectRequiredError', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    const provider = makeGscProvider({
      refresh: async () => {
        throw new GscReconnectRequiredError('dead', {
          provider: 'google',
          operation: 'gsc-token-refresh',
        });
      },
    });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com'],
    });
    expect(out.status).toBe('needs-reconnect');
  });

  it('unavailable when refresh throws a non-reconnect error', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    const provider = makeGscProvider({
      refresh: async () => {
        throw new VendorUnavailableError('down', {
          provider: 'google',
          operation: 'gsc-token-refresh',
        });
      },
    });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com'],
    });
    expect(out.status).toBe('unavailable');
  });

  it('does not live-discover a property for an unbound site', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const listProperties = vi.fn(async () => {
      throw new VendorUnavailableError('down', {
        provider: 'google',
        operation: 'gsc-sites-list',
      });
    });
    const provider = makeGscProvider({ listProperties });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com'],
    });
    expect(out.status).toBe('not-connected');
    expect(listProperties).not.toHaveBeenCalled();
  });

  it('uses an explicitly bound property even when it belongs to another domain', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId, 'sc-domain:other.example');
    const inspectUrl = vi.fn(async () => ({
      indexVerdict: 'PASS' as const,
      coverageState: 'Submitted and indexed',
      robotsTxtState: 'ALLOWED',
      pageFetchState: 'SUCCESSFUL',
      googleCanonical: 'https://example.com/',
      lastCrawlTime: new Date('2026-01-01T00:00:00.000Z'),
      richResults: { verdict: 'PASS' as const, items: [] },
    }));
    const provider = makeGscProvider({
      inspectUrl,
    });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com'],
    });
    expect(out.status).toBe('ok');
    expect(inspectUrl).toHaveBeenCalledWith(
      { accessToken: 'fresh-access' },
      {
        inspectionUrl: 'https://example.com',
        siteUrl: 'sc-domain:other.example',
      },
    );
  });

  it('ok — uses the Site property binding and skips property listing', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    const listProperties = vi.fn();
    const provider = makeGscProvider({ listProperties });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com'],
    });
    expect(out.status).toBe('ok');
    expect(out.samples).toHaveLength(1);
    expect(listProperties).not.toHaveBeenCalled();
  });

  it('leaves auto-matching to the background matcher when the Site is unbound', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const listProperties = vi.fn(async () => [
      { siteUrl: 'sc-domain:other.example', permissionLevel: 'siteOwner' as const },
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' as const },
    ]);
    const provider = makeGscProvider({ listProperties });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com/'],
    });
    expect(out.status).toBe('not-connected');
    expect(out.samples).toHaveLength(0);
    expect(listProperties).not.toHaveBeenCalled();
  });

  it('quota-exceeded when a per-URL inspection throws VendorQuotaError', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    const provider = makeGscProvider({
      inspectUrl: async () => {
        throw new VendorQuotaError('429', {
          provider: 'google',
          operation: 'gsc-url-inspect',
        });
      },
    });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com/', 'https://example.com/a'],
    });
    expect(out.status).toBe('quota-exceeded');
  });

  it('needs-reconnect + marks status when a per-URL inspection throws GscReconnectRequiredError', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    const provider = makeGscProvider({
      inspectUrl: async () => {
        throw new GscReconnectRequiredError('dead', {
          provider: 'google',
          operation: 'gsc-url-inspect',
        });
      },
    });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com/'],
    });
    expect(out.status).toBe('needs-reconnect');
    expect((await getConnection(user.id))?.status).toBe('needs_reconnect');
  });

  it('logs and skips a URL when inspection fails for a non-fatal reason', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    let call = 0;
    const provider = makeGscProvider({
      inspectUrl: async () => {
        call += 1;
        if (call === 1) {
          throw new VendorUnavailableError('down', {
            provider: 'google',
            operation: 'gsc-url-inspect',
          });
        }
        return {
          indexVerdict: 'PASS' as const,
          coverageState: 'Submitted and indexed',
          robotsTxtState: 'ALLOWED',
          pageFetchState: 'SUCCESSFUL',
          googleCanonical: 'https://example.com/',
          lastCrawlTime: new Date('2026-01-01T00:00:00.000Z'),
          richResults: { verdict: 'PASS' as const, items: [] },
        };
      },
    });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com/', 'https://example.com/a'],
    });
    expect(out.status).toBe('ok');
    expect(out.samples).toHaveLength(1);
  });

  it('routes work without a logger param', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    const provider = makeGscProvider();
    const collect = createCollectIndexStatus(provider);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com/'],
    });
    expect(out.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Router 500 when no provider is wired
// ---------------------------------------------------------------------------

describe('router without a wired provider', () => {
  it('GET /connection 500s when no provider is set (never crashes the app)', async () => {
    const user = await seedUser();
    setGoogleGscProvider(null);
    try {
      // Connection exists — GET path will try to proxy properties.
      await upsertConnection({
        accountId: user.id,
        googleAccountEmail: 'user@example.com',
        refreshToken: 'r',
        scopes: [SCOPE_GSC],
      });
      const res = await request(app)
      .get(googlePath(user, '/configuration'))
        .set('Cookie', user.cookie);
      expect(res.status).toBe(500);
    } finally {
      setGoogleGscProvider(makeGscProvider());
    }
  });
});

// ---------------------------------------------------------------------------
// inspectUrlFor — direct service function
// ---------------------------------------------------------------------------

describe('inspectUrlFor', () => {
  it('resolves an access token and delegates to gscProvider.inspectUrl', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const inspectUrl = vi.fn(async () => ({
      indexVerdict: 'PASS' as const,
      coverageState: 'ok',
      robotsTxtState: 'ALLOWED',
      pageFetchState: 'SUCCESSFUL',
      googleCanonical: 'https://example.com/',
      lastCrawlTime: new Date('2026-01-01T00:00:00Z'),
      richResults: { verdict: 'PASS' as const, items: [] },
    }));
    const provider = makeGscProvider({ inspectUrl });
    const { inspectUrlFor } = await import('./google-connections.service.js');
    const out = await inspectUrlFor(
      {
        accountId: user.id,
        siteUrl: 'sc-domain:example.com',
        inspectionUrl: 'https://example.com/',
      },
      provider,
      logger,
    );
    expect(out.indexVerdict).toBe('PASS');
    expect(inspectUrl).toHaveBeenCalledTimes(1);
  });

  it('runs without a logger param', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const { inspectUrlFor } = await import('./google-connections.service.js');
    const out = await inspectUrlFor(
      {
        accountId: user.id,
        siteUrl: 'sc-domain:example.com',
        inspectionUrl: 'https://example.com/',
      },
      makeGscProvider(),
    );
    expect(out.indexVerdict).toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// collectIndexStatus — background matching boundary
// ---------------------------------------------------------------------------

describe('createCollectIndexStatus — background matching boundary', () => {
  it('does not discover a property inline when the Site has no binding', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const listProperties = vi.fn(async () => [
        { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
    ]);
    const provider = makeGscProvider({ listProperties });
    const collect = createCollectIndexStatus(provider, logger);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com/'],
    });
    expect(out).toEqual({ status: 'not-connected', samples: [] });
    expect(listProperties).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Router + controller logger propagation (branch coverage)
// ---------------------------------------------------------------------------

describe('createGoogleConnectionsRouter with an explicit logger', () => {
  it('propagates the router logger through to the controller/service', async () => {
    const mongoose = (await import('mongoose')).default;
    const { createGoogleConnectionsRouter } = await import(
      './google-connections.routes.js'
    );
    const { default: express } = await import('express');
    const accountId = new mongoose.Types.ObjectId().toString();
    const site = await Site.create({
      accountId,
      url: 'https://example.com',
      domain: 'example.com',
    });
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as { user?: { id: string } }).user = { id: accountId };
      next();
    });
    testApp.use(
      '/api/sites/:siteId/google',
      createGoogleConnectionsRouter({
        gscProvider: makeGscProvider({
          listProperties: async () => {
            throw new VendorUnavailableError('down', {
              provider: 'google',
              operation: 'gsc-sites-list',
            });
          },
        }),
        logger,
      }),
    );
    testApp.use(
      (
        err: unknown,
        _req: unknown,
        res: { status: (n: number) => { json: (b: unknown) => void } },
        _next: unknown,
      ) => {
        const e = err as HttpError;
        res.status(e.status ?? 500).json({ error: e.message });
      },
    );

    // POST /connect/complete exercises deps.logger passthrough into upsertConnection (line 32 branch).
    const completeRes = await request(testApp)
      .post(siteGooglePath(String(site._id), '/connect/complete'))
      .send({
        refreshToken: 'r2',
        googleAccountEmail: 'x@x.co',
        scopes: [SCOPE_GSC],
      });
    expect(completeRes.status).toBe(201);

    // Live property listing exercises the logger path when Google is unavailable.
    const getRes = await request(testApp).get(
      siteGooglePath(String(site._id), '/search-properties'),
    );
    expect(getRes.status).toBe(500);
  });

  it('POST /search-refresh passes the router logger into runGscSync (deps.logger branch)', async () => {
    const mongoose = (await import('mongoose')).default;
    const { createGoogleConnectionsRouter } = await import(
      './google-connections.routes.js'
    );
    const { default: express } = await import('express');
    const accountId = new mongoose.Types.ObjectId().toString();
    const site = await Site.create({
      accountId,
      url: 'https://example.com',
      domain: 'example.com',
      gscPropertyUrl: 'sc-domain:example.com',
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
    });
    await upsertConnection({
      accountId,
      googleAccountEmail: 'x@x.co',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as { user?: { id: string } }).user = { id: accountId };
      next();
    });
    testApp.use(
      '/api/sites/:siteId/google',
      createGoogleConnectionsRouter({ gscProvider: createFakeGscProvider(), logger }),
    );
    testApp.use(
      (
        err: unknown,
        _req: unknown,
        res: { status: (n: number) => { json: (b: unknown) => void } },
        _next: unknown,
      ) => {
        const e = err as HttpError;
        res.status(e.status ?? 500).json({ error: { message: e.message } });
      },
    );
    const res = await request(testApp)
      .post(siteGooglePath(String(site._id), '/search-refresh'))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.summary.topQueries.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Vendor-response archiving (generic vendor layer) — GSC is ARCHIVE-ONLY:
// per-account private data, never written to the cross-user vendor_cache.
// ---------------------------------------------------------------------------

describe('gsc vendor-response archiving', () => {
  type ArchiveCall = {
    capability: string;
    operation: string;
    params: Record<string, unknown>;
    payload: unknown;
    accountId: string;
    fetchedAt: Date;
  };

  function recordingArchive() {
    const calls: ArchiveCall[] = [];
    const archive = async (input: ArchiveCall): Promise<void> => {
      calls.push(input);
    };
    return { archive, calls };
  }

  it('collectIndexStatus archives every successful inspection with the owning accountId', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    const { archive, calls } = recordingArchive();
    const collect = createCollectIndexStatus(makeGscProvider(), logger, archive);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com/', 'https://example.com/pricing'],
    });
    expect(out.status).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.capability).toBe('gsc');
    expect(calls[0]?.operation).toBe('inspect-url');
    expect(calls[0]?.accountId).toBe(user.id);
    expect(calls[0]?.params).toEqual({
      accountId: user.id,
      siteUrl: 'sc-domain:example.com',
      inspectionUrl: 'https://example.com/',
    });
    expect(calls[1]?.params.inspectionUrl).toBe('https://example.com/pricing');
  });

  it('failed inspections archive nothing', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    const { archive, calls } = recordingArchive();
    const provider = makeGscProvider({
      inspectUrl: async () => {
        throw new VendorUnavailableError('down', {
          provider: 'google',
          operation: 'gsc-url-inspect',
        });
      },
    });
    const collect = createCollectIndexStatus(provider, logger, archive);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com/'],
    });
    expect(out.status).toBe('ok'); // per-URL failure degrades the sample, not the run
    expect(calls).toHaveLength(0);
  });

  it('an archive failure never breaks the never-throws collect contract', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await bindGscSite(user.id, user.siteId);
    const failingArchive = async (): Promise<void> => {
      throw new Error('postgres down');
    };
    const collect = createCollectIndexStatus(makeGscProvider(), logger, failingArchive);
    const out = await collect({
      accountId: user.id,
      siteId: user.siteId,
      domain: 'example.com',
      urls: ['https://example.com/'],
    });
    // The inspection itself still lands as a sample.
    expect(out.status).toBe('ok');
    expect(out.samples).toHaveLength(1);
  });

  it('inspectUrlFor archives the inspection when an archiver is provided', async () => {
    const user = await seedUser();
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const { archive, calls } = recordingArchive();
    const { inspectUrlFor } = await import('./google-connections.service.js');
    const out = await inspectUrlFor(
      {
        accountId: user.id,
        siteUrl: 'sc-domain:example.com',
        inspectionUrl: 'https://example.com/page',
      },
      makeGscProvider(),
      logger,
      archive,
    );
    expect(out.indexVerdict).toBe('PASS');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.operation).toBe('inspect-url');
    expect(calls[0]?.accountId).toBe(user.id);
    expect(calls[0]?.payload).toBe(out);
  });
});

describe('clearPlaintextRefreshToken — error swallowing', () => {
  it('logs and swallows a Postgres failure so the Mongo-side connection still succeeds', async () => {
    const user = await seedUser('clear-err@x.co');
    const { account: accountTable } = await import('../../db/schema/auth.js');
    await getTestDb().insert(accountTable).values({
      id: 'acc-clear-err',
      accountId: 'google-clear-err',
      providerId: 'google',
      userId: user.id,
      refreshToken: 'tok',
      scope: SCOPE_GSC,
    });

    // Swap in a DB whose update() rejects — simulates a transient Postgres
    // hiccup right after the encrypted envelope already landed in Mongo.
    const throwingDb = {
      ...getTestDb(),
      update: () => {
        throw new Error('connection terminated');
      },
    };
    setGoogleConnectionsDb(throwingDb as unknown as never);

    // Must not throw — the plaintext-clearance is best-effort.
    await expect(
      clearPlaintextRefreshToken(user.id, logger),
    ).resolves.toBeUndefined();

    // Restore the real DB so the suite teardown is clean.
    setGoogleConnectionsDb(getTestDb() as unknown as never);
  });
});

// ---------------------------------------------------------------------------
// createCollectGscInsights (prompt 24)
// ---------------------------------------------------------------------------

const FIXED_NOW = () => new Date('2026-07-07T12:00:00.000Z');
// endDate = now - 3 days; startDate = endDate - 27 days (28-day window).
const EXPECTED_END = '2026-07-04';
const EXPECTED_START = '2026-06-07';
// Range-window starts (same lag-adjusted end): 7d and 90d fetches.
const EXPECTED_START_7 = '2026-06-28';
const EXPECTED_START_90 = '2026-04-06';
/** The (dimension, window) fetch plan: date once at 90d, aggregates ×3 windows.
 * `query,page` (prompt 04) is an aggregate set like the rest — its addition
 * must not disturb the order or the windows of the five historical sets. */
const EXPECTED_PLAN: Array<[string, number]> = [
  ['date', 90],
  ['query', 7],
  ['query', 28],
  ['query', 90],
  ['page', 7],
  ['page', 28],
  ['page', 90],
  ['country', 7],
  ['country', 28],
  ['country', 90],
  ['device', 7],
  ['device', 28],
  ['device', 90],
  ['query,page', 7],
  ['query,page', 28],
  ['query,page', 90],
];

function saRows(
  ...rows: Array<[string, number, number, number, number]>
): GscSearchAnalyticsRow[] {
  return rows.map(([key, clicks, impressions, ctr, position]) => ({
    keys: [key],
    clicks,
    impressions,
    ctr,
    position,
  }));
}

function healthySitemap(path = 'https://example.com/sitemap.xml'): GscSitemapEntry {
  return {
    path,
    type: 'sitemap',
    lastSubmitted: new Date('2026-06-20T09:12:00.000Z'),
    lastDownloaded: new Date('2026-07-01T04:30:00.000Z'),
    isPending: false,
    isSitemapsIndex: false,
    errors: 0,
    warnings: 0,
    processed: 128,
  };
}

interface RecordedPersistence extends GscInsightsPersistence {
  searchCalls: Array<{
    siteId: string;
    accountId: string;
    snapshotDate: string;
    dimensionSet: string;
    windowDays?: number;
    rows: readonly GscSearchAnalyticsRow[];
  }>;
  sitemapCalls: Array<{
    siteId: string;
    accountId: string;
    snapshotDate: string;
    entries: readonly GscSitemapEntry[];
  }>;
}

function makePersistence(
  overrides: Partial<GscInsightsPersistence> = {},
): RecordedPersistence {
  const recorder: RecordedPersistence = {
    searchCalls: [],
    sitemapCalls: [],
    async upsertSearchAnalytics(input) {
      recorder.searchCalls.push(input);
    },
    async upsertSitemaps(input) {
      recorder.sitemapCalls.push(input);
    },
    async readPreviousTotals() {
      return null;
    },
    ...overrides,
  };
  return recorder;
}

const SITE_ID = 'cccccccccccccccccccccccc';

async function seedConnectedUser(): Promise<GoogleTestUser> {
  const user = await seedUser();
  await upsertConnection({
    accountId: user.id,
    googleAccountEmail: 'user@example.com',
    refreshToken: 'r',
    scopes: [SCOPE_GSC],
  });
  await Site.create({
    _id: SITE_ID,
    accountId: user.id,
    url: 'https://example.com',
    domain: 'example.com',
    displayName: 'Collector test site',
    gscPropertyUrl: 'sc-domain:example.com',
    gscBindingGenerationId: 'legacy',
    gscBindingSource: 'legacy',
  });
  return user;
}

/**
 * A real Postgres persist seam (via the gsc-snapshots writers) so `runGscSync`
 * rows actually land and can be read back — the same shape the controller
 * builds for `POST /search-refresh`.
 */
function pgPersist(): GscInsightsPersistence {
  const db = getTestDb() as never;
  return {
    upsertSearchAnalytics: (input) => upsertSearchAnalytics(db, input),
    upsertSitemaps: (input) => upsertSitemaps(db, input),
    readPreviousTotals: async (siteId, beforeDate) => {
      const totals = await readPreviousSnapshotTotals(db, siteId, 'query', beforeDate);
      return totals ? { clicks: totals.clicks, impressions: totals.impressions } : null;
    },
  };
}

describe('createCollectGscInsights', () => {
  it('happy path: weighted aggregates, top-5 truncation, persistence, sitemaps', async () => {
    const user = await seedConnectedUser();
    const queryRows = saRows(
      ['q1', 10, 1000, 0.01, 5],
      ['q2', 30, 3000, 0.01, 10],
      ['q3', 5, 100, 0.05, 2],
      ['q4', 4, 80, 0.05, 3],
      ['q5', 3, 60, 0.05, 4],
      ['q6', 2, 40, 0.05, 6],
    );
    const pageRows = saRows(
      ['https://example.com/', 20, 2000, 0.01, 4],
      ['https://example.com/pricing', 8, 400, 0.02, 6],
    );
    const provider = makeGscProvider({
      querySearchAnalytics: async (_c, input) => ({
        rows: input.dimensions[0] === 'query' ? queryRows : pageRows,
        sampled: true,
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
      }),
      listSitemaps: async () => [
        healthySitemap(),
        { ...healthySitemap('https://example.com/broken.xml'), errors: 2, warnings: 1 },
      ],
    });
    const persist = makePersistence();
    const collect = createCollectGscInsights(provider, {
      logger,
      persist,
      now: FIXED_NOW,
    });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });

    expect(out.search.status).toBe('ok');
    expect(out.search.totalClicks).toBe(54);
    expect(out.search.totalImpressions).toBe(4280);
    // Weighted: sum(ctr*impr)/sum(impr), sum(pos*impr)/sum(impr).
    expect(out.search.averageCtr).toBeCloseTo(54 / 4280, 10);
    expect(out.search.averagePosition).toBeCloseTo(
      (5 * 1000 + 10 * 3000 + 2 * 100 + 3 * 80 + 4 * 60 + 6 * 40) / 4280,
      10,
    );
    // Top 5 by clicks — q6 truncated.
    expect(out.search.topQueries.map((q) => q.query)).toEqual([
      'q2',
      'q1',
      'q3',
      'q4',
      'q5',
    ]);
    expect(out.search.topPages.map((p) => p.url)).toEqual([
      'https://example.com/',
      'https://example.com/pricing',
    ]);
    // First run — no previous snapshot.
    expect(out.search.delta).toEqual({ clicks: null, impressions: null });

    expect(out.sitemaps.status).toBe('ok');
    expect(out.sitemaps.sitemaps).toHaveLength(2);
    expect(out.sitemaps.sitemaps[1]).toMatchObject({
      path: 'https://example.com/broken.xml',
      errors: 2,
      warnings: 1,
    });

    // Postgres persistence: every (dimension set, window) + the sitemap
    // snapshot — date once at 90d, the five aggregates at 7/28/90.
    expect(persist.searchCalls).toHaveLength(16);
    expect(
      persist.searchCalls.map((c) => [c.dimensionSet, c.windowDays]),
    ).toEqual(EXPECTED_PLAN);
    expect(
      persist.searchCalls.find(
        (c) => c.dimensionSet === 'query' && c.windowDays === 28,
      ),
    ).toMatchObject({
      siteId: SITE_ID,
      accountId: user.id,
      snapshotDate: EXPECTED_END,
      dimensionSet: 'query',
    });
    expect(persist.sitemapCalls).toHaveLength(1);
    expect(persist.sitemapCalls[0]).toMatchObject({
      siteId: SITE_ID,
      snapshotDate: EXPECTED_END,
    });
  });

  it('a row with an empty keys[] aggregates under an empty label', async () => {
    const user = await seedConnectedUser();
    const provider = makeGscProvider({
      querySearchAnalytics: async (_c, input) => ({
        rows:
          input.dimensions[0] === 'query'
            ? [{ keys: [], clicks: 7, impressions: 700, ctr: 0.01, position: 3.3 }]
            : [],
        sampled: true,
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
      }),
    });
    const collect = createCollectGscInsights(provider, { logger, now: FIXED_NOW });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('ok');
    expect(out.search.topQueries).toEqual([
      { query: '', clicks: 7, impressions: 700, ctr: 0.01, position: 3.3 },
    ]);
  });

  it('queries the lag-adjusted 28-day window', async () => {
    const user = await seedConnectedUser();
    const seen: Array<{ startDate: string; endDate: string; dimensions: string[] }> =
      [];
    const provider = makeGscProvider({
      querySearchAnalytics: async (_c, input) => {
        seen.push({
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions: input.dimensions,
        });
        return {
          rows: [],
          sampled: true,
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions: input.dimensions,
        };
      },
    });
    const collect = createCollectGscInsights(provider, { logger, now: FIXED_NOW });
    await collect({ accountId: user.id, siteId: SITE_ID, domain: 'example.com' });
    // Every (dimension, window) pair is queried over the same lag-adjusted
    // end date, in the canonical plan order: date once at 90d, then each
    // aggregate dimension at 7/28/90.
    const startFor = (windowDays: number) =>
      windowDays === 7
        ? EXPECTED_START_7
        : windowDays === 90
          ? EXPECTED_START_90
          : EXPECTED_START;
    expect(seen).toEqual(
      EXPECTED_PLAN.map(([dimension, windowDays]) => ({
        startDate: startFor(windowDays),
        endDate: EXPECTED_END,
        // A comma-joined dimension SET is split into its vendor keys.
        dimensions: dimension.split(','),
      })),
    );
  });

  it('computes the delta against the previous snapshot totals', async () => {
    const user = await seedConnectedUser();
    const provider = makeGscProvider({
      querySearchAnalytics: async (_c, input) => ({
        rows: input.dimensions[0] === 'query' ? saRows(['q', 50, 5000, 0.01, 5]) : [],
        sampled: true,
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
      }),
    });
    const persist = makePersistence({
      readPreviousTotals: async (siteId, beforeDate) => {
        expect(siteId).toBe(SITE_ID);
        expect(beforeDate).toBe(EXPECTED_END);
        return { clicks: 42, impressions: 4200 };
      },
    });
    const collect = createCollectGscInsights(provider, {
      logger,
      persist,
      now: FIXED_NOW,
    });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.delta).toEqual({ clicks: 8, impressions: 800 });
  });

  it('previous-totals read failure degrades the delta only, not the section', async () => {
    const user = await seedConnectedUser();
    const persist = makePersistence({
      readPreviousTotals: async () => {
        throw new Error('pg down');
      },
    });
    const collect = createCollectGscInsights(makeGscProvider(), {
      logger,
      persist,
      now: FIXED_NOW,
    });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('ok');
    expect(out.search.delta).toEqual({ clicks: null, impressions: null });
  });

  it('no persistence wiring → delta null, sections still collected', async () => {
    const user = await seedConnectedUser();
    const collect = createCollectGscInsights(makeGscProvider(), {
      logger,
      now: FIXED_NOW,
    });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('ok');
    expect(out.search.delta).toEqual({ clicks: null, impressions: null });
    expect(out.sitemaps.status).toBe('ok');
  });

  it('zero rows on both dimensions → no-data; zero sitemaps → no-sitemaps', async () => {
    const user = await seedConnectedUser();
    const provider = makeGscProvider({
      querySearchAnalytics: async (_c, input) => ({
        rows: [],
        sampled: true,
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
      }),
      listSitemaps: async () => [],
    });
    const collect = createCollectGscInsights(provider, { logger, now: FIXED_NOW });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('no-data');
    expect(out.search.totalClicks).toBe(0);
    expect(out.search.averageCtr).toBe(0);
    expect(out.sitemaps.status).toBe('no-sitemaps');
  });

  it('not-connected when there is no connection row', async () => {
    const user = await seedUser();
    const collect = createCollectGscInsights(makeGscProvider(), {
      logger,
      now: FIXED_NOW,
    });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('not-connected');
    expect(out.sitemaps.status).toBe('not-connected');
  });

  it('needs-reconnect when the stored connection is flagged', async () => {
    const user = await seedConnectedUser();
    await markNeedsReconnect(user.id);
    const collect = createCollectGscInsights(makeGscProvider(), {
      logger,
      now: FIXED_NOW,
    });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('needs-reconnect');
    expect(out.sitemaps.status).toBe('needs-reconnect');
  });

  it('search-analytics invalid_grant marks the connection and skips sitemaps', async () => {
    const user = await seedConnectedUser();
    const listSitemapsSpy = vi.fn();
    const provider = makeGscProvider({
      querySearchAnalytics: async () => {
        throw new GscReconnectRequiredError('dead', {
          provider: 'google',
          operation: 'gsc-search-analytics',
        });
      },
      listSitemaps: listSitemapsSpy,
    });
    const collect = createCollectGscInsights(provider, { logger, now: FIXED_NOW });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('needs-reconnect');
    expect(out.sitemaps.status).toBe('needs-reconnect');
    expect(listSitemapsSpy).not.toHaveBeenCalled();
    const doc = await getConnection(user.id);
    expect(doc?.status).toBe('needs_reconnect');
  });

  it('search-analytics vendor failure degrades search only — sitemaps still collected', async () => {
    const user = await seedConnectedUser();
    const provider = makeGscProvider({
      querySearchAnalytics: async () => {
        throw new VendorQuotaError('quota', {
          provider: 'google',
          operation: 'gsc-search-analytics',
        });
      },
    });
    const collect = createCollectGscInsights(provider, { logger, now: FIXED_NOW });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('unavailable');
    expect(out.sitemaps.status).toBe('ok');
  });

  it('sitemaps vendor failure degrades sitemaps only — search stays ok', async () => {
    const user = await seedConnectedUser();
    const provider = makeGscProvider({
      listSitemaps: async () => {
        throw new VendorUnavailableError('down', {
          provider: 'google',
          operation: 'gsc-sitemaps-list',
        });
      },
    });
    const collect = createCollectGscInsights(provider, { logger, now: FIXED_NOW });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('ok');
    expect(out.sitemaps.status).toBe('unavailable');
  });

  it('sitemaps invalid_grant marks the connection needs_reconnect', async () => {
    const user = await seedConnectedUser();
    const provider = makeGscProvider({
      listSitemaps: async () => {
        throw new GscReconnectRequiredError('dead', {
          provider: 'google',
          operation: 'gsc-sitemaps-list',
        });
      },
    });
    const collect = createCollectGscInsights(provider, { logger, now: FIXED_NOW });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('ok');
    expect(out.sitemaps.status).toBe('needs-reconnect');
    const doc = await getConnection(user.id);
    expect(doc?.status).toBe('needs_reconnect');
  });

  it('search persistence failure degrades the section and wipes all dimension sets', async () => {
    const user = await seedConnectedUser();
    const wipes: Array<{ dimensionSet: string; rows: number }> = [];
    let failFirst = true;
    const persist = makePersistence({
      upsertSearchAnalytics: async (input) => {
        if (failFirst) {
          failFirst = false;
          throw new Error('pg write failed');
        }
        wipes.push({ dimensionSet: input.dimensionSet, rows: input.rows.length });
      },
    });
    const collect = createCollectGscInsights(makeGscProvider(), {
      logger,
      persist,
      now: FIXED_NOW,
    });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('unavailable');
    expect(out.search.topQueries).toEqual([]);
    // Every (dimension set, window) wiped with empty row sets.
    expect(wipes).toEqual(
      EXPECTED_PLAN.map(([dimensionSet]) => ({ dimensionSet, rows: 0 })),
    );
    // Sitemaps untouched by the search failure.
    expect(out.sitemaps.status).toBe('ok');
  });

  it('wipe failures after a persistence failure are swallowed', async () => {
    const user = await seedConnectedUser();
    const persist = makePersistence({
      upsertSearchAnalytics: async () => {
        throw new Error('pg down hard');
      },
    });
    const collect = createCollectGscInsights(makeGscProvider(), {
      logger,
      persist,
      now: FIXED_NOW,
    });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('unavailable');
    expect(out.sitemaps.status).toBe('ok');
  });

  it('sitemap persistence failure degrades the sitemaps section only', async () => {
    const user = await seedConnectedUser();
    const persist = makePersistence({
      upsertSitemaps: async () => {
        throw new Error('pg write failed');
      },
    });
    const collect = createCollectGscInsights(makeGscProvider(), {
      logger,
      persist,
      now: FIXED_NOW,
    });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('ok');
    expect(out.sitemaps.status).toBe('unavailable');
  });

  it('archives both payloads; archive failure never breaks collection', async () => {
    const user = await seedConnectedUser();
    const archived: string[] = [];
    const collectOk = createCollectGscInsights(makeGscProvider(), {
      logger,
      archive: async (input) => {
        archived.push(input.operation);
      },
      now: FIXED_NOW,
    });
    await collectOk({ accountId: user.id, siteId: SITE_ID, domain: 'example.com' });
    expect(archived).toEqual(['search-analytics', 'list-sitemaps']);

    const collectFailingArchive = createCollectGscInsights(makeGscProvider(), {
      logger,
      archive: async () => {
        throw new Error('archive down');
      },
      now: FIXED_NOW,
    });
    const out = await collectFailingArchive({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('ok');
    expect(out.sitemaps.status).toBe('ok');
  });

  it('defaults the clock to the real one when `now` is omitted', async () => {
    const user = await seedConnectedUser();
    const seen: string[] = [];
    const provider = makeGscProvider({
      querySearchAnalytics: async (_c, input) => {
        seen.push(input.endDate);
        return {
          rows: [],
          sampled: true,
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions: input.dimensions,
        };
      },
    });
    const collect = createCollectGscInsights(provider, { logger });
    await collect({ accountId: user.id, siteId: SITE_ID, domain: 'example.com' });
    // endDate is a valid ISO date ~3 days in the past.
    expect(seen[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('runs without a logger (optional-dep spreads through both helpers)', async () => {
    const user = await seedConnectedUser();
    const collect = createCollectGscInsights(makeGscProvider(), { now: FIXED_NOW });
    const out = await collect({
      accountId: user.id,
      siteId: SITE_ID,
      domain: 'example.com',
    });
    expect(out.search.status).toBe('ok');
    expect(out.sitemaps.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// GET /api/sites/:siteId/google/search-summary (prompt 24)
// ---------------------------------------------------------------------------

describe('GET /api/sites/:siteId/google/search-summary', () => {
  async function seedSite(accountId: string, domain = 'example.com') {
    const site = await Site.create({
      accountId,
      url: `https://${domain}`,
      domain,
      gscPropertyUrl: `sc-domain:${domain}`,
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
    });
    return site.id as string;
  }

  async function seedSnapshot(
    siteId: string,
    accountId: string,
    snapshotDate: string,
    rows: Array<[string, number, number]>,
    dimensionSet = 'query',
    bindingGenerationId = 'legacy',
  ) {
    await upsertSearchAnalytics(getTestDb() as never, {
      siteId,
      accountId,
      bindingGenerationId,
      snapshotDate,
      dimensionSet,
      rows: rows.map(([key, clicks, impressions]) => ({
        keys: [key],
        clicks,
        impressions,
        ctr: impressions === 0 ? 0 : clicks / impressions,
        position: 5.0,
      })),
    });
  }

  it('401 without a session', async () => {
    const res = await request(app).get(
      '/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/google/search-summary',
    );
    expect(res.status).toBe(401);
  });

  it('400 on a malformed siteId', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get('/api/sites/not-hex/google/search-summary')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('404 when the site does not exist for the caller', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get('/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/google/search-summary')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

  it('cross-account: user B never reads user A data (404, not 403)', async () => {
    const owner = await seedUser('sum-owner@x.co');
    const stranger = await seedUser('sum-stranger@x.co');
    const siteId = await seedSite(owner.id);
    await upsertConnection({
      accountId: owner.id,
      googleAccountEmail: 'owner@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await seedSnapshot(siteId, owner.id, '2026-07-04', [['seo audit', 10, 1000]]);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
  });

  it('404 noDataYet when connected but no snapshot has been written yet', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
  });

  it('keeps old history but hides it after the Site switches binding generations', async () => {
    const user = await seedUser('generation-switch@x.co');
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await seedSnapshot(siteId, user.id, '2026-07-04', [['old-resource', 40, 400]]);

    const beforeSwitch = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(beforeSwitch.status).toBe(200);
    expect(beforeSwitch.body.summary.topQueries[0].query).toBe('old-resource');

    setGoogleGscProvider(
      makeGscProvider({
        listProperties: async () => [
          { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://another.example/', permissionLevel: 'siteOwner' },
        ],
      }),
    );
    await request(app)
      .patch(`/api/sites/${siteId}/google/bindings`)
      .set('Cookie', user.cookie)
      .send({ gscPropertyUrl: 'https://another.example/' })
      .expect(200);

    const reboundSite = await Site.findById(siteId);
    const currentGeneration = reboundSite?.gscBindingGenerationId;
    expect(currentGeneration).toEqual(expect.any(String));
    expect(currentGeneration).not.toBe('legacy');
    expect(
      await readLatestSnapshotDate(
        getTestDb() as never,
        siteId,
        'query',
        28,
        'legacy',
      ),
    ).toBe('2026-07-04');

    const withoutCurrentHistory = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(withoutCurrentHistory.status).toBe(404);

    await seedSnapshot(
      siteId,
      user.id,
      '2026-07-05',
      [['new-resource', 9, 90]],
      'query',
      currentGeneration!,
    );
    const afterCurrentSync = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(afterCurrentSync.status).toBe(200);
    expect(afterCurrentSync.body.summary.topQueries[0].query).toBe('new-resource');
  });

  it('404 noDataYet when there is no connection at all', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
  });

  it('404 with reconnect copy when the connection needs reconnecting', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await markNeedsReconnect(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/reconnect/i);
  });

  it('200 with the latest snapshot summary — totals, top lists, asOf, null previousPeriod', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await seedSnapshot(siteId, user.id, '2026-07-04', [
      ['q-top', 30, 3000],
      ['q-second', 10, 1000],
      ['q3', 5, 500],
      ['q4', 4, 400],
      ['q5', 3, 300],
      ['q6-truncated', 1, 100],
    ]);
    await seedSnapshot(
      siteId,
      user.id,
      '2026-07-04',
      [['https://example.com/', 25, 2500]],
      'page',
    );
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    const summary = res.body.summary as {
      totalClicks: number;
      totalImpressions: number;
      averageCtr: number;
      averagePosition: number;
      topQueries: Array<{ query: string }>;
      topPages: Array<{ url: string }>;
      asOf: string;
      previousPeriod: unknown;
    };
    expect(summary.totalClicks).toBe(53);
    expect(summary.totalImpressions).toBe(5300);
    expect(summary.averageCtr).toBeCloseTo(53 / 5300, 10);
    expect(summary.averagePosition).toBeCloseTo(5.0, 10);
    expect(summary.topQueries.map((q) => q.query)).toEqual([
      'q-top',
      'q-second',
      'q3',
      'q4',
      'q5',
    ]);
    expect(summary.topPages.map((p) => p.url)).toEqual(['https://example.com/']);
    expect(summary.asOf).toBe('2026-07-04');
    expect(summary.previousPeriod).toBeNull();
  });

  it('200 includes previousPeriod totals when an older snapshot exists', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await seedSnapshot(siteId, user.id, '2026-06-06', [['old', 40, 4000]]);
    await seedSnapshot(siteId, user.id, '2026-07-04', [['new', 50, 5000]]);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary.asOf).toBe('2026-07-04');
    expect(res.body.summary.previousPeriod).toEqual({
      totalClicks: 40,
      totalImpressions: 4000,
    });
  });

  it('zero-impression snapshot yields zero averages (no NaN)', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await seedSnapshot(siteId, user.id, '2026-07-04', [['quiet', 0, 0]]);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary.averageCtr).toBe(0);
    expect(res.body.summary.averagePosition).toBe(0);
    expect(res.body.summary.topPages).toEqual([]);
  });

  it('surfaces the date/country/device breakdowns: timeseries ASC by date, countries top-10 clicks-DESC, devices all', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await seedSnapshot(siteId, user.id, '2026-07-04', [['q', 10, 1000]]);
    // Dates seeded OUT of order so the ascending re-sort is proven.
    await seedSnapshot(
      siteId,
      user.id,
      '2026-07-04',
      [
        ['2026-06-09', 9, 300],
        ['2026-06-07', 12, 400],
        ['2026-06-08', 18, 520],
      ],
      'date',
    );
    // 12 countries — the reader returns clicks-DESC; the summary slices top-10.
    await seedSnapshot(
      siteId,
      user.id,
      '2026-07-04',
      Array.from({ length: 12 }, (_, i) => [`c${i}`, (12 - i) * 10, 1000] as [string, number, number]),
      'country',
    );
    await seedSnapshot(
      siteId,
      user.id,
      '2026-07-04',
      [
        ['DESKTOP', 120, 3800],
        ['MOBILE', 90, 3400],
        ['TABLET', 6, 240],
      ],
      'device',
    );
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    const summary = res.body.summary as {
      timeseries: Array<{ date: string; clicks: number }>;
      countries: Array<{ country: string; clicks: number }>;
      devices: Array<{ device: string }>;
      // pre-existing fields still present alongside the breakdowns
      totalClicks: number;
      topQueries: Array<{ query: string }>;
      asOf: string;
    };
    // Ascending by date regardless of the clicks-DESC read order.
    expect(summary.timeseries.map((t) => t.date)).toEqual([
      '2026-06-07',
      '2026-06-08',
      '2026-06-09',
    ]);
    // Top-10 only, ordered by clicks DESC (c0 highest → c9).
    expect(summary.countries).toHaveLength(10);
    expect(summary.countries[0]?.country).toBe('c0');
    expect(summary.countries.map((c) => c.clicks)).toEqual([
      120, 110, 100, 90, 80, 70, 60, 50, 40, 30,
    ]);
    expect(summary.devices.map((d) => d.device)).toEqual(['DESKTOP', 'MOBILE', 'TABLET']);
    // Pre-existing query summary still resolves.
    expect(summary.totalClicks).toBe(10);
    expect(summary.topQueries.map((q) => q.query)).toEqual(['q']);
    expect(summary.asOf).toBe('2026-07-04');
  });

  it('breakdown arrays are empty (no throw) when only query/page rows exist', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await seedSnapshot(siteId, user.id, '2026-07-04', [['q', 10, 1000]]);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary.timeseries).toEqual([]);
    expect(res.body.summary.countries).toEqual([]);
    expect(res.body.summary.devices).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runGscSync (prompt 24) — on-demand / queue-driven five-dimension sync
// ---------------------------------------------------------------------------

describe('runGscSync', () => {
  const ZERO = { date: 0, query: 0, page: 0, country: 0, device: 0, 'query,page': 0 };

  it('ok: persists all six dimension sets + sitemaps and reports per-dimension counts', async () => {
    const user = await seedConnectedUser();
    // The fake serves distinct per-dimension rows; query/page fall back to the
    // 3-row default so the run stays `ok`.
    const provider = createFakeGscProvider({
      searchAnalyticsByDimension: {
        date: FAKE_GSC_SEARCH_ANALYTICS_DATE,
        country: FAKE_GSC_SEARCH_ANALYTICS_COUNTRY,
        device: FAKE_GSC_SEARCH_ANALYTICS_DEVICE,
      },
    });
    const deps: GscSyncDeps = {
      gscProvider: provider,
      persist: pgPersist(),
      logger,
      now: FIXED_NOW,
    };
    const result = await runGscSync(user.id, SITE_ID, 'example.com', deps);
    expect(result.status).toBe('ok');
    expect(result.snapshotDate).toBe(EXPECTED_END);
    expect(result.counts).toEqual({
      date: 3,
      query: 3,
      page: 3,
      country: 2,
      device: 3,
      // Prompt 04 — the fake's default `query,page` fixture (5 rows).
      'query,page': 5,
    });
    expect(result.sitemaps).toBe(2);

    // Rows actually landed through the real writer and read back per dimension.
    const db = getTestDb() as never;
    expect(await readLatestSnapshotDate(db, SITE_ID, 'query')).toBe(EXPECTED_END);
    const deviceRows = await readSearchAnalytics(db, SITE_ID, 'device', {
      since: EXPECTED_END,
      until: EXPECTED_END,
    });
    expect(deviceRows.map((r) => r.dimensionKey).sort()).toEqual([
      'DESKTOP',
      'MOBILE',
      'TABLET',
    ]);
    // The daily series lands once at the widest window (90d).
    const dateRows = await readSearchAnalytics(
      db,
      SITE_ID,
      'date',
      { since: EXPECTED_END, until: EXPECTED_END },
      90,
    );
    expect(dateRows).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Prompt 04 — the `query,page` producer + backward compatibility
  // -------------------------------------------------------------------------

  it('persists capped, separator-joined query,page rows the inventory reader can read back', async () => {
    const user = await seedConnectedUser();
    const requested: Array<{ dimensions: string[]; rowLimit: number }> = [];
    const provider = createFakeGscProvider({});
    const spied: GoogleGscProvider = {
      ...provider,
      querySearchAnalytics: async (connection, input) => {
        requested.push({
          dimensions: [...input.dimensions],
          rowLimit: input.rowLimit ?? 0,
        });
        return provider.querySearchAnalytics(connection, input);
      },
    };
    const result = await runGscSync(user.id, SITE_ID, 'example.com', {
      gscProvider: spied,
      persist: pgPersist(),
      logger,
      now: FIXED_NOW,
    });
    expect(result.status).toBe('ok');
    expect(result.counts['query,page']).toBe(5);

    // The comma-joined SET is split back into the two vendor dimension keys,
    // and it takes the bounded 1000-row cap (not the 25k default).
    const queryPageRequests = requested.filter(
      (r) => r.dimensions.length === 2,
    );
    expect(queryPageRequests).toHaveLength(3);
    for (const req of queryPageRequests) {
      expect(req.dimensions).toEqual(['query', 'page']);
      expect(req.rowLimit).toBe(1000);
    }
    // Backward compatibility: the five historical sets still request exactly
    // one dimension each, at their historical caps.
    for (const req of requested.filter((r) => r.dimensions.length === 1)) {
      const [dimension] = req.dimensions;
      expect(req.rowLimit).toBe(
        dimension === 'query' || dimension === 'page' ? 1000 : 25_000,
      );
    }

    const db = getTestDb() as never;
    const rows = await readSearchAnalytics(db, SITE_ID, 'query,page', {
      since: EXPECTED_END,
      until: EXPECTED_END,
    });
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.dimensionKey).toContain(GSC_DIMENSION_KEY_SEPARATOR);
    }
    // The shipped content-inventory evidence loader now finds rows where it
    // previously found none.
    const evidence = await loadInventoryEvidence(db, { siteId: SITE_ID });
    expect(evidence.gscByUrl.size).toBe(5);
  });

  it('re-syncing the same day replaces the query,page snapshot instead of duplicating it', async () => {
    const user = await seedConnectedUser();
    const deps: GscSyncDeps = {
      gscProvider: createFakeGscProvider({}),
      persist: pgPersist(),
      logger,
      now: FIXED_NOW,
    };
    await runGscSync(user.id, SITE_ID, 'example.com', deps);
    await runGscSync(user.id, SITE_ID, 'example.com', deps);
    const db = getTestDb() as never;
    const rows = await readSearchAnalytics(db, SITE_ID, 'query,page', {
      since: EXPECTED_END,
      until: EXPECTED_END,
    });
    expect(rows).toHaveLength(5);
    // Every historical set is equally un-duplicated.
    const queryRows = await readSearchAnalytics(db, SITE_ID, 'query', {
      since: EXPECTED_END,
      until: EXPECTED_END,
    });
    expect(queryRows).toHaveLength(3);
  });

  it('not-connected: no connection row → zero counts, null snapshot, no writes', async () => {
    const user = await seedUser();
    const persist = makePersistence();
    const result = await runGscSync(user.id, SITE_ID, 'example.com', {
      gscProvider: makeGscProvider(),
      persist,
      logger,
      now: FIXED_NOW,
    });
    expect(result.status).toBe('not-connected');
    expect(result.snapshotDate).toBeNull();
    expect(result.counts).toEqual(ZERO);
    expect(result.sitemaps).toBe(0);
    expect(persist.searchCalls).toHaveLength(0);
    expect(persist.sitemapCalls).toHaveLength(0);
  });

  it('needs-reconnect: a dead refresh token zeroes the run and marks the connection', async () => {
    const user = await seedConnectedUser();
    const provider = makeGscProvider({
      refresh: async () => {
        throw new GscReconnectRequiredError('invalid_grant', {
          provider: 'google',
          operation: 'gsc-token-refresh',
        });
      },
    });
    const persist = makePersistence();
    const result = await runGscSync(user.id, SITE_ID, 'example.com', {
      gscProvider: provider,
      persist,
      logger,
      now: FIXED_NOW,
    });
    expect(result.status).toBe('needs-reconnect');
    expect(result.snapshotDate).toBeNull();
    expect(result.counts).toEqual(ZERO);
    expect(persist.searchCalls).toHaveLength(0);
    expect((await getConnection(user.id))?.status).toBe('needs_reconnect');
  });

  it('no-data: all-empty rows → status no-data (snapshot still stamped)', async () => {
    const user = await seedConnectedUser();
    const provider = makeGscProvider({
      querySearchAnalytics: async (_c, input) => ({
        rows: [],
        sampled: true,
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
      }),
    });
    const result = await runGscSync(user.id, SITE_ID, 'example.com', {
      gscProvider: provider,
      persist: makePersistence(),
      logger,
      now: FIXED_NOW,
    });
    expect(result.status).toBe('no-data');
    expect(result.snapshotDate).toBe(EXPECTED_END);
    expect(result.counts).toEqual(ZERO);
  });

  it('unavailable: a persist failure wipes every dimension set and degrades the run', async () => {
    const user = await seedConnectedUser();
    const wipes: Array<{ dimensionSet: string; rows: number }> = [];
    let failFirst = true;
    const persist = makePersistence({
      upsertSearchAnalytics: async (input) => {
        if (failFirst) {
          failFirst = false;
          throw new Error('pg write failed');
        }
        wipes.push({ dimensionSet: input.dimensionSet, rows: input.rows.length });
      },
    });
    const result = await runGscSync(user.id, SITE_ID, 'example.com', {
      gscProvider: makeGscProvider(),
      persist,
      logger,
      now: FIXED_NOW,
    });
    expect(result.status).toBe('unavailable');
    expect(result.snapshotDate).toBeNull();
    expect(result.counts).toEqual(ZERO);
    expect(result.sitemaps).toBe(0);
    expect(wipes).toEqual(
      EXPECTED_PLAN.map(([dimensionSet]) => ({ dimensionSet, rows: 0 })),
    );
  });

  it('coalesces concurrent syncs for one (account, site) into a single provider round-trip', async () => {
    const user = await seedConnectedUser();
    let calls = 0;
    const provider = makeGscProvider({
      querySearchAnalytics: async (_c, input) => {
        calls += 1;
        return {
          rows: [],
          sampled: true,
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions: input.dimensions,
        };
      },
    });
    const deps: GscSyncDeps = {
      gscProvider: provider,
      persist: makePersistence(),
      logger,
      now: FIXED_NOW,
    };
    const [r1, r2] = await Promise.all([
      runGscSync(user.id, SITE_ID, 'example.com', deps),
      runGscSync(user.id, SITE_ID, 'example.com', deps),
    ]);
    // One shared run: sixteen (dimension, window) fetches, not thirty-two;
    // the SAME result object.
    expect(calls).toBe(16);
    expect(r1).toBe(r2);
    expect(r1.status).toBe('no-data');
  });

  it('runs without a logger (optional-dep branch)', async () => {
    const user = await seedConnectedUser();
    const result = await runGscSync(user.id, SITE_ID, 'example.com', {
      gscProvider: makeGscProvider(),
      persist: makePersistence(),
      now: FIXED_NOW,
    });
    expect(result.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// POST /api/sites/:siteId/google/search-refresh (prompt 24)
// ---------------------------------------------------------------------------

describe('POST /api/sites/:siteId/google/search-refresh', () => {
  async function seedSite(accountId: string, domain = 'example.com'): Promise<string> {
    const site = await Site.create({
      accountId,
      url: `https://${domain}`,
      domain,
      gscPropertyUrl: `sc-domain:${domain}`,
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
    });
    return site.id as string;
  }

  it('401 without a session', async () => {
    const res = await request(app)
      .post(siteGooglePath('aaaaaaaaaaaaaaaaaaaaaaaa', '/search-refresh'))
      .send({});
    expect(res.status).toBe(401);
  });

  it('400 on a malformed siteId before any resource lookup', async () => {
    const user = await seedUser();
    const res = await request(app)
      .post(siteGooglePath('not-hex', '/search-refresh'))
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("cross-account: a stranger refreshing the owner's site 404s (not 403)", async () => {
    const owner = await seedUser('refresh-owner@x.co');
    const stranger = await seedUser('refresh-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const res = await request(app)
      .post(siteGooglePath(siteId, '/search-refresh'))
      .set('Cookie', stranger.cookie)
      .send({});
    expect(res.status).toBe(404);
  });

  it('404 noDataYet when not connected (sync no-ops, summary finds no connection)', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .post(siteGooglePath(siteId, '/search-refresh'))
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
  });

  it('404 with reconnect copy when the connection needs reconnecting', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    await markNeedsReconnect(user.id);
    const res = await request(app)
      .post(siteGooglePath(siteId, '/search-refresh'))
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/reconnect/i);
  });

  it('200 with the freshly-synced summary including timeseries/countries/devices', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    setGoogleGscProvider(
      createFakeGscProvider({
        searchAnalyticsByDimension: {
          date: FAKE_GSC_SEARCH_ANALYTICS_DATE,
          country: FAKE_GSC_SEARCH_ANALYTICS_COUNTRY,
          device: FAKE_GSC_SEARCH_ANALYTICS_DEVICE,
        },
      }),
    );
    // The fake's fixed fixture dates (2026-06-07..09) sit ~30 days behind the
    // lag-adjusted end date of this pinned clock, so they only fall inside the
    // 90-day range.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-12T12:00:00.000Z') });
    try {
      const res = await request(app)
        .post(siteGooglePath(siteId, '/search-refresh'))
        .set('Cookie', user.cookie)
        .send({ range: '90d' });
      expect(res.status).toBe(200);
      const summary = res.body.summary as {
        timeseries: Array<{ date: string }>;
        countries: unknown[];
        devices: Array<{ device: string }>;
        topQueries: unknown[];
      };
      expect(summary.timeseries.map((t) => t.date)).toEqual([
        '2026-06-07',
        '2026-06-08',
        '2026-06-09',
      ]);
      expect(summary.countries).toHaveLength(2);
      expect(summary.devices.map((d) => d.device)).toEqual(['DESKTOP', 'MOBILE', 'TABLET']);
      // query/page fell back to the 3-row default → the query summary is present.
      expect(summary.topQueries.length).toBeGreaterThan(0);

      // Default 28-day range: the same daily rows are correctly sliced OUT of
      // the narrower window (the chart never shows more than its range).
      const short = await request(app)
        .get(`/api/sites/${siteId}/google/search-summary`)
        .set('Cookie', user.cookie);
      expect(short.status).toBe(200);
      expect(short.body.summary.timeseries).toEqual([]);
      expect(short.body.summary.devices).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('404 noDataYet when the sync finds no rows (nothing persisted)', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    setGoogleGscProvider(
      makeGscProvider({
        querySearchAnalytics: async (_c, input) => ({
          rows: [],
          sampled: true,
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions: input.dimensions,
        }),
      }),
    );
    const res = await request(app)
      .post(siteGooglePath(siteId, '/search-refresh'))
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
  });

  it('500 when no GSC provider is wired', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    setGoogleGscProvider(null);
    try {
      const res = await request(app)
        .post(siteGooglePath(siteId, '/search-refresh'))
        .set('Cookie', user.cookie)
        .send({});
      expect(res.status).toBe(500);
    } finally {
      setGoogleGscProvider(makeGscProvider());
    }
  });
});

// ---------------------------------------------------------------------------
// Site-scoped connect/binding enqueue paths (prompt 24)
// ---------------------------------------------------------------------------

describe('Site-scoped GSC enqueue paths', () => {
  async function seedSiteFor(accountId: string, domain: string): Promise<string> {
    const site = await Site.create({ accountId, url: `https://${domain}`, domain });
    return String(site._id);
  }

  it('the connect flow enqueues background matching for the Site in the URL', async () => {
    const user = await seedUser();
    const siteId = await seedSiteFor(user.id, 'example.com');
    const add = vi.fn();
    setGscSyncQueue({ add } as unknown as never);
    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'r',
        googleAccountEmail: 'user@example.com',
        scopes: [SCOPE_GSC],
      });
    expect(res.status).toBe(201);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'google-site-auto-match',
      expect.objectContaining({ accountId: user.id, siteId: user.siteId }),
      expect.objectContaining({
        attempts: 3,
        jobId: expect.stringContaining(`google-site-auto-match-${user.siteId}-`),
      }),
    );
    expect(siteId).not.toBe(user.siteId);
  });

  it('the set-property flow enqueues a sync for the matching site', async () => {
    const user = await seedUser();
    const siteId = await seedSiteFor(user.id, 'example.com');
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const add = vi.fn();
    setGscSyncQueue({ add } as unknown as never);
    const res = await request(app)
      .patch(siteGooglePath(siteId, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ gscPropertyUrl: 'sc-domain:example.com' });
    expect(res.status).toBe(200);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'gsc-sync',
      { accountId: user.id, siteId, domain: 'example.com' },
      expect.objectContaining({
        jobId: `gsc-sync-${siteId}-${toIsoDate(new Date())}`,
      }),
    );
  });

  it('the combined binding flow enqueues both Site-scoped syncs', async () => {
    const user = await seedUser('google-both-queues@x.co');
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    const gscAdd = vi.fn();
    const ga4Add = vi.fn();
    setGscSyncQueue({ add: gscAdd } as unknown as never);
    setGa4SyncQueue({ add: ga4Add } as unknown as never);

    await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({
        gscPropertyUrl: 'sc-domain:example.com',
        ga4PropertyId: 'properties/100000001',
      })
      .expect(200);

    expect(gscAdd).toHaveBeenCalledOnce();
    expect(ga4Add).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// gsc-sync queue holder
// ---------------------------------------------------------------------------

describe('gsc-sync queue holder', () => {
  it('set/get round-trips a queue and clears back to null', () => {
    expect(getGscSyncQueue()).toBeNull();
    const q = { add: vi.fn() };
    setGscSyncQueue(q as unknown as never);
    expect(getGscSyncQueue()).toBe(q);
    setGscSyncQueue(null);
    expect(getGscSyncQueue()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GA4: scope union + property selection + properties listing
// ---------------------------------------------------------------------------

describe('GA4 connection surface', () => {
  async function seedConnectedGa4(
    accountId: string,
    scopes: string[] = [SCOPE_GSC, SCOPE_GA4],
  ) {
    await upsertConnection({
      accountId,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes,
    });
  }

  it('scope-upgrade regression: a second connect UNIONS scopes and preserves the GSC property', async () => {
    const user = await seedUser();
    // First link: GSC only, property chosen.
    await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'r1',
        googleAccountEmail: 'user@example.com',
        scopes: [SCOPE_GSC],
      })
      .expect(201);
    await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ gscPropertyUrl: 'sc-domain:example.com' })
      .expect(200);
    // Incremental grant: the client re-links asking for the union.
    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'r2',
        googleAccountEmail: 'user@example.com',
        scopes: [SCOPE_GSC, SCOPE_GA4],
      })
      .expect(201);
    expect(res.body.configuration.gsc.propertyUrl).toBe('sc-domain:example.com');
    expect(res.body.configuration.connection.scopes).toEqual(
      expect.arrayContaining([SCOPE_GSC, SCOPE_GA4]),
    );
    expect(new Set(res.body.configuration.connection.scopes).size).toBe(
      res.body.configuration.connection.scopes.length,
    );
  });

  it('upsert preserves a chosen GA4 property across re-links', async () => {
    const user = await seedUser();
    await seedConnectedGa4(user.id);
    const patch = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ ga4PropertyId: 'properties/100000001' })
      .expect(200);
    expect(patch.body.configuration.ga4.propertyId).toBe('properties/100000001');
    // Re-link (e.g. reconnect after needs_reconnect) — GA4 choice survives.
    await seedConnectedGa4(user.id, [SCOPE_GSC]);
    const res = await request(app)
      .get(googlePath(user, '/configuration'))
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.configuration.ga4.propertyId).toBe('properties/100000001');
    expect(res.body.configuration.ga4.propertyDisplayName).toBe(
      'example.com — GA4',
    );
    expect(res.body.configuration.connection.scopes).toEqual(
      expect.arrayContaining([SCOPE_GSC, SCOPE_GA4]),
    );
  });

  it('PATCH with ga4PropertyId validates against the live GA4 property list', async () => {
    const user = await seedUser();
    await seedConnectedGa4(user.id);
    const bad = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ ga4PropertyId: 'properties/999999999' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/google analytics properties/i);
  });

  it('PATCH with ga4PropertyId requires the GA4 scope (400 missingGa4Scope)', async () => {
    const user = await seedUser();
    await seedConnectedGa4(user.id, [SCOPE_GSC]);
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ ga4PropertyId: 'properties/100000001' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/google analytics permission/i);
  });

  it('PATCH can set BOTH the GSC property and the GA4 property in one call', async () => {
    const user = await seedUser();
    await seedConnectedGa4(user.id);
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({
        gscPropertyUrl: 'sc-domain:example.com',
        ga4PropertyId: 'properties/100000002',
      })
      .expect(200);
    expect(res.body.configuration.gsc.propertyUrl).toBe('sc-domain:example.com');
    expect(res.body.configuration.ga4.propertyId).toBe('properties/100000002');
    expect(res.body.configuration.ga4.propertyDisplayName).toBe('Example Staging');
  });

  it('PATCH with neither field is a 400 (schema refine)', async () => {
    const user = await seedUser();
    await seedConnectedGa4(user.id);
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it('PATCH with a malformed ga4PropertyId is a 400 before any vendor call', async () => {
    const user = await seedUser();
    await seedConnectedGa4(user.id);
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ ga4PropertyId: 'drop table properties' });
    expect(res.status).toBe(400);
  });

  it('GA4 endpoints 500 when the api booted without a wired Ga4Provider', async () => {
    setGoogleGa4Provider(null);
    const user = await seedUser();
    await seedConnectedGa4(user.id);
    const patch = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ ga4PropertyId: 'properties/100000001' });
    expect(patch.status).toBe(500);
    const list = await request(app)
      .get(googlePath(user, '/analytics-properties'))
      .set('Cookie', user.cookie);
    expect(list.status).toBe(500);
  });

  describe('GET /api/sites/:siteId/google/analytics-properties', () => {
    it('401 without a session', async () => {
      const res = await request(app).get(
        siteGooglePath('aaaaaaaaaaaaaaaaaaaaaaaa', '/analytics-properties'),
      );
      expect(res.status).toBe(401);
    });


    it('404 when not connected', async () => {
      const user = await seedUser();
      const res = await request(app)
        .get(googlePath(user, '/analytics-properties'))
        .set('Cookie', user.cookie);
      expect(res.status).toBe(404);
    });

    it('400 when the GA4 scope was never granted', async () => {
      const user = await seedUser();
      await seedConnectedGa4(user.id, [SCOPE_GSC]);
      const res = await request(app)
        .get(googlePath(user, '/analytics-properties'))
        .set('Cookie', user.cookie);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/google analytics permission/i);
    });

    it('200 lists the account GA4 property summaries', async () => {
      const user = await seedUser();
      await seedConnectedGa4(user.id);
      const res = await request(app)
        .get(googlePath(user, '/analytics-properties'))
        .set('Cookie', user.cookie);
      expect(res.status).toBe(200);
      expect(res.body.properties).toEqual(
        FAKE_GA4_PROPERTIES.map((property) =>
          expect.objectContaining({ ...property, inUseBy: [] }),
        ),
      );
    });

    // Regression: a live GA4 403 (Admin API scope not effective / API disabled)
    // used to surface `VendorMalformedError` → the generic `errors.internal`
    // 500 the user reported. It must now be an actionable 400.
    it('403 from Google → 400 with the grant-analytics message (not a 500)', async () => {
      const user = await seedUser();
      await seedConnectedGa4(user.id);
      setGoogleGa4Provider(
        createFakeGa4Provider({
          failure: new VendorAuthError('permission denied (HTTP 403)', {
            provider: 'google',
            operation: 'ga4-account-summaries',
          }),
        }),
      );
      const res = await request(app)
        .get(googlePath(user, '/analytics-properties'))
        .set('Cookie', user.cookie);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/google analytics permission/i);
      expect(res.body.error.message).not.toMatch(/something went wrong/i);
    });

    it('dead shared token (GscReconnectRequiredError) → 400 reconnect message', async () => {
      const user = await seedUser();
      await seedConnectedGa4(user.id);
      setGoogleGa4Provider(
        createFakeGa4Provider({
          failure: new GscReconnectRequiredError('access token rejected', {
            provider: 'google',
            operation: 'ga4-account-summaries',
          }),
        }),
      );
      const res = await request(app)
        .get(googlePath(user, '/analytics-properties'))
        .set('Cookie', user.cookie);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/reconnect/i);
    });

    it('vendor quota (429) → 429, not a 500', async () => {
      const user = await seedUser();
      await seedConnectedGa4(user.id);
      setGoogleGa4Provider(
        createFakeGa4Provider({
          failure: new VendorQuotaError('rate limited', {
            provider: 'google',
            operation: 'ga4-account-summaries',
          }),
        }),
      );
      const res = await request(app)
        .get(googlePath(user, '/analytics-properties'))
        .set('Cookie', user.cookie);
      expect(res.status).toBe(429);
      expect(res.body.error.message).not.toMatch(/something went wrong/i);
    });

    it('transient vendor failure → 500 but a clean localized message, not the generic', async () => {
      const user = await seedUser();
      await seedConnectedGa4(user.id);
      setGoogleGa4Provider(
        createFakeGa4Provider({
          failure: new VendorUnavailableError('upstream 503', {
            provider: 'google',
            operation: 'ga4-account-summaries',
          }),
        }),
      );
      const res = await request(app)
        .get(googlePath(user, '/analytics-properties'))
        .set('Cookie', user.cookie);
      expect(res.status).toBe(500);
      // The whole point of the fix: NOT the scary generic `errors.internal`.
      expect(res.body.error.message).not.toMatch(/something went wrong/i);
    });

    it('a non-provider error (e.g. HttpError) passes through unchanged', async () => {
      const user = await seedUser();
      await seedConnectedGa4(user.id);
      const stub = {
        listProperties: async () => {
          throw HttpError.notFound({ code: 'GOOGLE_ERRORS_NOT_CONNECTED', messageKey: 'google.errors.notConnected' });
        },
        runReport: async () => {
          throw new Error('unused');
        },
      } as unknown as Ga4Provider;
      setGoogleGa4Provider(stub);
      const res = await request(app)
        .get(googlePath(user, '/analytics-properties'))
        .set('Cookie', user.cookie);
      expect(res.status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/sites/:siteId/google/search-analytics (drill-in)
// ---------------------------------------------------------------------------

describe('GET /api/sites/:siteId/google/search-analytics', () => {
  async function seedSite(accountId: string, domain = 'example.com') {
    const site = await Site.create({
      accountId,
      url: `https://${domain}`,
      domain,
      gscPropertyUrl: `sc-domain:${domain}`,
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
    });
    return site.id as string;
  }

  async function seedSnapshot(
    siteId: string,
    accountId: string,
    snapshotDate: string,
    rows: Array<[string, number, number]>,
    dimensionSet = 'query',
  ) {
    await upsertSearchAnalytics(getTestDb() as never, {
      siteId,
      accountId,
      snapshotDate,
      dimensionSet,
      rows: rows.map(([key, clicks, impressions]) => ({
        keys: [key],
        clicks,
        impressions,
        ctr: impressions === 0 ? 0 : clicks / impressions,
        position: 5.0,
      })),
    });
  }

  async function seedConnected(accountId: string) {
    await upsertConnection({
      accountId,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
  }

  it('401 without a session', async () => {
    const res = await request(app).get(
      '/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/google/search-analytics?dimension=query',
    );
    expect(res.status).toBe(401);
  });

  it('400 on a malformed siteId', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get('/api/sites/not-hex/google/search-analytics?dimension=query')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('400 on an unknown dimension (date is not requestable)', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get(
        `/api/sites/${user.siteId}/google/search-analytics?dimension=date`,
      )
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('cross-account: user B never reads user A data (404, not 403)', async () => {
    const owner = await seedUser('detail-owner@x.co');
    const stranger = await seedUser('detail-stranger@x.co');
    const siteId = await seedSite(owner.id);
    await seedConnected(owner.id);
    await seedSnapshot(siteId, owner.id, '2026-07-04', [['seo audit', 10, 1000]]);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-analytics?dimension=query`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
  });

  it('404 noDataYet when connected but the dimension has no snapshot', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await seedConnected(user.id);
    // A query snapshot exists, but the requested `page` dimension has none.
    await seedSnapshot(siteId, user.id, '2026-07-04', [['q', 10, 1000]]);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-analytics?dimension=page`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
  });

  it('404 with reconnect copy when the connection needs reconnecting', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await seedConnected(user.id);
    await markNeedsReconnect(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-analytics?dimension=query`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/reconnect/i);
  });

  it('200 returns ALL rows for the dimension (not top-5), clicks-DESC, with asOf', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await seedConnected(user.id);
    await seedSnapshot(siteId, user.id, '2026-07-04', [
      ['q3', 5, 500],
      ['q-top', 30, 3000],
      ['q6', 1, 100],
      ['q-second', 10, 1000],
      ['q4', 4, 400],
      ['q5', 3, 300],
    ]);
    // An OLDER snapshot must not bleed into the latest read.
    await seedSnapshot(siteId, user.id, '2026-06-06', [['stale', 99, 9900]]);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-analytics?dimension=query`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    const detail = res.body.detail as {
      asOf: string;
      rows: Array<{ key: string; clicks: number }>;
    };
    expect(detail.asOf).toBe('2026-07-04');
    expect(detail.rows.map((r) => r.key)).toEqual([
      'q-top',
      'q-second',
      'q3',
      'q4',
      'q5',
      'q6',
    ]);
    expect(detail.rows[0]).toEqual({
      key: 'q-top',
      clicks: 30,
      impressions: 3000,
      ctr: 30 / 3000,
      position: 5.0,
    });
  });

  it('200 serves the device dimension from its own snapshot', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await seedConnected(user.id);
    await seedSnapshot(
      siteId,
      user.id,
      '2026-07-04',
      [
        ['MOBILE', 20, 2000],
        ['DESKTOP', 12, 1200],
      ],
      'device',
    );
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-analytics?dimension=device`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.detail.rows.map((r: { key: string }) => r.key)).toEqual([
      'MOBILE',
      'DESKTOP',
    ]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sites/:siteId/google/sitemaps (drill-in)
// ---------------------------------------------------------------------------

describe('GET /api/sites/:siteId/google/sitemaps', () => {
  async function seedSite(accountId: string, domain = 'example.com') {
    const site = await Site.create({
      accountId,
      url: `https://${domain}`,
      domain,
      gscPropertyUrl: `sc-domain:${domain}`,
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
    });
    return site.id as string;
  }

  async function seedConnected(accountId: string) {
    await upsertConnection({
      accountId,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
  }

  function sitemapEntry(overrides: Partial<GscSitemapEntry> = {}): GscSitemapEntry {
    return {
      path: 'https://example.com/sitemap.xml',
      type: 'sitemap',
      lastSubmitted: new Date('2026-07-01T00:00:00.000Z'),
      lastDownloaded: new Date('2026-07-02T00:00:00.000Z'),
      isPending: false,
      isSitemapsIndex: false,
      errors: 0,
      warnings: 2,
      processed: 12,
      ...overrides,
    };
  }

  it('401 without a session', async () => {
    const res = await request(app).get(
      '/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/google/sitemaps',
    );
    expect(res.status).toBe(401);
  });

  it('400 on a malformed siteId', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get('/api/sites/not-hex/google/sitemaps')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('cross-account: 404, not 403', async () => {
    const owner = await seedUser('sm-owner@x.co');
    const stranger = await seedUser('sm-stranger@x.co');
    const siteId = await seedSite(owner.id);
    await seedConnected(owner.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/sitemaps`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
  });

  it('404 noDataYet when there is no connection at all', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/sitemaps`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
  });

  it('200 with an empty list (null asOf) when connected but nothing snapshotted', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await seedConnected(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/sitemaps`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ asOf: null, sitemaps: [] });
  });

  it('200 maps the latest snapshot rows (older snapshots ignored)', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user.id);
    await seedConnected(user.id);
    await upsertSitemaps(getTestDb() as never, {
      siteId,
      accountId: user.id,
      snapshotDate: '2026-06-06',
      entries: [sitemapEntry({ path: 'https://example.com/old.xml' })],
    });
    await upsertSitemaps(getTestDb() as never, {
      siteId,
      accountId: user.id,
      snapshotDate: '2026-07-04',
      entries: [
        sitemapEntry(),
        sitemapEntry({
          path: 'https://example.com/news.xml',
          type: 'rssFeed',
          lastSubmitted: null,
          lastDownloaded: null,
          isPending: true,
          errors: 3,
        }),
      ],
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/sitemaps`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.asOf).toBe('2026-07-04');
    expect(res.body.sitemaps).toHaveLength(2);
    // readSitemaps orders by path: news.xml < sitemap.xml.
    expect(res.body.sitemaps[0]).toEqual({
      path: 'https://example.com/news.xml',
      type: 'rssFeed',
      lastSubmitted: null,
      lastDownloaded: null,
      isPending: true,
      isSitemapsIndex: false,
      errors: 3,
      warnings: 2,
      processed: 12,
    });
    expect(res.body.sitemaps[1]).toEqual({
      path: 'https://example.com/sitemap.xml',
      type: 'sitemap',
      lastSubmitted: '2026-07-01T00:00:00.000Z',
      lastDownloaded: '2026-07-02T00:00:00.000Z',
      isPending: false,
      isSitemapsIndex: false,
      errors: 0,
      warnings: 2,
      processed: 12,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/sites/:siteId/google/generative-appearance (prompt 12d)
// ---------------------------------------------------------------------------

describe('GET /api/sites/:siteId/google/generative-appearance', () => {
  async function seedSite(
    accountId: string,
    opts: { domain?: string; gscPropertyUrl?: string } = {},
  ) {
    const domain = opts.domain ?? 'example.com';
    const site = await Site.create({
      accountId,
      url: `https://${domain}`,
      domain,
      ...(opts.gscPropertyUrl === undefined
        ? {}
        : {
            gscPropertyUrl: opts.gscPropertyUrl,
            gscBindingGenerationId: 'legacy',
            gscBindingSource: 'legacy',
          }),
    });
    return site.id as string;
  }

  function meta(): ObservationMeta {
    return {
      sourceKind: 'first_party',
      sourceLabel: 'Google Search Console',
      observedAt: '2026-07-04T00:00:00.000Z',
      freshUntil: null,
      freshness: 'fresh',
      market: null,
      sampleCount: 1,
      coverageNoteKey: null,
    };
  }

  async function seedAppearance(input: {
    siteId: string;
    accountId: string;
    property: string;
    rows: Array<{ rawAppearance: string; clicks: number }>;
    snapshotDate?: string;
  }) {
    await upsertSearchAppearance(getTestDb() as never, {
      siteId: input.siteId,
      accountId: input.accountId,
      property: input.property,
      snapshotDate: input.snapshotDate ?? '2026-07-04',
      rows: input.rows.map((row) => ({
        rawAppearance: row.rawAppearance,
        clicks: row.clicks,
        impressions: row.clicks * 10,
        ctr: 0.1,
        position: 4.5,
      })),
      observationMeta: meta(),
    });
  }

  it('401 without a session', async () => {
    const res = await request(app).get(
      '/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/google/generative-appearance',
    );
    expect(res.status).toBe(401);
  });

  it('400 on a malformed siteId', async () => {
    const user = await seedUser('ga-bad@x.co');
    const res = await request(app)
      .get('/api/sites/not-hex/google/generative-appearance')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('cross-account: 404, not 403', async () => {
    const owner = await seedUser('ga-owner@x.co');
    const stranger = await seedUser('ga-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/generative-appearance`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
  });

  it('404 for a site id that does not exist at all', async () => {
    const user = await seedUser('ga-missing@x.co');
    const res = await request(app)
      .get('/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/google/generative-appearance')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

  it('200 unavailable (not 404) when the site has no snapshot yet', async () => {
    const user = await seedUser('ga-empty@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/generative-appearance`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.appearance).toEqual({
      status: 'unavailable',
      window: null,
      rows: [],
      observationMeta: null,
    });
  });

  it('does not derive a property while the Site awaits background matching', async () => {
    const user = await seedUser('ga-derived@x.co');
    const siteId = await seedSite(user.id, { domain: 'derived.example' });
    // Pre-binding rows remain inaccessible until the Site has a current
    // explicit or background-matched generation.
    await seedAppearance({
      siteId,
      accountId: user.id,
      property: 'sc-domain:derived.example',
      rows: [{ rawAppearance: 'AI_OVERVIEWS', clicks: 7 }],
    });
    // A row under a DIFFERENT property must not leak into the response.
    await seedAppearance({
      siteId,
      accountId: user.id,
      property: 'https://other.example/',
      rows: [{ rawAppearance: 'AI_OVERVIEWS', clicks: 999 }],
    });

    const res = await request(app)
      .get(`/api/sites/${siteId}/google/generative-appearance`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.appearance).toEqual({
      status: 'unavailable',
      window: null,
      rows: [],
      observationMeta: null,
    });
  });

  it('uses the matched GSC property URL when the site has one', async () => {
    const user = await seedUser('ga-matched@x.co');
    const siteId = await seedSite(user.id, {
      domain: 'matched.example',
      gscPropertyUrl: 'https://matched.example/',
    });
    await seedAppearance({
      siteId,
      accountId: user.id,
      property: 'https://matched.example/',
      rows: [{ rawAppearance: 'AI_OVERVIEWS', clicks: 4 }],
    });
    // The derived sc-domain fallback must NOT be consulted for this site.
    await seedAppearance({
      siteId,
      accountId: user.id,
      property: 'sc-domain:matched.example',
      rows: [{ rawAppearance: 'AI_OVERVIEWS', clicks: 111 }],
    });

    const res = await request(app)
      .get(`/api/sites/${siteId}/google/generative-appearance`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.appearance.status).toBe('available');
    expect(res.body.appearance.rows).toHaveLength(1);
    expect(res.body.appearance.rows[0].clicks).toBe(4);
  });

  it('200 unavailable when the snapshot holds only non-generative appearances', async () => {
    const user = await seedUser('ga-nongen@x.co');
    const siteId = await seedSite(user.id, {
      domain: 'nongen.example',
      gscPropertyUrl: 'sc-domain:nongen.example',
    });
    await seedAppearance({
      siteId,
      accountId: user.id,
      property: 'sc-domain:nongen.example',
      rows: [{ rawAppearance: 'VIDEO', clicks: 12 }],
    });

    const res = await request(app)
      .get(`/api/sites/${siteId}/google/generative-appearance`)
      .set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    // Absence of a generative surface is reported honestly, and the raw
    // non-generative rows are still returned verbatim (never zero-filled).
    expect(res.body.appearance.status).toBe('unavailable');
    expect(res.body.appearance.rows).toHaveLength(1);
    expect(res.body.appearance.rows[0].isGenerative).toBe(false);
    expect(res.body.appearance.rows[0].rawAppearance).toBe('VIDEO');
  });
});

// ---------------------------------------------------------------------------
// GA4 analytics endpoints + runGa4Sync + queue plumbing
// ---------------------------------------------------------------------------

describe('GA4 analytics endpoints', () => {
  async function seedSite(accountId: string, domain = 'example.com') {
    const site = await Site.create({
      accountId,
      url: `https://${domain}`,
      domain,
      gscPropertyUrl: `sc-domain:${domain}`,
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
      ga4PropertyId: 'properties/100000001',
      ga4PropertyDisplayName: 'example.com — GA4',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    return site.id as string;
  }

  /** User with a GA4-enabled connection + chosen property. */
  async function seedEnabled(email = 'ga4@x.co') {
    const user = await seedUser(email);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ ga4PropertyId: 'properties/100000001' })
      .expect(200);
    return user;
  }

  function ga4Row(key: string, sessions: number) {
    return {
      key,
      sessions,
      activeUsers: sessions - 1,
      engagedSessions: Math.floor(sessions / 2),
      keyEvents: 1,
    };
  }

  async function seedGa4Snapshot(
    siteId: string,
    accountId: string,
    snapshotDate: string,
    windowDays: number,
  ) {
    const db = getTestDb() as never;
    await upsertGa4Metrics(db, {
      siteId,
      accountId,
      snapshotDate,
      dimensionSet: 'channel',
      windowDays,
      rows: [ga4Row('Organic Search', 70), ga4Row('Direct', 30)],
    });
    await upsertGa4Metrics(db, {
      siteId,
      accountId,
      snapshotDate,
      dimensionSet: 'page',
      windowDays,
      rows: [ga4Row('/', 60), ga4Row('/pricing', 20)],
    });
    await upsertGa4Metrics(db, {
      siteId,
      accountId,
      snapshotDate,
      dimensionSet: 'country',
      windowDays,
      rows: [ga4Row('United States', 80)],
    });
    await upsertGa4Metrics(db, {
      siteId,
      accountId,
      snapshotDate,
      dimensionSet: 'device',
      windowDays,
      rows: [ga4Row('desktop', 65), ga4Row('mobile', 35)],
    });
  }

  it('401 without a session; 400 on malformed siteId/range/dimension', async () => {
    const anon = await request(app).get(
      '/api/sites/aaaaaaaaaaaaaaaaaaaaaaaa/google/analytics-summary',
    );
    expect(anon.status).toBe(401);
    const user = await seedEnabled('ga4-badreq@x.co');
    const badSite = await request(app)
      .get('/api/sites/nope/google/analytics-summary')
      .set('Cookie', user.cookie);
    expect(badSite.status).toBe(400);
    const siteId = await seedSite(user.id);
    const badRange = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary?range=14d`)
      .set('Cookie', user.cookie);
    expect(badRange.status).toBe(400);
    const badDim = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-detail?dimension=date`)
      .set('Cookie', user.cookie);
    expect(badDim.status).toBe(400);
  });


  it('cross-account: 404, not 403', async () => {
    const owner = await seedEnabled('ga4-owner@x.co');
    const stranger = await seedUser('ga4-stranger@x.co');
    const siteId = await seedSite(owner.id);
    await seedGa4Snapshot(siteId, owner.id, '2026-07-12', 28);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
  });

  it('404 analyticsNotEnabled when the scope or property is missing', async () => {
    const user = await seedUser('ga4-noscope@x.co');
    const siteId = await seedSite(user.id);
    // Connected with GSC only — no GA4 scope, no property.
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/google analytics is not enabled/i);
  });

  it('404 noDataYet when enabled but nothing snapshotted for the window', async () => {
    const user = await seedEnabled('ga4-nodata@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
    // A 7d request equally 404s until a 7d snapshot lands.
    const short = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary?range=7d`)
      .set('Cookie', user.cookie);
    expect(short.status).toBe(404);
  });

  it('200 summary: totals, engagement rate, breakdowns, sliced timeseries, previousPeriod', async () => {
    const user = await seedEnabled('ga4-summary@x.co');
    const siteId = await seedSite(user.id);
    const db = getTestDb() as never;
    await seedGa4Snapshot(siteId, user.id, '2026-06-14', 28); // previous period
    await seedGa4Snapshot(siteId, user.id, '2026-07-12', 28);
    // Daily rows live at the 90d window; only the last 28 days slice in.
    await upsertGa4Metrics(db, {
      siteId,
      accountId: user.id,
      snapshotDate: '2026-07-12',
      dimensionSet: 'date',
      windowDays: 90,
      rows: [
        ga4Row('2026-07-11', 12),
        ga4Row('2026-05-01', 9), // outside the 28d slice
        ga4Row('2026-07-10', 8),
      ],
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    const summary = res.body.summary;
    expect(summary.totalSessions).toBe(100);
    expect(summary.totalActiveUsers).toBe(98);
    expect(summary.totalEngagedSessions).toBe(50);
    expect(summary.totalKeyEvents).toBe(2);
    expect(summary.engagementRate).toBeCloseTo(0.5, 10);
    expect(summary.asOf).toBe('2026-07-12');
    expect(summary.timeseries.map((t: { date: string }) => t.date)).toEqual([
      '2026-07-10',
      '2026-07-11',
    ]);
    expect(summary.channels.map((c: { channel: string }) => c.channel)).toEqual([
      'Organic Search',
      'Direct',
    ]);
    expect(summary.topPages[0]).toEqual({
      url: '/',
      sessions: 60,
      activeUsers: 59,
      engagedSessions: 30,
      keyEvents: 1,
    });
    expect(summary.countries).toHaveLength(1);
    expect(summary.devices.map((d: { device: string }) => d.device)).toEqual([
      'desktop',
      'mobile',
    ]);
    expect(summary.previousPeriod).toEqual({
      totalSessions: 100,
      totalActiveUsers: 98,
      totalEngagedSessions: 50,
      totalKeyEvents: 2,
    });
  });

  it('200 summary tolerates a missing date snapshot (empty timeseries) and zero sessions', async () => {
    const user = await seedEnabled('ga4-zeros@x.co');
    const siteId = await seedSite(user.id);
    const db = getTestDb() as never;
    await upsertGa4Metrics(db, {
      siteId,
      accountId: user.id,
      snapshotDate: '2026-07-12',
      dimensionSet: 'channel',
      windowDays: 28,
      rows: [
        {
          key: 'Direct',
          sessions: 0,
          activeUsers: 0,
          engagedSessions: 0,
          keyEvents: 0,
        },
      ],
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary.engagementRate).toBe(0);
    expect(res.body.summary.timeseries).toEqual([]);
    expect(res.body.summary.previousPeriod).toBeNull();
  });

  it('200 detail returns the full dimension snapshot for the window', async () => {
    const user = await seedEnabled('ga4-detail@x.co');
    const siteId = await seedSite(user.id);
    await seedGa4Snapshot(siteId, user.id, '2026-07-12', 7);
    const res = await request(app)
      .get(
        `/api/sites/${siteId}/google/analytics-detail?dimension=page&range=7d`,
      )
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.detail.asOf).toBe('2026-07-12');
    expect(res.body.detail.rows).toEqual([
      { key: '/', sessions: 60, activeUsers: 59, engagedSessions: 30, keyEvents: 1 },
      {
        key: '/pricing',
        sessions: 20,
        activeUsers: 19,
        engagedSessions: 10,
        keyEvents: 1,
      },
    ]);
  });

  it('refresh: syncs through the fake provider and returns the summary; coalesced', async () => {
    const user = await seedEnabled('ga4-refresh@x.co');
    const siteId = await seedSite(user.id);
    let runReports = 0;
    let expectedDate: string | undefined;
    setGoogleGa4Provider(
      createFakeGa4Provider({
        runReport: async (input) => {
          runReports += 1;
          // Keep the first refresh in flight long enough for the second HTTP
          // request to reach the coalescer. A synchronous fake can complete an
          // entire refresh before Supertest dispatches the sibling request,
          // which tests request scheduling instead of coalescing.
          await new Promise((resolve) => setTimeout(resolve, 25));
          if (input.dimensions[0] === 'date') expectedDate = input.endDate;
          return {
            rows: [
              {
                dimensionValues: [
                  input.dimensions[0] === 'date'
                    ? input.endDate.replaceAll('-', '')
                    : 'Direct',
                ],
                metricValues: [40, 36, 20, 2],
              },
            ],
            rowCount: 1,
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: input.dimensions,
            metrics: input.metrics,
          };
        },
      }),
    );
    const [a, b] = await Promise.all([
      request(app)
        .post(siteGooglePath(siteId, '/analytics-refresh'))
        .set('Cookie', user.cookie)
        .send({}),
      request(app)
        .post(siteGooglePath(siteId, '/analytics-refresh'))
        .set('Cookie', user.cookie)
        .send({}),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Coalesced: 4 aggregate dimensions × 3 windows + 1 date fetch — once.
    expect(runReports).toBe(13);
    expect(a.body.summary.totalSessions).toBe(40);
    expect(a.body.summary.channels).toEqual([
      {
        channel: 'Direct',
        sessions: 40,
        activeUsers: 36,
        engagedSessions: 20,
        keyEvents: 2,
      },
    ]);
    // The GA4 date keys are normalized to ISO on write.
    const iso = a.body.summary.timeseries.map((t: { date: string }) => t.date);
    expect(expectedDate).toBeDefined();
    expect(iso).toContain(expectedDate);
  });

  it('refresh 404s for a cross-account site before any vendor call', async () => {
    const owner = await seedEnabled('ga4-rowner@x.co');
    const stranger = await seedUser('ga4-rstranger@x.co');
    const siteId = await seedSite(owner.id);
    const res = await request(app)
      .post(siteGooglePath(siteId, '/analytics-refresh'))
      .set('Cookie', stranger.cookie)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('runGa4Sync (unit statuses)', () => {
  const SITE = 'cccccccccccccccccccccccc';

  function syncDeps(overrides: Partial<Ga4SyncDeps> = {}): Ga4SyncDeps {
    return {
      ga4Provider: createFakeGa4Provider(),
      gscProvider: makeGscProvider(),
      persist: { upsertGa4Metrics: async () => {} },
      logger,
      ...overrides,
    };
  }

  async function seedEnabledConnection(accountId: string) {
    await upsertConnection({
      accountId,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    await Site.create({
      _id: SITE,
      accountId,
      url: 'https://example.com',
      domain: 'example.com',
      ga4PropertyId: 'properties/100000001',
      ga4PropertyDisplayName: 'example.com — GA4',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
  }

  it('not-connected without a connection row', async () => {
    const user = await seedUser('ga4-sync-none@x.co');
    const result = await runGa4Sync(user.id, SITE, syncDeps());
    expect(result.status).toBe('not-connected');
    expect(result.snapshotDate).toBeNull();
  });

  it('needs-reconnect when the connection is flagged', async () => {
    const user = await seedUser('ga4-sync-reconnect@x.co');
    await seedEnabledConnection(user.id);
    await markNeedsReconnect(user.id);
    const result = await runGa4Sync(user.id, SITE, syncDeps());
    expect(result.status).toBe('needs-reconnect');
  });

  it('not-enabled when the GA4 scope or property is missing', async () => {
    const user = await seedUser('ga4-sync-noscope@x.co');
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const result = await runGa4Sync(user.id, SITE, syncDeps());
    expect(result.status).toBe('not-enabled');
  });

  it('needs-reconnect when the token refresh dies mid-run', async () => {
    const user = await seedUser('ga4-sync-deadtoken@x.co');
    await seedEnabledConnection(user.id);
    const result = await runGa4Sync(
      user.id,
      SITE,
      syncDeps({
        gscProvider: makeGscProvider({
          refresh: async () => {
            throw new GscReconnectRequiredError('invalid_grant', {
              provider: 'google',
              operation: 'gsc-token-refresh',
            });
          },
        }),
      }),
    );
    expect(result.status).toBe('needs-reconnect');
  });

  it('unavailable when the token refresh fails for another reason', async () => {
    const user = await seedUser('ga4-sync-refresh500@x.co');
    await seedEnabledConnection(user.id);
    const result = await runGa4Sync(
      user.id,
      SITE,
      syncDeps({
        gscProvider: makeGscProvider({
          refresh: async () => {
            throw new VendorUnavailableError('down', {
              provider: 'google',
              operation: 'gsc-token-refresh',
            });
          },
        }),
      }),
    );
    expect(result.status).toBe('unavailable');
  });

  it('sparse vendor cells fall back to ""/0 (never NaN) across aggregate + date paths', async () => {
    const user = await seedUser('ga4-sync-sparse@x.co');
    await seedEnabledConnection(user.id);
    const captured: Array<{
      dimensionSet: string;
      rows: Array<{
        key: string;
        sessions: number;
        activeUsers: number;
        engagedSessions: number;
        keyEvents: number;
      }>;
    }> = [];
    await runGa4Sync(
      user.id,
      SITE,
      syncDeps({
        ga4Provider: createFakeGa4Provider({
          runReport: async (input) => ({
            rows: [{ dimensionValues: [], metricValues: [] }],
            rowCount: 1,
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: input.dimensions,
            metrics: input.metrics,
          }),
        }),
        persist: {
          upsertGa4Metrics: async (input) => {
            captured.push({
              dimensionSet: input.dimensionSet,
              rows: input.rows.map((r) => ({ ...r })),
            });
          },
        },
      }),
    );
    const emptyRow = {
      key: '',
      sessions: 0,
      activeUsers: 0,
      engagedSessions: 0,
      keyEvents: 0,
    };
    const channel = captured.find((c) => c.dimensionSet === 'channel');
    expect(channel!.rows[0]).toEqual(emptyRow);
    const date = captured.find((c) => c.dimensionSet === 'date');
    expect(date!.rows[0]).toEqual(emptyRow);
  });

  it('unavailable when a runReport fails; needs-reconnect marks the connection on 401', async () => {
    const user = await seedUser('ga4-sync-vendor@x.co');
    await seedEnabledConnection(user.id);
    const unavailable = await runGa4Sync(
      user.id,
      SITE,
      syncDeps({
        ga4Provider: createFakeGa4Provider({
          failure: new VendorQuotaError('quota', {
            provider: 'google',
            operation: 'ga4-run-report',
          }),
        }),
      }),
    );
    expect(unavailable.status).toBe('unavailable');

    const reconnect = await runGa4Sync(
      user.id,
      SITE,
      syncDeps({
        ga4Provider: createFakeGa4Provider({
          failure: new GscReconnectRequiredError('401', {
            provider: 'google',
            operation: 'ga4-run-report',
          }),
        }),
      }),
    );
    expect(reconnect.status).toBe('needs-reconnect');
    expect((await getConnection(user.id))?.status).toBe('needs_reconnect');
  });

  it('no-data when the property returns zero channel rows; ok otherwise (with counts + archive)', async () => {
    const user = await seedUser('ga4-sync-ok@x.co');
    await seedEnabledConnection(user.id);
    const archived: string[] = [];
    const ok = await runGa4Sync(
      user.id,
      SITE,
      syncDeps({
        archive: async (input) => {
          archived.push(input.operation);
        },
        now: () => new Date('2026-07-13T12:00:00.000Z'),
        lagDays: 1,
      }),
    );
    expect(ok.status).toBe('ok');
    expect(ok.snapshotDate).toBe('2026-07-12');
    expect(ok.counts).toEqual({ date: 3, channel: 3, page: 3, country: 2, device: 3 });
    expect(archived).toHaveLength(13);
    expect(new Set(archived)).toEqual(new Set(['run-report']));

    const empty = await runGa4Sync(
      user.id,
      SITE,
      syncDeps({
        ga4Provider: createFakeGa4Provider({
          runReport: async (input) => ({
            rows: [],
            rowCount: 0,
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: input.dimensions,
            metrics: input.metrics,
          }),
        }),
      }),
    );
    expect(empty.status).toBe('no-data');
  });

  it('archive failures are swallowed; persist runs without a logger', async () => {
    const user = await seedUser('ga4-sync-archivefail@x.co');
    await seedEnabledConnection(user.id);
    const result = await runGa4Sync(user.id, SITE, {
      ga4Provider: createFakeGa4Provider(),
      gscProvider: makeGscProvider(),
      persist: { upsertGa4Metrics: async () => {} },
      archive: async () => {
        throw new Error('archive down');
      },
    });
    expect(result.status).toBe('ok');
  });

  it('coalesces concurrent syncs for one (account, site)', async () => {
    const user = await seedUser('ga4-sync-coalesce@x.co');
    await seedEnabledConnection(user.id);
    let calls = 0;
    const deps = syncDeps({
      ga4Provider: createFakeGa4Provider({
        runReport: async (input) => {
          calls += 1;
          return {
            rows: [],
            rowCount: 0,
            startDate: input.startDate,
            endDate: input.endDate,
            dimensions: input.dimensions,
            metrics: input.metrics,
          };
        },
      }),
    });
    const [r1, r2] = await Promise.all([
      runGa4Sync(user.id, SITE, deps),
      runGa4Sync(user.id, SITE, deps),
    ]);
    expect(calls).toBe(13);
    expect(r1).toBe(r2);
  });

  it('persist failure degrades to unavailable', async () => {
    const user = await seedUser('ga4-sync-pgdown@x.co');
    await seedEnabledConnection(user.id);
    const result = await runGa4Sync(
      user.id,
      SITE,
      syncDeps({
        persist: {
          upsertGa4Metrics: async () => {
            throw new Error('pg down');
          },
        },
      }),
    );
    expect(result.status).toBe('unavailable');
  });
});

describe('enqueueGa4SyncForAccount + processor + queue holder', () => {
  it('no-ops cleanly when no queue is wired', async () => {
    const user = await seedUser('ga4-q-none@x.co');
    await expect(enqueueGa4SyncForAccount(user.id, logger)).resolves.toBeUndefined();
  });

  it('enqueues one deterministic per-day job per site of the account', async () => {
    const user = await seedUser('ga4-q-sites@x.co');
    const siteA = await Site.create({
      accountId: user.id,
      url: 'https://a.example.com',
      domain: 'a.example.com',
      ga4PropertyId: 'properties/100000001',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    const siteB = await Site.create({
      accountId: user.id,
      url: 'https://b.example.com',
      domain: 'b.example.com',
      ga4PropertyId: 'properties/100000001',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    const added: Array<{ name: string; data: unknown; opts: { jobId?: string } }> = [];
    setGa4SyncQueue({
      add: async (name: string, data: unknown, opts: { jobId?: string }) => {
        added.push({ name, data, opts });
      },
    } as unknown as never);
    await enqueueGa4SyncForAccount(user.id, logger);
    const day = toIsoDate(new Date());
    expect(added).toHaveLength(2);
    expect(added.map((j) => j.opts.jobId).sort()).toEqual(
      [
        `ga4-sync-${String(siteA._id)}-${day}`,
        `ga4-sync-${String(siteB._id)}-${day}`,
      ].sort(),
    );
  });

  it('excludes a paused site from the ga4-sync fan-out', async () => {
    const user = await seedUser('ga4-q-paused@x.co');
    const active = await Site.create({
      accountId: user.id,
      url: 'https://a.example.com',
      domain: 'a.example.com',
      ga4PropertyId: 'properties/100000001',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    await Site.create({
      accountId: user.id,
      url: 'https://p.example.com',
      domain: 'p.example.com',
      paused: true,
      pausedAt: new Date(),
      ga4PropertyId: 'properties/100000001',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    const added: Array<{ data: unknown }> = [];
    setGa4SyncQueue({
      add: async (_name: string, data: unknown) => {
        added.push({ data });
      },
    } as unknown as never);
    await enqueueGa4SyncForAccount(user.id, logger);
    expect(added).toHaveLength(1);
    expect((added[0]!.data as { siteId: string }).siteId).toBe(String(active._id));
  });

  it('swallows enqueue failures (logged, never thrown into the request)', async () => {
    const user = await seedUser('ga4-q-fail@x.co');
    await Site.create({
      accountId: user.id,
      url: 'https://a.example.com',
      domain: 'a.example.com',
      ga4PropertyId: 'properties/100000001',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    setGa4SyncQueue({
      add: async () => {
        throw new Error('redis down');
      },
    } as unknown as never);
    await expect(enqueueGa4SyncForAccount(user.id, logger)).resolves.toBeUndefined();
  });

  it('processor: malformed payload → UnrecoverableError; valid payload runs the sync', async () => {
    const user = await seedUser('ga4-proc@x.co');
    const processor = createGa4SyncProcessor({
      ga4Provider: createFakeGa4Provider(),
      gscProvider: makeGscProvider(),
      persist: { upsertGa4Metrics: async () => {} },
      logger,
    });
    await expect(
      processor({ data: { nope: true } } as unknown as Job),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    const result = await processor({
      data: { accountId: user.id, siteId: 'dddddddddddddddddddddddd' },
    } as unknown as Job);
    expect(result.status).toBe('not-connected');
  });

  it('ga4-sync queue holder set/get round-trips and clears', () => {
    expect(getGa4SyncQueue()).toBeNull();
    const q = { add: vi.fn() };
    setGa4SyncQueue(q as unknown as never);
    expect(getGa4SyncQueue()).toBe(q);
    setGa4SyncQueue(null);
    expect(getGa4SyncQueue()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GA4 ladder edges (coverage: reconnect/no-connection summary reads, PATCH
// without a connection, connect-complete GA4 enqueue branch)
// ---------------------------------------------------------------------------

describe('GA4 ladder edges', () => {
  async function seedSite(accountId: string, domain = 'example.com') {
    const site = await Site.create({
      accountId,
      url: `https://${domain}`,
      domain,
      gscPropertyUrl: `sc-domain:${domain}`,
      gscBindingGenerationId: 'legacy',
      gscBindingSource: 'legacy',
      ga4PropertyId: 'properties/100000001',
      ga4PropertyDisplayName: 'example.com — GA4',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    return site.id as string;
  }

  it('analytics-summary 404s with reconnect copy when the connection needs reconnecting', async () => {
    const user = await seedUser('ga4-edge-reconnect@x.co');
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    await markNeedsReconnect(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/reconnect/i);
  });

  it('analytics-summary 404s noDataYet when there is no connection at all', async () => {
    const user = await seedUser('ga4-edge-noconn@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
  });

  it('PATCH ga4PropertyId without a connection 404s notConnected', async () => {
    const user = await seedUser('ga4-edge-patch@x.co');
    const res = await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ ga4PropertyId: 'properties/100000001' });
    expect(res.status).toBe(404);
  });

  it('rangeToWindowDays maps every range value', () => {
    expect(rangeToWindowDays('7d')).toBe(7);
    expect(rangeToWindowDays('28d')).toBe(28);
    expect(rangeToWindowDays('90d')).toBe(90);
  });

  it('search-summary honours range=7d (7-day window has no snapshot → noDataYet)', async () => {
    const user = await seedUser('gsc-range7@x.co');
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/search-summary?range=7d`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
  });

  it('analytics-detail 404s noDataYet when enabled but nothing snapshotted', async () => {
    const user = await seedUser('ga4-detail-empty@x.co');
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-detail?dimension=channel`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/no search data yet/i);
  });

  it('analytics-summary re-sorts a descending daily series ascending', async () => {
    const user = await seedUser('ga4-ts-sort@x.co');
    const siteId = await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    const db = getTestDb() as never;
    const metric = (sessions: number) => ({
      sessions,
      activeUsers: sessions,
      engagedSessions: sessions,
      keyEvents: 0,
    });
    await upsertGa4Metrics(db, {
      siteId,
      accountId: user.id,
      snapshotDate: '2026-07-12',
      dimensionSet: 'channel',
      windowDays: 28,
      rows: [{ key: 'Direct', ...metric(55) }],
    });
    // Session counts scramble the reader order (sessions-DESC within a
    // snapshot) so the ascending re-sort exercises BOTH comparator sides.
    await upsertGa4Metrics(db, {
      siteId,
      accountId: user.id,
      snapshotDate: '2026-07-12',
      dimensionSet: 'date',
      windowDays: 90,
      rows: [
        { key: '2026-07-09', ...metric(70) },
        { key: '2026-07-10', ...metric(5) },
        { key: '2026-07-11', ...metric(50) },
      ],
    });
    const res = await request(app)
      .get(`/api/sites/${siteId}/google/analytics-summary`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(
      (res.body.summary.timeseries as Array<{ date: string }>).map((r) => r.date),
    ).toEqual(['2026-07-09', '2026-07-10', '2026-07-11']);
  });

  it('POST /analytics-refresh passes the router logger into runGa4Sync (deps.logger branch)', async () => {
    const mongoose = (await import('mongoose')).default;
    const { createGoogleConnectionsRouter } = await import(
      './google-connections.routes.js'
    );
    const { default: express } = await import('express');
    const accountId = new mongoose.Types.ObjectId().toString();
    const site = await Site.create({
      accountId,
      url: 'https://example.com',
      domain: 'example.com',
      ga4PropertyId: 'properties/100000001',
      ga4PropertyDisplayName: 'example.com — GA4',
      ga4BindingGenerationId: 'legacy',
      ga4BindingSource: 'legacy',
    });
    await upsertConnection({
      accountId,
      googleAccountEmail: 'x@x.co',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as { user?: { id: string } }).user = { id: accountId };
      next();
    });
    testApp.use(
      '/api/sites/:siteId/google',
      createGoogleConnectionsRouter({
        gscProvider: createFakeGscProvider(),
        ga4Provider: createFakeGa4Provider(),
        logger,
      }),
    );
    const res = await request(testApp)
      .post(siteGooglePath(String(site._id), '/analytics-refresh'))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.summary.totalSessions).toBeGreaterThan(0);
  });

  it('connect-complete queues a fresh Site match when GA4 is already bound', async () => {
    const user = await seedUser('ga4-edge-enqueue@x.co');
    await seedSite(user.id);
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    await request(app)
      .patch(googlePath(user, '/bindings'))
      .set('Cookie', user.cookie)
      .send({ ga4PropertyId: 'properties/100000001' })
      .expect(200);
    const add = vi.fn();
    setGscSyncQueue({ add } as unknown as never);
    // Re-link (e.g. token rotation) preserves the binding; the matcher then
    // decides which initial Site syncs need enqueueing in the worker.
    const res = await request(app)
      .post(googlePath(user, '/connect/complete'))
      .set('Cookie', user.cookie)
      .send({
        refreshToken: 'r2',
        googleAccountEmail: 'user@example.com',
        scopes: [SCOPE_GSC, SCOPE_GA4],
      });
    expect(res.status).toBe(201);
    expect(add).toHaveBeenCalledWith(
      'google-site-auto-match',
      expect.objectContaining({ accountId: user.id, siteId: user.siteId }),
      expect.objectContaining({
        jobId: expect.stringContaining(`google-site-auto-match-${user.siteId}-`),
      }),
    );
  });
});

describe('legacy Site Google binding compatibility', () => {
  it('uses legacy generations at every live read and refresh boundary', async () => {
    const user = await seedUser('legacy-google-boundaries@x.co');
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    await Site.updateOne(
      { _id: user.siteId },
      {
        $set: {
          gscPropertyUrl: 'sc-domain:example.com',
          gscBindingSource: 'legacy',
          ga4PropertyId: 'properties/100000001',
          ga4PropertyDisplayName: 'example.com — GA4',
          ga4BindingSource: 'legacy',
        },
        $unset: { gscBindingGenerationId: 1, ga4BindingGenerationId: 1 },
      },
    );

    for (const response of [
      await request(app).get(googlePath(user, '/search-summary')).set('Cookie', user.cookie),
      await request(app).get(googlePath(user, '/search-analytics?dimension=query')).set('Cookie', user.cookie),
      await request(app).get(googlePath(user, '/sitemaps')).set('Cookie', user.cookie),
      await request(app).get(googlePath(user, '/generative-appearance')).set('Cookie', user.cookie),
      await request(app).get(googlePath(user, '/analytics-summary')).set('Cookie', user.cookie),
      await request(app).get(googlePath(user, '/analytics-detail?dimension=channel')).set('Cookie', user.cookie),
      await request(app).post(googlePath(user, '/search-refresh')).set('Cookie', user.cookie).send({}),
      await request(app).post(googlePath(user, '/analytics-refresh')).set('Cookie', user.cookie).send({}),
    ]) {
      expect([200, 404]).toContain(response.status);
    }
  });

  it('rejects missing Sites and disconnected Site resources at stored-read seams', async () => {
    const user = await seedUser('google-stored-access@x.co');
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });

    await expect(assertGa4StoredReadAccess(user.id, 'aaaaaaaaaaaaaaaaaaaaaaaa'))
      .rejects.toMatchObject({ status: 404 });
    await expect(assertGscStoredReadAccess(user.id, user.siteId))
      .rejects.toMatchObject({ status: 404 });
  });

  it('clears both resource bindings through the additive setter', async () => {
    const user = await seedUser('google-null-bindings@x.co');
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    await Site.updateOne(
      { _id: user.siteId },
      { $set: {
        gscPropertyUrl: 'sc-domain:example.com',
        ga4PropertyId: 'properties/100000001',
        ga4PropertyDisplayName: 'Example',
      } },
    );

    const change = await setSiteGoogleBindings(
      user.id,
      user.siteId,
      { gscPropertyUrl: null, ga4PropertyId: null },
      { gscProvider: makeGscProvider(), ga4Provider: createFakeGa4Provider() },
    );

    expect(change).toMatchObject({ gscChanged: true, ga4Changed: true });
    expect(change.site).toMatchObject({
      gscPropertyUrl: null,
      gscBindingGenerationId: null,
      ga4PropertyId: null,
      ga4BindingGenerationId: null,
    });
  });

  it('does not persist when requested bindings already match', async () => {
    const user = await seedUser('google-unchanged-bindings@x.co');
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    await Site.updateOne({ _id: user.siteId }, { $set: {
      gscPropertyUrl: 'sc-domain:example.com',
      ga4PropertyId: 'properties/100000001',
    } });

    await expect(setSiteGoogleBindings(
      user.id,
      user.siteId,
      {
        gscPropertyUrl: 'sc-domain:example.com',
        ga4PropertyId: 'properties/100000001',
      },
      { gscProvider: makeGscProvider(), ga4Provider: createFakeGa4Provider() },
    )).resolves.toMatchObject({ gscChanged: false, ga4Changed: false });
  });

  it('passes a configured logger through the binding controller', async () => {
    const mongoose = (await import('mongoose')).default;
    const { createGoogleConnectionsRouter } = await import('./google-connections.routes.js');
    const { default: express } = await import('express');
    const accountId = new mongoose.Types.ObjectId().toString();
    const site = await Site.create({
      accountId,
      url: 'https://example.com',
      domain: 'example.com',
    });
    await upsertConnection({
      accountId,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC],
    });
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as { user?: { id: string } }).user = { id: accountId };
      next();
    });
    testApp.use('/api/sites/:siteId/google', createGoogleConnectionsRouter({
      gscProvider: createFakeGscProvider(),
      ga4Provider: createFakeGa4Provider(),
      logger,
    }));

    await request(testApp)
      .patch(siteGooglePath(String(site._id), '/bindings'))
      .send({ gscPropertyUrl: 'sc-domain:example.com' })
      .expect(200);
  });

  it('normalizes a provider response that omits a GA4 stream list', async () => {
    const user = await seedUser('google-missing-streams@x.co');
    await upsertConnection({
      accountId: user.id,
      googleAccountEmail: 'user@example.com',
      refreshToken: 'r',
      scopes: [SCOPE_GSC, SCOPE_GA4],
    });
    const provider = createFakeGa4Provider();
    provider.listWebDataStreams = vi.fn(async () => undefined as never);

    const properties = await listSiteGa4Properties(
      user.id,
      user.siteId,
      provider,
      makeGscProvider(),
    );

    expect(properties.every((property) => property.webDataStreams.length === 0)).toBe(true);
  });
});
