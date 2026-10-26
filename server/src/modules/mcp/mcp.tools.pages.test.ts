/* eslint-disable @typescript-eslint/no-explicit-any -- tool results are asserted as loose JSON */
/**
 * `list_pages` / `get_page_detail` stored-read tools.
 *
 * Real in-memory Mongo + PGlite; the Pages service is the real one, with only
 * its audit-inventory and GSC-state readers injected (through the barrel mock
 * below) so the canonical crawl / associated-query states can be seeded.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PagesBarrelModule from '../pages/index.js';
type PagesBarrel = typeof PagesBarrelModule;

const h = vi.hoisted(() => ({
  db: null as unknown,
  overrides: {} as Record<string, unknown>,
  service: null as unknown,
  created: 0,
}));

vi.mock('../api-keys/index.js', () => ({ getApiKeysDb: () => h.db }));

vi.mock('../pages/index.js', async () => {
  const actual = await vi.importActual<PagesBarrel>('../pages/index.js');
  return {
    ...actual,
    createPagesService: (deps: Parameters<typeof actual.createPagesService>[0]) => {
      h.created += 1;
      // The stored-only service must be handed a refusing refresh port.
      expect(() => deps.fallbackRefresh.refresh({} as never)).toThrow(/never refresh/);
      expect(deps.syncGsc).toBeUndefined();
      return (
        (h.service as ReturnType<typeof actual.createPagesService> | null) ??
        actual.createPagesService({ ...deps, ...h.overrides })
      );
    },
  };
});

// Enter through the module barrel first: it fixes the evaluation order of the
// registry <-> mcp-permissions import cycle (see index.ts).
import { MCP_INPUT_SCHEMAS, MCP_TOOL_NAMES } from './index.js';
import { vendorCache, vendorResponses } from '../../db/schema/vendor-cache.js';
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
import {
  PagesError,
  canonicalizePageUrl,
  createPagesRepository,
} from '../pages/index.js';
import type { AuditPageInventory } from '../audits/index.js';
// Enter through the module barrel: it fixes the evaluation order of the
// registry <-> mcp-permissions import cycle (see index.ts).
import { toolGetPageDetail, toolListPages } from './mcp.tools.pages.js';
import type { McpToolContext } from './mcp.tools.js';

const ACCOUNT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const NOW = new Date();

let siteId = '';
let audit: AuditPageInventory = emptyAudit();
let gscReason: string = 'gsc_not_connected';

function emptyAudit(rows: AuditPageInventory['rows'] = []): AuditPageInventory {
  return { runId: 'audit-1', rows, fetchedCount: rows.length, truncated: false };
}

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

async function seedSite(accountId = ACCOUNT, extra: Record<string, unknown> = {}) {
  const site = await Site.create({
    accountId,
    url: 'https://example.com/',
    domain: 'example.com',
    label: 'Example',
    ...extra,
  });
  return String(site._id);
}

function page(url: string) {
  const result = canonicalizePageUrl(url, 'https://example.com/');
  if (!result.ok) throw new Error('must canonicalize');
  return result.value;
}

async function seedSnapshot(
  rows: Array<{ url: string; keyword: string; position: number }>,
  observedAt = NOW,
  sequence = 1,
) {
  return createPagesRepository(getTestDb() as never, { now: () => NOW }).writeSuccessfulSnapshot({
    accountId: ACCOUNT,
    siteId,
    source: 'demo',
    locationCode: 2840,
    languageCode: 'en',
    observedAt,
    cacheFetchedAt: observedAt,
    cacheStatus: 'miss',
    payloadFingerprint: sequence.toString(16).padStart(64, '0'),
    sourceRowsFetched: rows.length,
    acceptedCount: rows.length,
    droppedCount: 0,
    malformedUrlCount: 0,
    offsiteUrlCount: 0,
    duplicateUrlCount: 0,
    invalidMetricCount: 0,
    sourceTruncated: false,
    keywords: rows.map((row) => ({
      ...page(row.url),
      keyword: row.keyword,
      position: row.position,
      searchVolume: 100,
      difficulty: 20,
      estimatedTraffic: 10,
    })),
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
  h.service = null;
  h.created = 0;
  audit = emptyAudit();
  gscReason = 'gsc_not_connected';
  h.overrides = {
    readAudit: async () => audit,
    resolveGscState: async () => ({
      usable: false,
      propertyUrl: null,
      propertyUrlHash: null,
      bindingGenerationId: null,
      fallbackReason: gscReason,
    }),
  };
  // The site work lease also takes an account lease, which needs the account row.
  await User.create([
    { _id: ACCOUNT, email: 'pages-owner@example.com' },
    { _id: OTHER, email: 'pages-other@example.com' },
  ]);
  siteId = await seedSite();
});

/** Row counts of the vendor cache + archive: a stored read must not write either. */
async function spendSnapshot() {
  const db = getTestDb();
  return {
    cache: (await db.select().from(vendorCache)).length,
    archive: (await db.select().from(vendorResponses)).length,
  };
}

describe('list_pages', () => {
  it('is registered as a strict, zero-spend zod tool', () => {
    expect(MCP_TOOL_NAMES).toContain('list_pages');
    expect(MCP_TOOL_NAMES).toContain('get_page_detail');
    expect(
      MCP_INPUT_SCHEMAS.list_pages.safeParse({ siteId, limit: 10 }).success,
    ).toBe(false);
    expect(MCP_INPUT_SCHEMAS.list_pages.safeParse({ siteId, extra: 1 }).success).toBe(false);
    expect(MCP_INPUT_SCHEMAS.list_pages.safeParse({ siteId, limit: '50' }).success).toBe(true);
    expect(MCP_INPUT_SCHEMAS.get_page_detail.safeParse({ siteId, pageId: 'short' }).success).toBe(
      false,
    );
  });

  it('reports a site with no data as empty with an explicit Google reason (not zeros)', async () => {
    const result = await toolListPages({ siteId }, context());
    expect(result.isError).toBeUndefined();
    expect(structured(result)).toMatchObject({
      status: 'empty',
      reason: 'googleNotConnected',
      range: '28d',
      envelope: { status: 'empty', fallbackReason: 'gsc_not_connected', source: 'none' },
    });
    expect(structured(result).pages).toBeUndefined();
  });

  it.each([
    ['gsc_needs_reconnect', 'googleReconnect'],
    ['gsc_revoked', 'googleReconnect'],
    ['gsc_property_unmatched', 'gscPropertyMismatch'],
  ])('reports %s as empty with reason %s — a setup state, not a failure', async (fallbackReason, reason) => {
    gscReason = fallbackReason;
    const result = await toolListPages({ siteId, range: '7d' }, context());
    expect(structured(result)).toMatchObject({ status: 'empty', reason, range: '7d' });
  });

  it('uses the crawl reason when stored data is missing for another cause', async () => {
    h.service = {
      list: async () => ({
        envelope: {
          source: 'none',
          status: 'empty',
          fallbackReason: null,
          observedAt: null,
          staleAt: null,
          range: '28d',
          rangeSemantics: 'point_in_time',
          comparison: { label: 'since_previous_sync', previousObservedAt: null },
          dataWindow: null,
          market: null,
          coverage: {},
        },
        summary: {},
        items: [],
        pageInfo: { totalInventory: 0 },
      }),
    };
    const result = await toolListPages({ siteId }, context());
    expect(structured(result)).toMatchObject({ status: 'empty', reason: 'noCrawl' });
  });

  it('reports a failed sync with no stored pages as unavailable, not empty', async () => {
    h.service = {
      list: async () => ({
        envelope: {
          source: 'none',
          status: 'unavailable',
          fallbackReason: null,
          observedAt: null,
          staleAt: null,
          range: '28d',
          rangeSemantics: 'point_in_time',
          comparison: { label: 'since_previous_sync', previousObservedAt: null },
          dataWindow: null,
          market: null,
          coverage: {},
        },
        summary: {},
        items: [],
        pageInfo: { totalInventory: 0 },
      }),
    };
    const result = await toolListPages({ siteId }, context());
    expect(structured(result)).toMatchObject({ status: 'unavailable', envelope: { status: 'unavailable' } });
    expect(structured(result).pages).toBeUndefined();
  });

  it('returns canonical crawl and associated-query states for crawled-only and measured pages', async () => {
    audit = emptyAudit([
      {
        url: 'https://example.com/a',
        title: 'Alpha <b onclick=x>page</b>',
        isIndexable: true,
        nonIndexableReason: null,
        onPageScore: 90,
        statusCode: 200,
      },
      {
        url: 'https://example.com/old',
        title: null,
        isIndexable: true,
        nonIndexableReason: null,
        onPageScore: null,
        statusCode: 301,
        finalUrl: 'https://example.com/new',
        redirectChain: [{ url: 'https://example.com/old', status: 301 }],
      },
      {
        url: 'https://example.com/gone',
        title: null,
        isIndexable: false,
        nonIndexableReason: null,
        onPageScore: null,
        fetchFailure: { kind: 'timeout' },
      },
      {
        url: 'https://example.com/en/pricing',
        title: 'Pricing',
        isIndexable: true,
        nonIndexableReason: null,
        onPageScore: 80,
        statusCode: 200,
      },
      {
        url: 'https://example.com/private',
        title: 'Private',
        isIndexable: false,
        nonIndexableReason: 'noindex',
        onPageScore: 10,
        statusCode: 200,
      },
    ]);
    await seedSnapshot([
      { url: 'https://example.com/a', keyword: 'alpha shoes', position: 4 },
      { url: 'https://example.com/gone', keyword: 'gone page', position: 9 },
      { url: 'https://example.com/private', keyword: 'private page', position: 12 },
      { url: 'https://example.com/pricing', keyword: 'pricing', position: 7 },
    ]);
    const result = await toolListPages({ siteId, sort: 'url', direction: 'asc' }, context());
    const body = structured(result);
    expect(body.status).toBe('ok');
    expect(body.truncated).toBe(false);
    expect(body.envelope).toMatchObject({ source: 'demo', range: '28d' });
    const byUrl = Object.fromEntries(
      body.pages.map((row: { url: string }) => [row.url, row]),
    ) as Record<string, any>;
    expect(byUrl['https://example.com/a']).toMatchObject({
      crawlState: 'indexable',
      performanceSource: 'demo',
      associatedQueryState: 'observed',
      metrics: { associatedQueryCount: 1 },
    });
    expect(byUrl['https://example.com/a'].pageId).toMatch(/^page:[A-Za-z0-9_-]{43}$/);
    expect(byUrl['https://example.com/a'].title).not.toContain('<');
    expect(byUrl['https://example.com/pricing']).toMatchObject({
      crawledAs: 'example.com/en/pricing',
      title: 'Pricing',
    });
    expect(byUrl['https://example.com/old']).toMatchObject({
      crawlState: 'redirected',
      crawlEvidence: { finalUrl: 'https://example.com/new', statusCode: 301 },
      associatedQueryState: 'unavailable',
      metrics: { associatedQueryCount: null },
    });
    expect(byUrl['https://example.com/gone']).toMatchObject({
      crawlState: 'failed',
      crawlEvidence: { failure: { kind: 'timeout' } },
    });
    expect(byUrl['https://example.com/private']).toMatchObject({
      crawlState: 'non_indexable',
      nonIndexableReason: 'noindex',
    });
    expect(body.pageInfo).toMatchObject({ totalInventory: 6, hasNext: false });
    expect(body.pageInfo.totalMeasured).toBe(4);
  });

  it('applies filters, bounds rows to the page size, and pages with a cursor the output scan accepts', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      url: `https://example.com/p${String(index).padStart(2, '0')}`,
      keyword: `keyword ${index}`,
      position: index + 1,
    }));
    await seedSnapshot(rows);
    const first = structured(
      await toolListPages({ siteId, sort: 'url', direction: 'asc', limit: 25 }, context()),
    );
    expect(first.pages).toHaveLength(25);
    expect(first.pageInfo).toMatchObject({ hasNext: true, totalFiltered: 30 });
    expect(typeof first.pageInfo.nextCursor).toBe('string');
    const second = structured(
      await toolListPages(
        { siteId, sort: 'url', direction: 'asc', limit: 25, cursor: first.pageInfo.nextCursor },
        context(),
      ),
    );
    expect(second.status).toBe('ok');
    expect(second.pages).toHaveLength(5);
    expect(second.pages[0].url).toBe('https://example.com/p25');

    const filtered = structured(
      await toolListPages(
        {
          siteId,
          q: 'p03',
          insight: 'low_data',
          indexability: 'indexable',
          visibility: 'measured',
          range: '90d',
        },
        context(),
      ),
    );
    expect(filtered.range).toBe('90d');
    expect(filtered.pageInfo.limit).toBe(25);
  });

  it('turns a tampered cursor into a plain invalid-input tool error', async () => {
    await seedSnapshot([{ url: 'https://example.com/a', keyword: 'k', position: 3 }]);
    const result = await toolListPages({ siteId, cursor: 'forged.cursor' }, context());
    expect(result.isError).toBe(true);
    expect(structured(result).error.code).toBe('mcp.errors.invalidInput');
  });

  it('answers cross-account, foreign-allowed-site, deleted and malformed requests with the same not-found/invalid errors', async () => {
    const foreign = await seedSite(OTHER);
    const crossAccount = await toolListPages({ siteId: foreign }, context());
    expect(crossAccount.isError).toBe(true);
    expect(structured(crossAccount).error.code).toBe('sites.errors.notFound');

    const blocked = await toolListPages(
      { siteId },
      context({ permissions: { tools: {}, allowedSiteIds: [foreign], allowSpend: true } }),
    );
    expect(structured(blocked).error.code).toBe('sites.errors.notFound');

    const intersected = resolveEffectivePermissions(
      { allowedSiteIds: [siteId, foreign] },
      { allowedSiteIds: [foreign] },
      MCP_TOOL_NAMES,
    );
    const viaKey = await toolListPages({ siteId }, context({ permissions: intersected }));
    expect(structured(viaKey).error.code).toBe('sites.errors.notFound');

    await Site.updateOne({ _id: siteId }, { $set: { deletionStartedAt: new Date() } });
    const deleted = await toolListPages({ siteId }, context());
    expect(structured(deleted).error.code).toBe('sites.errors.notFound');

    const malformed = await toolListPages({ siteId: 'nope' }, context());
    expect(structured(malformed).error.code).toBe('mcp.errors.invalidInput');
    expect(h.created).toBe(0);
  });

  it('keeps reading stored pages while the site is paused', async () => {
    await Site.updateOne({ _id: siteId }, { $set: { paused: true } });
    await seedSnapshot([{ url: 'https://example.com/a', keyword: 'k', position: 3 }]);
    expect(structured(await toolListPages({ siteId }, context())).status).toBe('ok');
  });

  it('writes nothing to the vendor cache and calls no refresh port', async () => {
    await seedSnapshot([{ url: 'https://example.com/a', keyword: 'k', position: 3 }]);
    const before = await spendSnapshot();
    await toolListPages({ siteId }, context());
    await toolListPages({ siteId, range: '7d' }, context());
    expect(await spendSnapshot()).toEqual(before);
    expect(h.created).toBe(2);
  });
});

describe('get_page_detail', () => {
  async function firstPageRef(): Promise<string> {
    const list = structured(await toolListPages({ siteId }, context()));
    return list.pages[0].pageId as string;
  }

  it('returns page detail, bounded associated rows and a trend; accepts the bare hash too', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({
      url: 'https://example.com/a',
      keyword: `query ${index}`,
      position: (index % 20) + 1,
    }));
    await seedSnapshot(rows, new Date(NOW.getTime() - 86_400_000), 1);
    await seedSnapshot(rows, NOW, 2);
    const ref = await firstPageRef();
    const result = await toolGetPageDetail({ siteId, pageId: ref, range: '90d' }, context());
    const body = structured(result);
    expect(body.status).toBe('ok');
    expect(body.range).toBe('90d');
    expect(body.page).toMatchObject({
      pageId: ref,
      crawlState: 'not_in_crawl',
      associatedQueryState: 'observed',
    });
    expect(body.associated).toMatchObject({ kind: 'keywords', total: 60 });
    expect(body.associated.rows).toHaveLength(50);
    expect(body.truncated).toBe(true);
    expect(body.trend.length).toBeGreaterThan(0);

    const bare = await toolGetPageDetail({ siteId, pageId: ref.slice('page:'.length) }, context());
    expect(structured(bare).page.pageId).toBe(ref);
    expect(structured(bare).range).toBe('28d');
  });

  it('is not truncated for a small associated list and reports an unmeasured crawled page', async () => {
    audit = emptyAudit([
      {
        url: 'https://example.com/only-crawled',
        title: 'Only crawled',
        isIndexable: true,
        nonIndexableReason: null,
        onPageScore: 70,
        statusCode: 200,
      },
    ]);
    const ref = await firstPageRef();
    const body = structured(await toolGetPageDetail({ siteId, pageId: ref }, context()));
    expect(body.truncated).toBe(false);
    expect(body.associated).toMatchObject({ kind: 'none', total: 0, rows: [] });
    expect(body.page).toMatchObject({
      crawlState: 'indexable',
      associatedQueryState: 'unavailable',
      metrics: { associatedQueryCount: null },
    });
  });

  it('answers an unknown page id with a page-not-found tool error', async () => {
    const result = await toolGetPageDetail({ siteId, pageId: 'A'.repeat(43) }, context());
    expect(result.isError).toBe(true);
    expect(structured(result).error.code).toBe('pages.errors.pageNotFound');
  });

  it('maps unexpected Pages errors to not-found and rethrows non-Pages failures as internal errors', async () => {
    h.service = {
      detail: async () => {
        throw new PagesError(503, 'PAGES_GSC_UNAVAILABLE', 'pages.errors.gscUnavailable');
      },
    };
    const mapped = await toolGetPageDetail({ siteId, pageId: 'A'.repeat(43) }, context());
    expect(structured(mapped).error.code).toBe('sites.errors.notFound');
    h.service = {
      detail: async () => {
        throw new TypeError('boom');
      },
    };
    const internal = await toolGetPageDetail({ siteId, pageId: 'A'.repeat(43) }, context());
    expect(structured(internal).error.code).toBe('common.internalError');
  });

  it('enforces cross-account and allowed-site isolation and never spends', async () => {
    await seedSnapshot([{ url: 'https://example.com/a', keyword: 'k', position: 3 }]);
    const ref = await firstPageRef();
    const foreign = await seedSite(OTHER);
    const cross = await toolGetPageDetail({ siteId: foreign, pageId: ref }, context());
    expect(structured(cross).error.code).toBe('sites.errors.notFound');
    const blocked = await toolGetPageDetail(
      { siteId, pageId: ref },
      context({ permissions: { tools: {}, allowedSiteIds: [foreign], allowSpend: true } }),
    );
    expect(structured(blocked).error.code).toBe('sites.errors.notFound');
    const before = await spendSnapshot();
    await toolGetPageDetail({ siteId, pageId: ref }, context());
    expect(await spendSnapshot()).toEqual(before);
  });
});
