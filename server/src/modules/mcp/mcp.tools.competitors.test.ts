/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are asserted as loose JSON */
/**
 * `list_competitors` stored-read tool.
 *
 * Real in-memory Mongo + PGlite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../api-keys/index.js', () => ({ getApiKeysDb: () => h.db }));

// Enter through the module barrel first: it fixes the evaluation order of the
// registry <-> mcp-permissions import cycle (see index.ts).
import { MCP_INPUT_SCHEMAS, MCP_TOOL_NAMES } from './index.js';
import { competitorProfiles } from '../../db/schema/index.js';
import { resolveEffectivePermissions } from '../../shared/mcp-permissions/index.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { Site } from '../sites/index.js';
import { User } from '../users/users.model.js';
import { toolListCompetitors } from './mcp.tools.competitors.js';
import type { McpToolContext } from './mcp.tools.js';

const ACCOUNT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';

let siteId = '';

function context(overrides: Partial<McpToolContext> = {}): McpToolContext {
  return {
    accountId: ACCOUNT,
    locale: 'en',
    permissions: resolveEffectivePermissions(null, null, MCP_TOOL_NAMES),
    ...overrides,
  };
}

function structured(result: { structuredContent: Record<string, unknown> }) {
  return result.structuredContent as Record<string, any>;
}

async function seedSite(accountId = ACCOUNT) {
  const site = await Site.create({
    accountId,
    url: 'https://example.com/',
    domain: 'example.com',
    label: 'Example',
  });
  return String(site._id);
}

async function seedProfile(
  site: string,
  domain: string,
  overrides: Partial<typeof competitorProfiles.$inferInsert> = {},
) {
  await getTestDb()
    .insert(competitorProfiles)
    .values({
      accountId: ACCOUNT,
      siteId: site,
      origin: `https://${domain}`,
      registrableDomain: domain,
      source: 'manual',
      status: 'active',
      ...overrides,
    });
}

beforeAll(async () => {
  await startMemoryMongo();
  h.db = await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  await User.create([
    { _id: ACCOUNT, email: 'competitors-owner@example.com' },
    { _id: OTHER, email: 'competitors-other@example.com' },
  ]);
  siteId = await seedSite();
});

describe('list_competitors', () => {
  it('is registered as a strict, zero-spend zod tool', () => {
    expect(MCP_TOOL_NAMES).toContain('list_competitors');
    expect(MCP_INPUT_SCHEMAS.list_competitors.safeParse({ siteId, status: 'gone' }).success).toBe(
      false,
    );
    expect(MCP_INPUT_SCHEMAS.list_competitors.safeParse({ siteId, extra: 1 }).success).toBe(false);
    expect(MCP_INPUT_SCHEMAS.list_competitors.safeParse({ siteId, status: 'all' }).success).toBe(
      true,
    );
  });

  it('returns active profiles by default with portfolio counts and plain ids', async () => {
    await seedProfile(siteId, 'zeta.com');
    await seedProfile(siteId, 'alpha.com', { source: 'suggested' });
    await seedProfile(siteId, 'old.com', { status: 'archived' });
    const result = await toolListCompetitors({ siteId }, context());
    const body = structured(result);
    expect(result.isError).toBeUndefined();
    expect(body).toMatchObject({
      status: 'ok',
      truncated: false,
      statusFilter: 'active',
      counts: { active: 2, archived: 1, total: 3 },
    });
    expect(body.competitors.map((c: { domain: string }) => c.domain)).toEqual([
      'alpha.com',
      'zeta.com',
    ]);
    expect(body.competitors[0]).toMatchObject({
      origin: 'https://alpha.com',
      source: 'suggested',
      status: 'active',
    });
    expect(body.competitors[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof body.competitors[0].addedAt).toBe('string');
    expect(JSON.stringify(body)).not.toContain(ACCOUNT);
  });

  it('filters by archived and all', async () => {
    await seedProfile(siteId, 'a.com');
    await seedProfile(siteId, 'b.com', { status: 'archived' });
    const archived = structured(await toolListCompetitors({ siteId, status: 'archived' }, context()));
    expect(archived.competitors.map((c: { domain: string }) => c.domain)).toEqual(['b.com']);
    const all = structured(await toolListCompetitors({ siteId, status: 'all' }, context()));
    expect(all.competitors).toHaveLength(2);
  });

  it('reports an empty portfolio explicitly instead of zeros, keeping the counts', async () => {
    await seedProfile(siteId, 'old.com', { status: 'archived' });
    const result = await toolListCompetitors({ siteId }, context());
    expect(structured(result)).toMatchObject({
      status: 'empty',
      reason: 'noData',
      statusFilter: 'active',
      counts: { active: 0, archived: 1, total: 1 },
    });
    expect(structured(result).competitors).toBeUndefined();
  });

  it('bounds the list to 100 rows and flags truncation', async () => {
    await getTestDb()
      .insert(competitorProfiles)
      .values(
        Array.from({ length: 105 }, (_, index) => ({
          accountId: ACCOUNT,
          siteId,
          origin: `https://c${index}.com`,
          registrableDomain: `c${String(index).padStart(3, '0')}.com`,
          source: 'manual' as const,
          status: 'active' as const,
        })),
      );
    const body = structured(await toolListCompetitors({ siteId }, context()));
    expect(body.competitors).toHaveLength(100);
    expect(body.truncated).toBe(true);
    expect(body.counts.total).toBe(105);
  });

  it('enforces cross-account, allowed-site and key-scope isolation with identical not-found errors', async () => {
    await seedProfile(siteId, 'a.com');
    const foreign = await seedSite(OTHER);
    const cross = await toolListCompetitors({ siteId: foreign }, context());
    expect(structured(cross).error.code).toBe('sites.errors.notFound');
    const blocked = await toolListCompetitors(
      { siteId },
      context({ permissions: { tools: {}, allowedSiteIds: [foreign], allowSpend: true } }),
    );
    expect(structured(blocked).error.code).toBe('sites.errors.notFound');
    const viaKey = await toolListCompetitors(
      { siteId },
      context({
        permissions: resolveEffectivePermissions(
          { allowedSiteIds: [siteId, foreign] },
          { allowedSiteIds: [foreign] },
          MCP_TOOL_NAMES,
        ),
      }),
    );
    expect(structured(viaKey).error.code).toBe('sites.errors.notFound');
    const invalid = await toolListCompetitors({ siteId: 'nope' }, context());
    expect(structured(invalid).error.code).toBe('mcp.errors.invalidInput');
    await Site.updateOne({ _id: siteId }, { $set: { deletionStartedAt: new Date() } });
    const deleted = await toolListCompetitors({ siteId }, context());
    expect(structured(deleted).error.code).toBe('sites.errors.notFound');
  });

  it('keeps reading while the site is paused and never writes profiles', async () => {
    await seedProfile(siteId, 'a.com');
    await Site.updateOne({ _id: siteId }, { $set: { paused: true } });
    const db = getTestDb();
    const before = await db.select().from(competitorProfiles);
    expect(structured(await toolListCompetitors({ siteId }, context())).status).toBe('ok');
    expect(structured(await toolListCompetitors({ siteId, status: 'all' }, context())).status).toBe(
      'ok',
    );
    expect(await db.select().from(competitorProfiles)).toEqual(before);
  });
});
