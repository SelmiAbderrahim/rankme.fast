/**
 * One crawl, one definition of "a page", and no false broken links. Fixture: a seven-locale site with a language switcher on every home
 * page, redirecting addresses (`/` → `/en`, `/pricing` → `/en/pricing`) that
 * carry Search Console impressions, a duplicate `http://www.` address, a PDF
 * and one real 404.
 */
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gscSearchAnalytics } from '../../db/schema/gsc.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import type { AuditPage, AuditResult } from '../../shared/providers/index.js';
import type { PageProber, PageProbeResult } from '../../shared/security/site-probe.js';
import { Site } from '../sites/index.js';
import { listSources } from '../schema-generator/schema-generator.service.js';
import type { PagesFallbackRefreshService } from '../pages/fallback-refresh.service.js';
import { createPagesService } from '../pages/pages.service.js';
import { AuditRun } from './audit-run.model.js';
import { AuditedPage } from './audited-page.model.js';
import { verifyBrokenLinks } from './crawl-evidence.js';
import { inventoryPageKey, readLatestCompletedPageInventory } from './page-inventory.service.js';
import { brokenInternalLinksRule } from './rules/broken-internal-links.js';

const BASE = 'https://episodebrief.example';
const LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'ru', 'zh'] as const;
const NOW = new Date('2026-10-18T12:00:00.000Z');

/** Seven locale homes plus `/en/pricing`: eight pages. */
const PAGE_URLS = [...LOCALES.map((locale) => `${BASE}/${locale}`), `${BASE}/en/pricing`];

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopMemoryMongo();
  await stopTestPostgres();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

async function seedCrawl(): Promise<{ accountId: string; siteId: string }> {
  const accountId = new mongoose.Types.ObjectId().toHexString();
  const site = await Site.create({ accountId, url: `${BASE}/`, domain: 'episodebrief.example', label: 'EB' });
  const run = await AuditRun.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    siteId: site._id,
    kind: 'site',
    pageCap: 200,
    status: 'succeeded',
    finishedAt: new Date('2026-10-16T00:00:00.000Z'),
  });
  const page = (url: string, extra: Record<string, unknown> = {}) => ({
    runId: run._id,
    url,
    statusCode: 200,
    title: `Title ${url}`,
    onPageScore: 90,
    contentType: 'text/html',
    ...extra,
  });
  await AuditedPage.create([
    ...PAGE_URLS.map((url) => page(url)),
    page(`${BASE}/`, { statusCode: 301, finalUrl: `${BASE}/en`, redirectChain: [{ url: `${BASE}/`, status: 301 }] }),
    page(`${BASE}/pricing`, {
      statusCode: 301,
      finalUrl: `${BASE}/en/pricing`,
      redirectChain: [{ url: `${BASE}/pricing`, status: 301 }],
    }),
    // The same page crawled at a second address.
    page('http://www.episodebrief.example/en/pricing'),
    page(`${BASE}/files/press-kit.pdf`, {
      contentType: 'application/pdf',
      isIndexable: false,
      nonIndexableReason: 'non_html',
      fetchFailure: { kind: 'non_html', contentType: 'application/pdf' },
    }),
    page(`${BASE}/en/old`, { statusCode: 404, isIndexable: false, nonIndexableReason: 'http_error' }),
  ]);
  return { accountId, siteId: String(site._id) };
}

async function seedGsc(accountId: string, siteId: string) {
  const rows = [
    { url: `${BASE}/pricing`, impressions: 100 },
    { url: `${BASE}/en/pricing`, impressions: 50 },
    { url: `${BASE}/ar`, impressions: 30 },
  ];
  for (const row of rows) {
    await getTestDb().insert(gscSearchAnalytics).values({
      accountId,
      siteId,
      bindingGenerationId: 'legacy',
      snapshotDate: '2026-10-15',
      dimensionSet: 'page',
      windowDays: 28,
      dimensionKey: row.url,
      clicks: 1,
      impressions: row.impressions,
      ctr: 1 / row.impressions,
      position: 10,
      fetchedAt: NOW,
    });
  }
}

describe('one page inventory', () => {
  it('Pages and Schema markup count the same eight pages, locale versions included', async () => {
    const { accountId, siteId } = await seedCrawl();
    await seedGsc(accountId, siteId);
    const inventory = await readLatestCompletedPageInventory(accountId, siteId);
    expect(inventory.fetchedCount).toBe(13);

    const pages = createPagesService({
      db: getTestDb() as never,
      cursorSecret: 'test-master-key-with-at-least-thirty-two-characters',
      providerSelection: 'dataforseo',
      fallbackRefresh: { refresh: vi.fn() } as unknown as PagesFallbackRefreshService,
      now: () => NOW,
      loadSite: vi.fn().mockResolvedValue({ id: siteId, url: `${BASE}/`, domain: 'episodebrief.example' }),
      resolveGscState: vi.fn().mockResolvedValue({
        usable: true,
        propertyUrl: 'sc-domain:episodebrief.example',
        propertyUrlHash: 'a'.repeat(64),
        bindingGenerationId: 'legacy',
        fallbackReason: null,
      }),
      readAudit: vi.fn().mockResolvedValue(inventory),
    });
    const list = await pages.list(accountId, siteId, {
      range: '28d',
      sort: 'opportunity',
      limit: 50,
    } as never);
    expect(list.envelope.coverage.inventoryPages).toBe(PAGE_URLS.length);
    // Redirect addresses with impressions count toward their page once.
    expect(list.summary.impressions).toBe(180);

    const schema = await listSources({ accountId, siteId });
    expect(schema.auditedPages).toHaveLength(PAGE_URLS.length);
    expect(schema.auditedPages.map((row) => inventoryPageKey(row.url)).sort()).toEqual(
      PAGE_URLS.map(inventoryPageKey).sort(),
    );
  });

  it('keys a page by host and path, and leaves an unparseable address as it is', () => {
    expect(inventoryPageKey('http://WWW.Example.com/en/')).toBe('example.com/en');
    expect(inventoryPageKey('https://example.com')).toBe('example.com/');
    expect(inventoryPageKey('not a url')).toBe('not a url');
  });
});

describe('broken internal links', () => {
  const auditPage = (url: string, brokenLinks: string[]): AuditPage => ({
    url,
    statusCode: 200,
    title: null,
    metaDescription: null,
    h1: [],
    h2: [],
    canonical: null,
    hasStructuredData: false,
    structuredDataErrors: [],
    isIndexable: true,
    brokenLinks,
    onPageScore: 90,
  });
  const result = (pagesList: AuditPage[]): AuditResult => ({ pages: pagesList }) as unknown as AuditResult;
  const prober = (answers: Record<string, Partial<PageProbeResult>>): PageProber => ({
    probe: vi.fn(async (url: string) => ({
      url,
      statusCode: null,
      finalUrl: null,
      redirectChain: [],
      contentType: 'text/html',
      failure: null,
      ...answers[url],
    })),
  });

  it('clears a language switcher link that redirects to a 200 and reports the real 404 with target and status', async () => {
    const crawled = LOCALES.map((locale) =>
      auditPage(`${BASE}/${locale}`, [`${BASE}/pricing`, ...(locale === 'en' ? [`${BASE}/en/old`] : [])]),
    );
    await verifyBrokenLinks(crawled, {
      outOfBudget: () => false,
      prober: prober({
        [`${BASE}/pricing`]: {
          statusCode: 200,
          finalUrl: `${BASE}/en/pricing`,
          redirectChain: [{ url: `${BASE}/pricing`, status: 301 }],
        },
        [`${BASE}/en/old`]: { statusCode: 404, finalUrl: `${BASE}/en/old` },
      }),
    });
    const finding = brokenInternalLinksRule.evaluate(result(crawled));
    expect(finding).toMatchObject({ bucket: 'fix-now', affectedUrls: [`${BASE}/en`] });
    expect(finding.meta).toMatchObject({ brokenLinkTargets: [`${BASE}/en/old`], confirmedTargets: 1 });
    const english = crawled.find((row) => row.url === `${BASE}/en`)!;
    expect(english.brokenLinkEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: `${BASE}/en/old`, status: 404, outcome: 'confirmed' }),
        expect.objectContaining({ target: `${BASE}/pricing`, status: 200, outcome: 'cleared' }),
      ]),
    );
  });

  it('turns a link the site refuses only to our check (403) into a watch item, not fix-now', async () => {
    const crawled = LOCALES.map((locale) => auditPage(`${BASE}/${locale}`, [`${BASE}/${locale}/pricing`]));
    await verifyBrokenLinks(crawled, {
      outOfBudget: () => false,
      prober: prober(
        Object.fromEntries(LOCALES.map((locale) => [`${BASE}/${locale}/pricing`, { statusCode: 403 }])),
      ),
    });
    const finding = brokenInternalLinksRule.evaluate(result(crawled));
    expect(finding).toMatchObject({ bucket: 'watch', severity: 'warning' });
    expect(finding.affectedUrls).toHaveLength(LOCALES.length);
    expect(finding.meta).toMatchObject({ unverifiedTargets: LOCALES.length, confirmedTargets: 0 });

    // A target the crawler reported but we never re-requested keeps its verdict.
    const unchecked = [auditPage(`${BASE}/en`, [`${BASE}/en/gone`])];
    expect(brokenInternalLinksRule.evaluate(result(unchecked))).toMatchObject({ bucket: 'fix-now' });

    // A timeout is inconclusive too.
    const timedOut = [auditPage(`${BASE}/en`, [`${BASE}/en/slow`])];
    await verifyBrokenLinks(timedOut, {
      outOfBudget: () => false,
      prober: prober({ [`${BASE}/en/slow`]: { failure: { kind: 'timeout' } as PageProbeResult['failure'] } }),
    });
    expect(brokenInternalLinksRule.evaluate(result(timedOut))).toMatchObject({ bucket: 'watch' });
  });
});
