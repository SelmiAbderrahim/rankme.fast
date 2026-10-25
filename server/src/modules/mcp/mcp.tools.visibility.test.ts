/**
 * `get_ai_visibility_summary` stored read tool, against
 * real in-memory Mongo + PGlite.
 */
// Entry via the module barrel first: it evaluates the registry before the
// controller, which the barrel/permissions import cycle requires.
import './index.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
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
import { vendorCache, vendorResponses } from '../../db/schema/vendor-cache.js';
import {
  aiCompetitorMentions,
  aiMentionSnapshots,
  aiTrackedPrompts,
} from '../../db/schema/index.js';
import {
  resolveEffectivePermissions,
  type McpPermissionSpec,
} from '../../shared/mcp-permissions/index.js';
import { insertSuggestionRun } from '../ai-visibility/ai-visibility.repository.js';
import { setAiVisibilityProvider } from '../ai-visibility/index.js';
import { setApiKeysDb } from '../api-keys/api-keys.holder.js';
import { Site } from '../sites/index.js';
import { User } from '../users/users.model.js';
import { MCP_TOOL_NAMES } from './mcp.registry.js';
import { toolGetAiVisibilitySummary } from './mcp.tools.visibility.js';
import type { McpToolContext } from './mcp.tools.js';

const providerCalls: string[] = [];

function oid(): string {
  return new mongoose.Types.ObjectId().toHexString();
}

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

async function seedSite(accountId: string, domain = 'example.com') {
  const site = await Site.create({ accountId, url: `https://${domain}`, domain });
  return String(site._id);
}

/** Row counts of the vendor cache + archive: a stored read must not write either. */
async function usageSnapshot() {
  const db = getTestDb();
  const cache = await db.select().from(vendorCache);
  const archive = await db.select().from(vendorResponses);
  return `${cache.length}:${archive.length}`;
}

type Structured = Record<string, unknown> & {
  status?: string;
  reason?: string;
  error?: { code: string };
};

async function call(
  accountId: string,
  args: unknown,
  ctx: McpToolContext = context(accountId),
) {
  const result = await toolGetAiVisibilitySummary(args, ctx);
  return { result, data: result.structuredContent as Structured };
}

beforeAll(async () => {
  await startMemoryMongo();
  setApiKeysDb((await startTestPostgres()) as never);
  setAiVisibilityProvider(
    new Proxy(
      {},
      {
        get: (_target, property) => () => {
          providerCalls.push(String(property));
          throw new Error('provider must not be called by a stored read');
        },
      },
    ) as never,
  );
});
afterAll(async () => {
  setApiKeysDb(null);
  setAiVisibilityProvider(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  providerCalls.length = 0;
});

async function seedChecks(accountId: string, siteId: string) {
  const db = getTestDb();
  await db.insert(aiTrackedPrompts).values([
    { accountId, siteId, prompt: 'best seo tool' },
    { accountId, siteId, prompt: 'cheap rank tracker' },
  ]);
  const now = Date.now();
  await db.insert(aiMentionSnapshots).values([
    {
      accountId,
      siteId,
      prompt: 'best seo tool',
      model: 'chatgpt',
      mentioned: true,
      citedUrl: 'https://example.com/<b x>tool',
      sentiment: 'positive',
      checkedAt: new Date(now - 1_000),
    },
    {
      // Older answer for the same prompt + engine: must be collapsed.
      accountId,
      siteId,
      prompt: 'best seo tool',
      model: 'chatgpt',
      mentioned: false,
      citedUrl: null,
      sentiment: null,
      checkedAt: new Date(now - 100_000),
    },
    {
      accountId,
      siteId,
      prompt: 'best seo tool',
      model: 'gemini',
      mentioned: false,
      citedUrl: null,
      sentiment: 'neutral',
      checkedAt: new Date(now - 2_000),
    },
  ]);
  await db.insert(aiCompetitorMentions).values({
    accountId,
    siteId,
    prompt: 'best seo tool',
    model: 'chatgpt',
    competitorDomain: 'rival.com',
    mentioned: true,
    cited: false,
    checkedAt: new Date(now - 1_000),
  });
}

describe('get_ai_visibility_summary', () => {
  it('returns latest checks per prompt and engine, share of voice and stored suggestions', async () => {
    const accountId = await newAccount();
    const siteId = await seedSite(accountId);
    await seedChecks(accountId, siteId);
    await insertSuggestionRun(getTestDb() as never, {
      id: randomUUID(),
      accountId,
      siteId,
      outputLocale: 'en',
      prompts: [
        {
          prompt: 'what is the best seo audit tool',
          source: 'ai',
          funnelStage: 'awareness',
          promptType: 'problemFirst',
          intent: 'informational',
          branded: false,
          evidenceSource: 'keyword',
          evidenceRef: 'seo audit',
        },
      ],
      seeds: {
        keywords: ['seo audit'],
        titles: [],
        competitors: [],
        gscQueries: [],
        evidenceLevel: 'limited',
        // Every newer run records that its seeds
        // were read from this site only; older runs are re-checked on read.
        provenance: 'site',
      },
      generator: 'ai',
      model: 'm',
      generatedAt: new Date(),
    });

    const { data } = await call(accountId, { siteId });

    expect(data.status).toBe('ok');
    expect(data.truncated).toBe(false);
    expect(data.window).toEqual({ days: 30, source: 'stored_ai_mention_checks' });
    expect((data.trackedPrompts as unknown[]).length).toBe(2);
    const checks = data.latestChecks as Array<Record<string, unknown>>;
    expect(checks).toHaveLength(2);
    expect(checks.map((row) => row.engine).sort()).toEqual(['chatgpt', 'gemini']);
    expect(checks.find((row) => row.engine === 'chatgpt')).toMatchObject({
      mentioned: true,
      sentiment: 'positive',
    });
    // Untrusted markup in a cited URL is neutralized.
    expect(JSON.stringify(data)).not.toContain('<b x>');
    expect(data.shareOfVoice).toMatchObject({ pct: 50 });
    // Never checked, so not checked rather than not mentioned.
    expect(data.notMentionedPrompts).toEqual([]);
    expect(data.notCheckedPrompts).toEqual(['cheap rank tracker']);
    expect(data.suggestions).toMatchObject({
      evidence: 'limited',
      truncated: false,
    });
    expect((data.suggestions as { items: unknown[] }).items).toHaveLength(1);
    expect(providerCalls).toEqual([]);
  });

  it('reports suggestions as never generated when no set is stored', async () => {
    const accountId = await newAccount();
    const siteId = await seedSite(accountId);
    await seedChecks(accountId, siteId);

    const { data } = await call(accountId, { siteId });

    expect(data.suggestions).toMatchObject({ generatedAt: null, items: [] });
  });

  it('is empty/notConfigured with no tracked prompts and empty/noData with prompts but no checks', async () => {
    const accountId = await newAccount();
    const siteId = await seedSite(accountId);

    const none = await call(accountId, { siteId });
    expect(none.data).toMatchObject({ status: 'empty', reason: 'notConfigured' });

    await getTestDb()
      .insert(aiTrackedPrompts)
      .values({ accountId, siteId, prompt: 'only prompt' });
    const noChecks = await call(accountId, { siteId });
    expect(noChecks.data).toMatchObject({ status: 'empty', reason: 'noData' });
    expect((noChecks.data.trackedPrompts as unknown[]).length).toBe(1);
  });

  it('treats another account\'s site and a deleted site as not found', async () => {
    const owner = await newAccount();
    const stranger = await newAccount();
    const siteId = await seedSite(owner);

    const cross = await call(stranger, { siteId });
    expect(cross.result.isError).toBe(true);
    expect(cross.data.error?.code).toBe('sites.errors.notFound');

    await Site.deleteOne({ _id: siteId });
    const gone = await call(owner, { siteId });
    expect(gone.data.error?.code).toBe('sites.errors.notFound');
  });

  it('enforces the allowed-site list and the key-scope intersection', async () => {
    const accountId = await newAccount();
    const siteA = await seedSite(accountId, 'a.example.com');
    const siteB = await seedSite(accountId, 'b.example.com');
    await seedChecks(accountId, siteA);

    // Account allows A and B, the key narrows to B: A is invisible.
    const narrowed = context(accountId, {
      account: { allowedSiteIds: [siteA, siteB] },
      key: { allowedSiteIds: [siteB] },
    });
    const denied = await call(accountId, { siteId: siteA }, narrowed);
    expect(denied.result.isError).toBe(true);
    expect(denied.data.error?.code).toBe('sites.errors.notFound');
    const allowed = await call(accountId, { siteId: siteB }, narrowed);
    expect(allowed.data.status).toBe('empty');

    // Account-level allow-list alone also applies.
    const accountOnly = context(accountId, { account: { allowedSiteIds: [siteB] } });
    expect((await call(accountId, { siteId: siteA }, accountOnly)).result.isError).toBe(true);
  });

  it('rejects malformed input with a localized validation error', async () => {
    const accountId = await newAccount();
    const bad = await call(accountId, { siteId: 'nope' });
    expect(bad.result.isError).toBe(true);
    expect(bad.data.error?.code).toBe('mcp.errors.invalidInput');
    const extra = await call(accountId, { siteId: oid(), extra: true });
    expect(extra.data.error?.code).toBe('mcp.errors.invalidInput');
    const missing = await toolGetAiVisibilitySummary(undefined, context(accountId));
    expect(missing.isError).toBe(true);
  });

  it('bounds the checks list to 100 rows and flags truncation', async () => {
    const accountId = await newAccount();
    const siteId = await seedSite(accountId);
    const db = getTestDb();
    await db.insert(aiTrackedPrompts).values({ accountId, siteId, prompt: 'p' });
    const now = Date.now();
    await db.insert(aiMentionSnapshots).values(
      Array.from({ length: 130 }, (_, index) => ({
        accountId,
        siteId,
        prompt: `prompt number ${index}`,
        model: 'chatgpt',
        mentioned: index % 2 === 0,
        citedUrl: null,
        sentiment: null,
        checkedAt: new Date(now - index * 1_000),
      })),
    );

    const { data } = await call(accountId, { siteId });

    expect(data.status).toBe('ok');
    expect(data.truncated).toBe(true);
    expect((data.latestChecks as unknown[]).length).toBe(100);
  });

  it('never spends: the vendor cache and providers are untouched', async () => {
    const accountId = await newAccount();
    const siteId = await seedSite(accountId);
    await seedChecks(accountId, siteId);
    const before = await usageSnapshot();

    await call(accountId, { siteId });
    await call(accountId, { siteId });

    expect(await usageSnapshot()).toBe(before);
    expect(providerCalls).toEqual([]);
  });
});
