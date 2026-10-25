/**
 * `list_client_reports` stored read tool, against real
 * in-memory Mongo + PGlite.
 */
// Entry via the module barrel first: it evaluates the registry before the
// controller, which the barrel/permissions import cycle requires.
import './index.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
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
import { subscriptions } from '../../db/schema/subscriptions.js';
import { usageCounters } from '../../db/schema/usage-counters.js';
import {
  scheduledReportDeliveries,
  scheduledReports,
} from '../../db/schema/client-reports.js';
import {
  resolveEffectivePermissions,
  type McpPermissionSpec,
} from '../../shared/mcp-permissions/index.js';
import { setApiKeysDb } from '../api-keys/api-keys.holder.js';
import {
  ClientPortalToken,
  setClientReportsQueue,
} from '../client-reports/index.js';
import { Site } from '../sites/index.js';
import { User } from '../users/users.model.js';
import { MCP_TOOL_NAMES } from './mcp.registry.js';
import { maskRecipient, toolListClientReports } from './mcp.tools.client-reports.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

const queueAdd = vi.fn();
const TOKEN_HASH = 'ab'.repeat(32);
const PROVIDER_MESSAGE_ID = 'provider-message-secret-1';
const FINGERPRINT = 'fingerprint-secret-value';

/** The site lease also takes an account lease, which needs a user document. */
async function newAccount(): Promise<string> {
  const id = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: id,
    email: `${id.toHexString()}@example.com`,
    deletionStartedAt: null,
    workLeases: [],
  });
  return id.toHexString();
}

function context(
  accountId: string,
  specs: { account?: McpPermissionSpec | null; key?: McpPermissionSpec | null } = {},
): McpToolContext {
  return {
    accountId,
    locale: 'en',
    permissions: resolveEffectivePermissions(
      specs.account ?? null,
      specs.key ?? null,
      MCP_TOOL_NAMES,
    ),
  };
}

async function seedTier(accountId: string, tier: 'pro' | 'agency') {
  await getTestDb()
    .insert(subscriptions)
    .values({ accountId, tier, status: 'active' })
    .onConflictDoNothing();
}

async function seedSite(accountId: string, domain = 'example.com') {
  const site = await Site.create({ accountId, url: `https://${domain}`, domain });
  return String(site._id);
}

async function usageSnapshot() {
  const rows = await getTestDb().select().from(usageCounters);
  return JSON.stringify(rows.map((row) => [row.accountId, row.metric, row.used]).sort());
}

type Structured = Record<string, unknown> & { error?: { code: string } };
const dataOf = (result: McpToolResult) => result.structuredContent as Structured;

beforeAll(async () => {
  await startMemoryMongo();
  setApiKeysDb((await startTestPostgres()) as never);
  setClientReportsQueue({ add: queueAdd } as never);
});
afterAll(async () => {
  setApiKeysDb(null);
  setClientReportsQueue(null);
  (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = 'none';
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  queueAdd.mockClear();
  (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = 'polar';
});

async function seedReporting(accountId: string, siteId: string) {
  const db = getTestDb();
  const [schedule] = await db
    .insert(scheduledReports)
    .values({
      accountId,
      siteId,
      name: 'Monthly client report',
      frequency: 'monthly',
      weekdayUtc: null,
      monthdayUtc: 1,
      localHour: 8,
      minuteUtc: 30,
      locale: 'en',
      recipients: ['jane.doe@client.example', 'ops@client.example'],
      sections: { audit: true, ranks: true, gsc: false },
      enabled: true,
      nextRunAt: new Date('2026-08-01T08:30:00Z'),
      lastRunAt: new Date('2026-07-01T08:30:00Z'),
    })
    .returning();
  await db.insert(scheduledReportDeliveries).values([
    {
      scheduleId: schedule!.id,
      accountId,
      siteId,
      runKey: 'run-1',
      recipient: 'jane.doe@client.example',
      status: 'sent',
      providerMessageId: PROVIDER_MESSAGE_ID,
      snapshotDate: new Date('2026-07-01T00:00:00Z'),
      finishedAt: new Date('2026-07-01T08:31:00Z'),
    },
    {
      scheduleId: schedule!.id,
      accountId,
      siteId,
      runKey: 'run-2',
      recipient: 'ops@client.example',
      status: 'pending',
      claimToken: randomUUID(),
      requestFingerprint: FINGERPRINT,
      firstAttemptAt: new Date('2026-07-02T08:30:00Z'),
    },
  ]);
  await ClientPortalToken.create([
    {
      accountId,
      siteId,
      clientLabel: 'Active client',
      tokenHash: TOKEN_HASH,
      locale: 'en',
      sections: { audit: true, ranks: false, gsc: false },
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
    },
    {
      accountId,
      siteId,
      clientLabel: 'Revoked client',
      tokenHash: 'cd'.repeat(32),
      locale: 'fr',
      sections: { audit: true, ranks: true, gsc: true },
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: new Date(),
    },
    {
      accountId,
      siteId,
      clientLabel: 'Expired client',
      tokenHash: 'ef'.repeat(32),
      locale: 'en',
      sections: { audit: true, ranks: true, gsc: true },
      expiresAt: new Date(Date.now() - 1_000),
      revokedAt: null,
    },
  ]);
}

describe('maskRecipient', () => {
  it('keeps the first character and the domain, masks everything else', () => {
    expect(maskRecipient('jane.doe@client.example')).toBe('j***@client.example');
    expect(maskRecipient('not-an-email')).toBe('***');
    expect(maskRecipient('@client.example')).toBe('***');
  });
});

describe('list_client_reports', () => {
  it('lists schedules, portals and recent deliveries with masked recipients and no secrets', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'agency');
    const siteId = await seedSite(accountId);
    await seedReporting(accountId, siteId);

    const result = await toolListClientReports({ siteId }, context(accountId));
    const data = dataOf(result);

    expect(result.isError).toBeUndefined();
    expect(data.status).toBe('ok');
    expect(data.truncated).toBe(false);
    const schedules = data.schedules as Array<Record<string, unknown>>;
    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toMatchObject({
      name: 'Monthly client report',
      frequency: 'monthly',
      recipientCount: 2,
      recipients: ['j***@client.example', 'o***@client.example'],
      enabled: true,
      nextRunAt: '2026-08-01T08:30:00.000Z',
      lastRunAt: '2026-07-01T08:30:00.000Z',
    });
    const portals = data.portals as Array<{ clientLabel: string; status: string }>;
    expect(Object.fromEntries(portals.map((row) => [row.clientLabel, row.status]))).toEqual({
      'Active client': 'active',
      'Revoked client': 'revoked',
      'Expired client': 'expired',
    });
    const deliveries = data.recentDeliveries as Array<Record<string, unknown>>;
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((row) => [row.recipient, row.status]).sort()).toEqual([
      ['j***@client.example', 'sent'],
      ['o***@client.example', 'pending'],
    ]);
    expect(data.scheduleCap).toEqual(expect.objectContaining({ used: 1 }));
    expect(typeof data.featureEnabled).toBe('boolean');

    const serialized = JSON.stringify(data);
    for (const secret of [
      TOKEN_HASH,
      'cd'.repeat(32),
      PROVIDER_MESSAGE_ID,
      FINGERPRINT,
      'jane.doe@client.example',
      'ops@client.example',
      '/portal/',
      'tokenHash',
      'claimToken',
      'pdf',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it('flags truncation when more deliveries exist than the recent window', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'agency');
    const siteId = await seedSite(accountId);
    await seedReporting(accountId, siteId);
    const db = getTestDb();
    const [schedule] = await db.select().from(scheduledReports);
    await db.insert(scheduledReportDeliveries).values(
      Array.from({ length: 25 }, (_, index) => ({
        scheduleId: schedule!.id,
        accountId,
        siteId,
        runKey: `bulk-${index}`,
        recipient: 'ops@client.example',
        status: 'failed' as const,
        errorCode: null,
        finishedAt: new Date('2026-07-03T00:00:00Z'),
      })),
    );

    const data = dataOf(await toolListClientReports({ siteId }, context(accountId)));

    expect(data.status).toBe('ok');
    expect(data.truncated).toBe(true);
    expect((data.recentDeliveries as unknown[]).length).toBe(20);
  });

  it('is empty/notConfigured when nothing is set up and exposes the feature flag', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'agency');
    const siteId = await seedSite(accountId);

    const data = dataOf(await toolListClientReports({ siteId }, context(accountId)));

    expect(data).toMatchObject({
      status: 'empty',
      reason: 'notConfigured',
      featureEnabled: env.CLIENT_REPORTS_ENABLED,
    });
  });

  it('returns locked below the Agency tier without reading stored rows', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'pro');
    const siteId = await seedSite(accountId);
    await seedReporting(accountId, siteId);

    const data = dataOf(await toolListClientReports({ siteId }, context(accountId)));

    expect(data).toMatchObject({ status: 'locked', reason: 'featureLocked' });
    expect(data.schedules).toBeUndefined();
  });

  it('hides another account\'s site and honors allowed-site + key-scope intersection', async () => {
    const owner = await newAccount();
    const stranger = await newAccount();
    await seedTier(owner, 'agency');
    await seedTier(stranger, 'agency');
    const siteA = await seedSite(owner, 'a.example.com');
    const siteB = await seedSite(owner, 'b.example.com');
    await seedReporting(owner, siteA);

    const cross = await toolListClientReports({ siteId: siteA }, context(stranger));
    expect(cross.isError).toBe(true);
    expect(dataOf(cross).error?.code).toBe('sites.errors.notFound');

    const narrowed = context(owner, {
      account: { allowedSiteIds: [siteA, siteB] },
      key: { allowedSiteIds: [siteB] },
    });
    const denied = await toolListClientReports({ siteId: siteA }, narrowed);
    expect(denied.isError).toBe(true);
    expect(dataOf(denied).error?.code).toBe('sites.errors.notFound');
    expect(dataOf(await toolListClientReports({ siteId: siteB }, narrowed)).status).toBe(
      'empty',
    );
  });

  it('never spends or enqueues', async () => {
    const accountId = await newAccount();
    await seedTier(accountId, 'agency');
    const siteId = await seedSite(accountId);
    await seedReporting(accountId, siteId);
    const before = await usageSnapshot();

    await toolListClientReports({ siteId }, context(accountId));
    await toolListClientReports({ siteId: 'bad' }, context(accountId));

    expect(await usageSnapshot()).toBe(before);
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
