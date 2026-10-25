/**
 * Deep crawl at the pipeline level.
 *
 *  1. On the fake provider, one audit posted with the resource scan produces a
 *     non-passing finding for every deep crawl rule, and the page facts reach
 *     `audited_pages` and the Pages detail read.
 *  2. On the live adapter (vendor mocked), every extra read failing still
 *     finishes the run; the affected checks are not evaluated with a cause.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Job } from 'bullmq';
import mongoose from 'mongoose';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isNotEvaluatedFinding } from '../../shared/audit-findings.js';
import { createFakeAuditProvider } from '../../shared/providers/index.js';
import { createDataForSeoOnPageAuditProvider } from '../../shared/providers/dataforseo/onpage.js';
import { vendorMockServer } from '../../shared/testing/fixtures/mock-vendor.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { Site } from '../sites/index.js';
import {
  AuditRun,
  AuditedPage,
  ReportSnapshot,
  createAuditProcessor,
  readLatestAuditPageDetail,
} from './index.js';

const logger = pino({ level: 'silent' });
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'testing', 'fixtures', 'dataforseo-onpage');
const fixture = (operation: string, kase: string): JsonBodyType =>
  JSON.parse(readFileSync(join(FIXTURES, operation, `${kase}.json`), 'utf8')) as JsonBodyType;

const DEEP_RULES = [
  'http-error-pages',
  'redirect-chains',
  'links-to-redirects',
  'meta-refresh-redirect',
  'canonical-chain-or-conflict',
  'orphan-pages',
  'deep-pages',
  'duplicate-titles',
  'duplicate-content',
  'placeholder-text',
  'mixed-content',
  'images-missing-alt',
  'slow-server-response',
  'large-pages',
  'uncompressed-pages',
  'render-blocking-resources',
  'html-basics-missing',
  'deprecated-html',
  'url-structure',
  'social-tags-missing',
  'favicon-missing',
  'broken-resources',
  'oversized-images',
  'uncached-static-resources',
] as const;
const RESOURCE_RULES = ['broken-resources', 'oversized-images', 'uncached-static-resources'];

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
beforeEach(() => clearCollections());

async function seed(resourceScan: boolean) {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({ accountId, url: 'https://example.com', domain: 'example.com' });
  const run = await AuditRun.create({ accountId, siteId: site._id, pageCap: 100, resourceScan });
  return { accountId: accountId.toHexString(), siteId: site.id as string, runId: run.id as string, pageCap: 100 };
}

const jobFor = (data: unknown): Job => ({ data, attemptsMade: 0, opts: { attempts: 3 } }) as unknown as Job;

async function findingsOf(runId: string) {
  const snapshot = await ReportSnapshot.findOne({ runId }).lean();
  return new Map(snapshot!.findings.map((finding) => [
    finding.ruleId,
    { ...finding, bucket: isNotEvaluatedFinding(finding) ? 'not-evaluated' : finding.bucket },
  ]));
}

describe('deep crawl on the fake provider', () => {
  it('one scanned audit produces a finding for every deep crawl rule', async () => {
    const ids = await seed(true);
    await createAuditProcessor({ provider: createFakeAuditProvider(), logger })(jobFor(ids));
    const findings = await findingsOf(ids.runId);
    for (const ruleId of DEEP_RULES) {
      const finding = findings.get(ruleId);
      expect(finding, ruleId).toBeDefined();
      expect(['fix-now', 'watch'], ruleId).toContain(finding!.bucket);
      expect(finding!.affectedUrls.length, ruleId).toBeGreaterThan(0);
    }
  });

  it('without the scan the resource checks are not evaluated, and every other one still fires', async () => {
    const ids = await seed(false);
    await createAuditProcessor({ provider: createFakeAuditProvider(), logger })(jobFor(ids));
    const findings = await findingsOf(ids.runId);
    for (const ruleId of RESOURCE_RULES) {
      expect(findings.get(ruleId), ruleId).toMatchObject({ bucket: 'not-evaluated', meta: { reason: 'scan-off' } });
    }
    for (const ruleId of DEEP_RULES.filter((rule) => !RESOURCE_RULES.includes(rule))) {
      expect(['fix-now', 'watch'], ruleId).toContain(findings.get(ruleId)!.bucket);
    }
  });

  it('stores the page facts and serves them, with the open issues, to the Pages detail read', async () => {
    const ids = await seed(true);
    await createAuditProcessor({ provider: createFakeAuditProvider(), logger })(jobFor(ids));
    const careUrl = 'https://example.com/guide/care?ref=nav';
    const stored = await AuditedPage.findOne({ runId: ids.runId, url: careUrl }).lean();
    expect(stored).toMatchObject({
      clickDepth: 6,
      pageSizeBytes: 3_400_000,
      serverResponseMs: 2_400,
      contentEncoding: null,
      checks: { placeholderText: true, orphan: true },
      socialTags: { openGraph: false, twitterCard: false },
    });

    const detail = await readLatestAuditPageDetail(ids.accountId, ids.siteId, (url) => url === careUrl, 'fr');
    expect(detail?.facts).toEqual({ clickDepth: 6, inboundInternalLinks: 0, pageSizeBytes: 3_400_000, serverResponseMs: 2_400 });
    const issueIds = detail!.issues.map((issue) => issue.ruleId);
    expect(issueIds).toEqual(expect.arrayContaining(['placeholder-text', 'orphan-pages', 'deep-pages', 'duplicate-titles']));
    expect(issueIds).not.toContain('broken-resources');
    expect(detail!.issues.find((issue) => issue.ruleId === 'placeholder-text')).toMatchObject({ bucket: 'fix-now', severity: 'critical' });
    expect(detail!.issues.every((issue) => issue.title.length > 0)).toBe(true);

    // The home page loads the broken and the oversized image: those resource findings name it.
    const home = await readLatestAuditPageDetail(ids.accountId, ids.siteId, (url) => url.replace(/\/$/, '') === 'https://example.com', 'en');
    expect(home!.issues.map((issue) => issue.ruleId)).toEqual(expect.arrayContaining(['broken-resources', 'oversized-images']));
  });
});

describe('deep crawl on the live adapter with every extra read failing', () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => vendorMockServer.resetHandlers());
  afterAll(() => vendorMockServer.close());

  it('the run still finishes; the read-backed checks are not evaluated with the vendor cause', async () => {
    const quota = () => HttpResponse.json(fixture('duplicate-tags', 'quota'));
    vendorMockServer.use(
      http.post('*/on_page/task_post', () => HttpResponse.json(fixture('task-post', 'success'))),
      http.get('*/on_page/summary/*', () => HttpResponse.json(fixture('summary', 'success'))),
      http.post('*/on_page/pages', () => HttpResponse.json(fixture('pages', 'deep-signals'))),
      http.post('*/on_page/links', () => HttpResponse.json(fixture('links', 'empty'))),
      http.post('*/on_page/non_indexable', () => HttpResponse.json(fixture('non-indexable', 'empty'))),
      http.post('*/on_page/duplicate_tags', quota),
      http.post('*/on_page/redirect_chains', quota),
      http.post('*/on_page/duplicate_content', quota),
      http.post('*/on_page/waterfall', quota),
      http.post('*/on_page/resources', quota),
      http.post('*/on_page/pages_by_resource', quota),
    );
    const provider = createDataForSeoOnPageAuditProvider({
      login: 'sandbox-login',
      password: 'sandbox-password',
      baseUrl: 'https://dataforseo.mock/v3',
      timeoutMs: 200,
      maxRetries: 0,
      backoffBaseMs: 1,
      random: () => 0,
    });
    const ids = await seed(true);
    const outcome = await createAuditProcessor({ provider, logger, pollIntervalMs: 0, sleep: async () => undefined })(
      jobFor(ids),
    );
    expect(outcome.pagesCrawled).toBeGreaterThan(0);
    expect((await AuditRun.findById(ids.runId))?.status).toBe('succeeded');
    const findings = await findingsOf(ids.runId);
    expect(findings.get('broken-resources')).toMatchObject({
      bucket: 'not-evaluated',
      meta: { reason: 'unavailable', cause: 'vendor-error' },
    });
    // The page flags still answer: a failed tag or chain read narrows the evidence only.
    expect(findings.get('duplicate-titles')!.bucket).toBe('watch');
    expect(findings.get('redirect-chains')).toMatchObject({ bucket: 'watch', meta: { chainsNotRead: 'unavailable' } });
    expect(findings.get('duplicate-content')!.meta).toMatchObject({ unverifiedCount: 2 });
    expect(findings.get('placeholder-text')!.bucket).toBe('fix-now');
  });
});
