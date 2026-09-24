import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import express, { type Request } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import {
  backlinkRowSnapshots,
  keywords,
  rankings,
  serpObservations,
  vendorResponses,
} from '../../db/schema/index.js';
import { makeAuditResult } from '../audits/rules/fixtures.js';
import { AuditRun, writeReportSnapshot } from '../audits/index.js';
import { createApiKey, setApiKeysDb } from '../api-keys/index.js';
import { setRanksDb } from '../ranks/index.js';
import { Site } from '../sites/index.js';
import { errorHandler } from '../../shared/middleware/error-handler.js';
import { language } from '../../shared/middleware/language.js';
import {
  createApiIpRateLimiter,
  createApiRateLimiter,
  markTokenAuthenticated,
  resetAuthenticatedTokens,
} from '../../shared/middleware/rate-limit.js';
import { setRateLimitMetricsDb } from '../../shared/middleware/rate-limit-metrics.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
import { neutralizeExportCell, toCsv } from '../../shared/utils/csv.js';
import { DICTIONARIES, SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
import { createApiKeyAuth } from './api-key-auth.js';
import { assertPublicExportsEnabled, sendV1Csv, V1_CSV_CONTRACTS, wantsV1Csv } from './v1.csv.js';
import { decodeV1ExportCursor, encodeV1ExportCursor } from './v1.exports.service.js';
import {
  decodeV1LegacyCsvCursor,
  encodeV1LegacyCsvCursor,
  parseV1HistoryQuery,
} from './v1.schema.js';
import { v1Router } from './v1.routes.js';
import { v1ControllerTestables } from './v1.controller.js';
import { HttpError } from '../../shared/utils/http-error.js';

const app = createApp();
const ORIGINAL_EXPORT_FLAG = env.PUBLIC_EXPORTS_ENABLED;

type ServiceDb = Parameters<typeof createApiKey>[0];

function db(): ServiceDb {
  return getTestDb() as unknown as ServiceDb;
}

async function seedUserWithKey(email: string) {
  const user = await signupVerifiedUser(app, { email });
  const apiKey = await createApiKey(db(), {
    accountId: user.id,
    name: 'exports',
  });
  return { user, key: apiKey.key };
}

async function seedSite(accountId: string, domain: string) {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

async function seedKeyword(
  accountId: string,
  siteId: string,
  phrase: string,
  engine: 'google' | 'bing' = 'google',
) {
  const [keyword] = await getTestDb()
    .insert(keywords)
    .values({
      accountId,
      siteId,
      phrase,
      locationCode: 2840,
      languageCode: 'en',
      engine,
    })
    .returning();
  if (!keyword) throw new Error('keyword fixture insert failed');
  await getTestDb()
    .insert(rankings)
    .values({
      keywordId: keyword.id,
      engine,
      position: engine === 'google' ? 4 : 7,
      rankAbsolute: engine === 'google' ? 5 : 8,
      foundUrl: `https://${phrase.replace(/[^a-z]/gi, '') || 'result'}.example/result`,
      aiOverviewPresent: engine === 'google',
      aiCited: false,
      aiCitedUrl: null,
      checkedAt: new Date(`2026-07-0${engine === 'google' ? '1' : '2'}T00:00:00.000Z`),
      source: 'fresh',
    });
  return keyword;
}

async function seedKeywordPage(
  accountId: string,
  siteId: string,
  prefix: string,
  count: number,
  engine: 'google' | 'bing',
  createdAt: Date,
) {
  const inserted = await getTestDb()
    .insert(keywords)
    .values(
      Array.from({ length: count }, (_, index) => ({
        accountId,
        siteId,
        phrase: `${prefix}-${String(index).padStart(3, '0')}`,
        locationCode: 2840,
        languageCode: 'en',
        engine,
        createdAt,
        updatedAt: createdAt,
      })),
    )
    .returning();
  await getTestDb()
    .insert(rankings)
    .values(
      inserted.map((keyword, index) => ({
        keywordId: keyword.id,
        engine,
        position: index + 1,
        rankAbsolute: index + 2,
        foundUrl: `https://${prefix}.example/${index}`,
        aiOverviewPresent: engine === 'google',
        aiCited: false,
        aiCitedUrl: null,
        checkedAt: new Date('2026-08-05T12:00:00.000Z'),
        source: 'fresh' as const,
      })),
    );
  return inserted;
}

function csvDataLines(text: string): string[] {
  return text
    .split('\r\n')
    .slice(1)
    .filter((line) => line.length > 0);
}

function csvLeadingColumns(text: string, count: number): string[][] {
  return csvDataLines(text).map((line) => line.split(',').slice(0, count));
}

async function seedStoredRows(accountId: string, siteId: string, keywordId: string) {
  await getTestDb()
    .insert(serpObservations)
    .values([
      {
        accountId,
        siteId,
        keywordId,
        engine: 'google',
        checkedAt: new Date('2026-07-03T00:00:00.000Z'),
        source: 'fresh',
        features: {
          features: [{ type: 'featured_snippet', rankAbsolute: 1 }],
          featuredSnippet: {
            domain: 'example.com',
            url: 'https://example.com/snippet',
            title: '=stored title',
          },
          paa: [],
        },
        topResults: [
          {
            domain: 'example.com',
            url: 'https://example.com/result',
            rankGroup: 1,
            rankAbsolute: 1,
          },
        ],
        createdAt: new Date('2026-07-03T00:00:01.000Z'),
      },
      {
        accountId,
        siteId,
        keywordId,
        engine: 'google',
        checkedAt: new Date('2026-07-02T00:00:00.000Z'),
        source: 'cache',
        features: { features: [], featuredSnippet: null, paa: [] },
        topResults: [],
        createdAt: new Date('2026-07-02T00:00:01.000Z'),
      },
    ]);
  await getTestDb()
    .insert(backlinkRowSnapshots)
    .values([
      {
        reviewId: `review-new-${accountId}`,
        accountId,
        siteId,
        url: 'https://links.example/new',
        domain: 'links.example',
        spamScore: 61,
        rubricBand: 'toxic',
        rubricVersion: 'toxicity-rubric-v1',
        firstSeen: new Date('2026-06-01T00:00:00.000Z'),
        lastSeen: new Date('2026-07-03T00:00:00.000Z'),
        dofollow: true,
        isBroken: false,
        rationale: '=review this link',
        rationaleStatus: 'annotated',
        capturedAt: new Date('2026-07-03T00:00:00.000Z'),
      },
      {
        reviewId: `review-old-${accountId}`,
        accountId,
        siteId,
        url: 'https://links.example/old',
        domain: 'links.example',
        spamScore: 12,
        rubricBand: 'clean',
        rubricVersion: 'toxicity-rubric-v1',
        firstSeen: null,
        lastSeen: null,
        dofollow: false,
        isBroken: true,
        rationale: null,
        rationaleStatus: 'not_requested',
        capturedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]);
}

function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

beforeAll(async () => {
  await startMemoryMongo();
  const testDb = await startTestPostgres();
  installTestAuth();
  setApiKeysDb(testDb as unknown as never);
  setRanksDb(testDb as unknown as never);
  setRateLimitMetricsDb(testDb as unknown as never);
});

afterAll(async () => {
  env.PUBLIC_EXPORTS_ENABLED = ORIGINAL_EXPORT_FLAG;
  uninstallTestAuth();
  setApiKeysDb(null);
  setRanksDb(null);
  setRateLimitMetricsDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.restoreAllMocks();
  resetAuthenticatedTokens();
  env.PUBLIC_EXPORTS_ENABLED = true;
});

describe('CSV contract and negotiation', () => {
  it('uses the shared neutralizer for all six dangerous prefixes in every exported column', () => {
    const prefixes = ['=', '+', '-', '@', '\t', '\r'];
    for (const [endpoint, columns] of Object.entries(V1_CSV_CONTRACTS)) {
      for (const prefix of prefixes) {
        const row = Object.fromEntries(
          columns.map((column) => [column.key, `${prefix}${endpoint}-${column.key}`]),
        );
        const csv = toCsv([row], [...columns]);
        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(csv.endsWith('\r\n')).toBe(true);
        expect(csv.split('\r\n')[0]).toBe(
          `\uFEFF${columns.map((column) => column.header).join(',')}`,
        );
        for (const column of columns) {
          expect(csv).toContain(`'${prefix}${endpoint}-${column.key}`);
        }
      }
    }
  });

  it('pins shared RFC-4180 quoting and neutralization on a production contract', () => {
    const csv = toCsv(
      [
        {
          id: '=one,two',
          domain: 'he said "hello"\nnext',
          url: '+https://example.com',
          paused: false,
          created_at: '\rdate',
        },
      ],
      [...V1_CSV_CONTRACTS.sites],
    );
    expect(csv).toBe(
      '\uFEFFid,domain,url,paused,created_at\r\n"\'=one,two","he said ""hello""\nnext",\'+https://example.com,false,"\'\rdate"\r\n',
    );
    expect(neutralizeExportCell('\tvalue')).toBe("'\tvalue");
  });

  it('recognizes query and explicit Accept negotiation but not wildcards or q=0', () => {
    const req = (accept: string | undefined, accepted: string | false) =>
      ({
        get: () => accept,
        accepts: () => accepted,
      }) as unknown as Request;
    expect(wantsV1Csv(req(undefined, false), 'csv')).toBe(true);
    expect(wantsV1Csv(req(undefined, false))).toBe(false);
    expect(wantsV1Csv(req('*/*', 'text/csv'))).toBe(false);
    expect(wantsV1Csv(req('text/csv', 'text/csv'))).toBe(true);
    expect(wantsV1Csv(req('application/json, text/csv;q=0', false))).toBe(false);
  });

  it('sets stable CSV headers and the optional cursor header', () => {
    const set = vi.fn();
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const res = { set, status } as unknown as express.Response;
    sendV1Csv(res, 'rows.csv', [{ id: '1' }], [{ key: 'id', header: 'id' }], 'next');
    expect(set).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(set).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="rows.csv"');
    expect(set).toHaveBeenCalledWith('X-Next-Cursor', 'next');
    expect(send).toHaveBeenCalledWith('\uFEFFid\r\n1\r\n');

    set.mockClear();
    sendV1Csv(res, 'empty.csv', [], [{ key: 'id', header: 'id' }], null);
    expect(set).not.toHaveBeenCalledWith('X-Next-Cursor', expect.anything());
  });

  it('throws only when the public export flag is disabled', () => {
    expect(() => assertPublicExportsEnabled()).not.toThrow();
    env.PUBLIC_EXPORTS_ENABLED = false;
    expect(() => assertPublicExportsEnabled()).toThrow('publicApi.errors.exportsUnavailable');
  });
});

describe('existing list CSV and JSON compatibility', () => {
  it('serves every list endpoint through both CSV negotiation forms with stable headers', async () => {
    const { user, key } = await seedUserWithKey('all-csv@x.co');
    const siteId = await seedSite(user.id, 'csv.example.com');
    const keyword = await seedKeyword(user.id, siteId, '=formula phrase');
    await seedStoredRows(user.id, siteId, keyword.id);

    const endpoints = [
      {
        path: '/api/v1/sites',
        columns: V1_CSV_CONTRACTS.sites,
        file: 'rankme-sites.csv',
      },
      {
        path: `/api/v1/sites/${siteId}/rank-history`,
        columns: V1_CSV_CONTRACTS.rankHistory,
        file: 'rankme-rank-history.csv',
      },
      {
        path: '/api/v1/keywords',
        columns: V1_CSV_CONTRACTS.keywords,
        file: 'rankme-keywords.csv',
      },
      {
        path: `/api/v1/serp-features?siteId=${siteId}`,
        columns: V1_CSV_CONTRACTS.serpFeatures,
        file: 'rankme-serp-features.csv',
      },
      {
        path: `/api/v1/backlink-rows?siteId=${siteId}`,
        columns: V1_CSV_CONTRACTS.backlinkRows,
        file: 'rankme-backlink-rows.csv',
      },
    ];

    for (const endpoint of endpoints) {
      const separator = endpoint.path.includes('?') ? '&' : '?';
      const byQuery = await request(app)
        .get(`${endpoint.path}${separator}format=csv`)
        .set(bearer(key));
      const byAccept = await request(app)
        .get(endpoint.path)
        .set(bearer(key))
        .set('Accept', 'text/csv');
      for (const response of [byQuery, byAccept]) {
        expect(response.status, endpoint.path).toBe(200);
        expect(response.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/u);
        expect(response.headers['content-disposition']).toBe(
          `attachment; filename="${endpoint.file}"`,
        );
        expect(response.text.startsWith('\uFEFF')).toBe(true);
        expect(response.text.split('\r\n')[0]).toBe(
          `\uFEFF${endpoint.columns.map((column) => column.header).join(',')}`,
        );
      }
    }
  });

  it('returns byte-identical CSV across all seven bearer response languages', async () => {
    const { user, key } = await seedUserWithKey('csv-locales@x.co');
    await seedSite(user.id, 'raw-source.example.com');
    let baseline: string | undefined;

    for (const locale of SUPPORTED_LOCALES) {
      const response = await request(app)
        .get('/api/v1/sites?format=csv')
        .set(bearer(key))
        .set('x-lang', locale)
        .set('Cookie', 'lang=fr');
      expect(response.status).toBe(200);
      expect(response.headers['content-language']).toBe(locale);
      expect(response.headers.vary).toContain('x-lang');
      expect(response.headers.vary).toContain('Accept-Language');
      expect(response.headers.vary).not.toContain('Cookie');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="rankme-sites.csv"',
      );
      expect(response.text.startsWith('\uFEFF')).toBe(true);
      if (baseline === undefined) baseline = response.text;
      else expect(response.text).toBe(baseline);
    }
  });

  it('keeps the shipped sites/rank-history/keywords/report JSON bytes and keys unchanged', async () => {
    const { user, key } = await seedUserWithKey('json-bytes@x.co');
    const siteId = await seedSite(user.id, 'bytes.example.com');
    await seedKeyword(user.id, siteId, 'bytes');
    const run = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(user.id),
      siteId: new mongoose.Types.ObjectId(siteId),
      pageCap: 100,
      status: 'succeeded',
    });
    await writeReportSnapshot({
      runId: String(run._id),
      siteId,
      accountId: user.id,
      result: makeAuditResult(),
    });

    const sites = await request(app).get('/api/v1/sites').set(bearer(key));
    expect(Object.keys(sites.body)).toEqual(['sites']);
    expect(Object.keys(sites.body.sites[0])).toEqual([
      'id',
      'domain',
      'url',
      'paused',
      'createdAt',
    ]);
    expect(sites.text).toBe(JSON.stringify({ sites: sites.body.sites }));

    const history = await request(app).get(`/api/v1/sites/${siteId}/rank-history`).set(bearer(key));
    expect(Object.keys(history.body)).toEqual(['keywords']);
    expect(Object.keys(history.body.keywords[0])).toEqual(['id', 'phrase', 'series']);
    expect(Object.keys(history.body.keywords[0].series[0])).toEqual([
      'checkedAt',
      'position',
      'rankAbsolute',
      'source',
      'foundUrl',
      'aiOverviewPresent',
      'aiCited',
      'aiCitedUrl',
    ]);
    expect(history.text).not.toContain('observationMeta');
    expect(history.text).toBe(JSON.stringify({ keywords: history.body.keywords }));
    const historyWithCsvPagingKeys = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history?limit=0&cursor=not-base64`)
      .set(bearer(key));
    expect(historyWithCsvPagingKeys.text).toBe(history.text);

    const keywordList = await request(app).get('/api/v1/keywords').set(bearer(key));
    expect(Object.keys(keywordList.body)).toEqual(['keywords']);
    expect(keywordList.text).toBe(JSON.stringify({ keywords: keywordList.body.keywords }));
    const keywordsWithCsvPagingKeys = await request(app)
      .get('/api/v1/keywords?limit=1001&cursor=not-base64')
      .set(bearer(key));
    expect(keywordsWithCsvPagingKeys.text).toBe(keywordList.text);

    const report = await request(app).get(`/api/v1/sites/${siteId}/report/latest`).set(bearer(key));
    expect(Object.keys(report.body)).toEqual(['runId', 'report']);
    expect(report.text).toBe(
      JSON.stringify({ runId: String(run._id), report: report.body.report }),
    );
  });

  it('neutralizes stored hostile text in endpoint CSV output', async () => {
    const { user, key } = await seedUserWithKey('hostile-csv@x.co');
    const siteId = await seedSite(user.id, 'hostile.example.com');
    const keyword = await seedKeyword(user.id, siteId, '=formula phrase');
    await seedStoredRows(user.id, siteId, keyword.id);

    const keywordsCsv = await request(app).get('/api/v1/keywords?format=csv').set(bearer(key));
    expect(keywordsCsv.text).toContain("'=formula phrase");

    const historyCsv = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history?format=csv`)
      .set(bearer(key));
    expect(historyCsv.text).toContain("'=formula phrase");

    const serpCsv = await request(app)
      .get(`/api/v1/serp-features?siteId=${siteId}&format=csv`)
      .set(bearer(key));
    expect(serpCsv.text).toContain('=stored title');

    const backlinksCsv = await request(app)
      .get(`/api/v1/backlink-rows?siteId=${siteId}&format=csv`)
      .set(bearer(key));
    expect(backlinksCsv.text).toContain("'=review this link");
  });

  it('flag-off rejects CSV and new routes while all shipped JSON routes remain live', async () => {
    const { user, key } = await seedUserWithKey('flag-off@x.co');
    const siteId = await seedSite(user.id, 'flag.example.com');
    await seedKeyword(user.id, siteId, 'flag');
    env.PUBLIC_EXPORTS_ENABLED = false;

    for (const path of [
      '/api/v1/sites?format=csv',
      '/api/v1/keywords',
      `/api/v1/sites/${siteId}/rank-history?format=csv`,
      `/api/v1/serp-features?siteId=${siteId}`,
      `/api/v1/backlink-rows?siteId=${siteId}`,
    ]) {
      const response = await request(app)
        .get(path)
        .set(bearer(key))
        .set('Accept', path === '/api/v1/keywords' ? 'text/csv' : 'application/json');
      expect(response.status, path).toBe(503);
      expect(response.body.error.message).toBe(DICTIONARIES.en.publicApi.errors.exportsUnavailable);
    }

    await request(app).get('/api/v1/sites').set(bearer(key)).expect(200);
    await request(app).get('/api/v1/keywords').set(bearer(key)).expect(200);
    await request(app).get(`/api/v1/sites/${siteId}/rank-history`).set(bearer(key)).expect(200);
    await request(app).get(`/api/v1/sites/${siteId}/report/latest`).set(bearer(key)).expect(404);
  });

  it('parses input and resolves site ownership before disclosing a disabled export', async () => {
    const primary = await seedUserWithKey('flag-owner-a@x.co');
    const foreign = await seedUserWithKey('flag-owner-b@x.co');
    const foreignSite = await seedSite(foreign.user.id, 'flag-owner-b.example.com');
    env.PUBLIC_EXPORTS_ENABLED = false;

    await request(app)
      .get(`/api/v1/sites/${foreignSite}/rank-history?format=csv`)
      .set(bearer(primary.key))
      .expect(404);
    for (const endpoint of ['serp-features', 'backlink-rows']) {
      await request(app)
        .get(`/api/v1/${endpoint}?siteId=${foreignSite}`)
        .set(bearer(primary.key))
        .expect(404);
    }
    await request(app).get('/api/v1/serp-features?siteId=bad').set(bearer(primary.key)).expect(400);
    await request(app).get('/api/v1/backlink-rows').set(bearer(primary.key)).expect(400);
  });
});

describe('engine filter and stored-data endpoints', () => {
  it('pages more than 100 same-timestamp rank keywords without losing the engine', async () => {
    const { user, key } = await seedUserWithKey('rank-pages@x.co');
    const siteId = await seedSite(user.id, 'rank-pages.example.com');
    await seedKeywordPage(
      user.id,
      siteId,
      'bing-page',
      105,
      'bing',
      new Date('2026-08-05T10:00:00.000Z'),
    );
    await seedKeywordPage(
      user.id,
      siteId,
      'google-after-bing',
      105,
      'google',
      new Date('2026-08-04T10:00:00.000Z'),
    );

    const expected = await getTestDb()
      .select({ id: keywords.id })
      .from(keywords)
      .where(
        and(
          eq(keywords.accountId, user.id),
          eq(keywords.siteId, siteId),
          eq(keywords.engine, 'bing'),
        ),
      )
      .orderBy(desc(keywords.createdAt), desc(keywords.id));

    const ids: string[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    const pageSizes: number[] = [];
    do {
      const response = await request(app)
        .get(
          `/api/v1/sites/${siteId}/rank-history?format=csv&limit=25&engine=bing${
            cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`
          }`,
        )
        .set(bearer(key));
      expect(response.status).toBe(200);
      const rows = csvLeadingColumns(response.text, 3);
      pageSizes.push(rows.length);
      expect(rows.every((row) => row[2] === 'bing')).toBe(true);
      ids.push(...rows.map((row) => row[0] ?? ''));
      const next = response.headers['x-next-cursor'] as string | undefined;
      if (next !== undefined) {
        expect(seenCursors.has(next)).toBe(false);
        seenCursors.add(next);
      }
      cursor = next;
    } while (cursor !== undefined);

    expect(pageSizes).toEqual([25, 25, 25, 25, 5]);
    expect(ids).toEqual(expected.map((row) => row.id));
    expect(new Set(ids).size).toBe(105);

    const legacyCsv = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history?format=csv&engine=bing`)
      .set(bearer(key));
    expect(csvDataLines(legacyCsv.text)).toHaveLength(100);
    expect(legacyCsv.headers['x-next-cursor']).toBeUndefined();
    expect(await getTestDb().select().from(vendorResponses)).toEqual([]);
  });

  it('pages account keywords across deterministic same-timestamp site boundaries', async () => {
    const { user, key } = await seedUserWithKey('keyword-pages@x.co');
    const siteA = await seedSite(user.id, 'keyword-pages-a.example.com');
    const siteB = await seedSite(user.id, 'keyword-pages-b.example.com');
    const sharedSiteTime = new Date('2026-08-05T09:00:00.000Z');
    await Site.updateMany(
      { _id: { $in: [siteA, siteB] } },
      { $set: { createdAt: sharedSiteTime } },
    );
    const orderedSiteIds = [siteA, siteB].sort((left, right) => right.localeCompare(left));
    const firstSiteId = orderedSiteIds[0];
    const secondSiteId = orderedSiteIds[1];
    if (firstSiteId === undefined || secondSiteId === undefined) {
      throw new Error('site ordering fixture failed');
    }
    const sharedKeywordTime = new Date('2026-08-05T08:00:00.000Z');
    await seedKeywordPage(user.id, firstSiteId, 'first-site', 101, 'google', sharedKeywordTime);
    await seedKeywordPage(user.id, secondSiteId, 'second-site', 3, 'google', sharedKeywordTime);

    const expected: Array<{ id: string; siteId: string }> = [];
    for (const siteId of orderedSiteIds) {
      const rows = await getTestDb()
        .select({ id: keywords.id, siteId: keywords.siteId })
        .from(keywords)
        .where(and(eq(keywords.accountId, user.id), eq(keywords.siteId, siteId)))
        .orderBy(desc(keywords.createdAt), desc(keywords.id));
      expected.push(...rows);
    }

    const actual: Array<{ id: string; siteId: string }> = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    do {
      const response = await request(app)
        .get(
          `/api/v1/keywords?format=csv&limit=100${
            cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`
          }`,
        )
        .set(bearer(key));
      expect(response.status).toBe(200);
      const rows = csvLeadingColumns(response.text, 2);
      pageSizes.push(rows.length);
      actual.push(...rows.map((row) => ({ id: row[0] ?? '', siteId: row[1] ?? '' })));
      cursor = response.headers['x-next-cursor'] as string | undefined;
    } while (cursor !== undefined);

    expect(pageSizes).toEqual([100, 4]);
    expect(actual).toEqual(expected);
    expect(new Set(actual.map((row) => row.id)).size).toBe(104);
    expect(actual.slice(0, 101).every((row) => row.siteId === firstSiteId)).toBe(true);
    expect(actual.slice(101).every((row) => row.siteId === secondSiteId)).toBe(true);

    const legacyCsv = await request(app).get('/api/v1/keywords?format=csv').set(bearer(key));
    expect(csvDataLines(legacyCsv.text)).toHaveLength(103);
    expect(legacyCsv.headers['x-next-cursor']).toBeUndefined();
    expect(await getTestDb().select().from(vendorResponses)).toEqual([]);
  });

  it('emits a site-boundary cursor after an exact terminal page and skips empty sites', async () => {
    const { user, key } = await seedUserWithKey('keyword-boundary-page@x.co');
    const firstSite = await seedSite(user.id, 'keyword-boundary-first.example.com');
    const emptySite = await seedSite(user.id, 'keyword-boundary-empty.example.com');
    const finalSite = await seedSite(user.id, 'keyword-boundary-final.example.com');
    // Mongoose timestamps treat `createdAt` as immutable. Use the native
    // collection for this ordering fixture so the test exercises the intended
    // site-boundary sequence instead of depending on ObjectId creation order.
    await Site.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(firstSite) },
      { $set: { createdAt: new Date('2026-08-05T03:00:00Z') } },
    );
    await Site.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(emptySite) },
      { $set: { createdAt: new Date('2026-08-05T02:00:00Z') } },
    );
    await Site.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(finalSite) },
      { $set: { createdAt: new Date('2026-08-05T01:00:00Z') } },
    );
    await seedKeyword(user.id, firstSite, 'boundary first');
    await seedKeyword(user.id, finalSite, 'boundary final');

    const first = await request(app)
      .get(
        `/api/v1/keywords?format=csv&limit=1&cursor=${encodeURIComponent(
          encodeV1LegacyCsvCursor(firstSite, null),
        )}`,
      )
      .set(bearer(key));
    expect(first.status).toBe(200);
    expect(csvDataLines(first.text)).toHaveLength(1);
    const next = first.headers['x-next-cursor'] as string;
    expect(decodeV1LegacyCsvCursor(next)).toEqual({
      v: 1,
      siteId: finalSite,
      keywordCursor: null,
    });

    const last = await request(app)
      .get(`/api/v1/keywords?format=csv&limit=1&cursor=${encodeURIComponent(next)}`)
      .set(bearer(key));
    expect(last.status).toBe(200);
    expect(csvDataLines(last.text)).toHaveLength(1);
    expect(last.headers['x-next-cursor']).toBeUndefined();
  });

  it('rejects bounded, malformed, foreign, deleted, and site-mismatched legacy cursors', async () => {
    const primary = await seedUserWithKey('cursor-owner@x.co');
    const foreign = await seedUserWithKey('cursor-foreign@x.co');
    const siteA = await seedSite(primary.user.id, 'cursor-a.example.com');
    const siteB = await seedSite(primary.user.id, 'cursor-b.example.com');
    const deletedSite = await seedSite(primary.user.id, 'cursor-deleted.example.com');
    const foreignSite = await seedSite(foreign.user.id, 'cursor-foreign.example.com');
    const keywordA = await seedKeyword(primary.user.id, siteA, 'cursor a');
    const keywordB = await seedKeyword(primary.user.id, siteB, 'cursor b');
    await seedKeyword(primary.user.id, deletedSite, 'cursor deleted');
    await Site.updateOne(
      { _id: deletedSite },
      { $set: { deletionStartedAt: new Date('2026-08-05T00:00:00.000Z') } },
    );

    for (const path of [
      '/api/v1/keywords?format=csv&limit=0',
      '/api/v1/keywords?format=csv&limit=1001',
      `/api/v1/sites/${siteA}/rank-history?format=csv&limit=0`,
      `/api/v1/sites/${siteA}/rank-history?format=csv&limit=26`,
    ]) {
      await request(app).get(path).set(bearer(primary.key)).expect(400);
    }

    const strictExtra = Buffer.from(
      JSON.stringify({
        v: 1,
        siteId: siteA,
        keywordCursor: keywordA.id,
        extra: true,
      }),
      'utf8',
    ).toString('base64url');
    const invalidKeywordCursors = [
      'not%21base64',
      strictExtra,
      encodeV1LegacyCsvCursor(foreignSite, null),
      encodeV1LegacyCsvCursor(deletedSite, null),
      encodeV1LegacyCsvCursor(siteA, keywordB.id),
    ];
    for (const cursorValue of invalidKeywordCursors) {
      const response = await request(app)
        .get(`/api/v1/keywords?format=csv&limit=1&cursor=${cursorValue}`)
        .set('Accept-Language', 'fr')
        .set(bearer(primary.key));
      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe(DICTIONARIES.fr.publicApi.errors.invalidCursor);
    }

    const ownedMalformedRank = await request(app)
      .get(`/api/v1/sites/${siteA}/rank-history?format=csv&limit=1&cursor=not%21base64`)
      .set(bearer(primary.key));
    expect(ownedMalformedRank.status).toBe(400);
    expect(ownedMalformedRank.body.error.message).toBe(
      DICTIONARIES.en.publicApi.errors.invalidCursor,
    );

    for (const inaccessibleSiteId of [foreignSite, deletedSite]) {
      const inaccessible = await request(app)
        .get(
          `/api/v1/sites/${inaccessibleSiteId}/rank-history?format=csv&limit=1&cursor=not%21base64`,
        )
        .set(bearer(primary.key));
      expect(inaccessible.status).toBe(404);
      expect(inaccessible.body.error.message).toBe(DICTIONARIES.en.sites.errors.notFound);
    }

    const rankSiteMismatch = encodeV1LegacyCsvCursor(siteB, keywordB.id);
    const rankResponse = await request(app)
      .get(
        `/api/v1/sites/${siteA}/rank-history?format=csv&limit=1&cursor=${encodeURIComponent(
          rankSiteMismatch,
        )}`,
      )
      .set(bearer(primary.key));
    expect(rankResponse.status).toBe(400);
    expect(rankResponse.body.error.message).toBe(DICTIONARIES.en.publicApi.errors.invalidCursor);

    const rankKeywordMismatch = encodeV1LegacyCsvCursor(siteA, keywordB.id);
    await request(app)
      .get(
        `/api/v1/sites/${siteA}/rank-history?format=csv&limit=1&cursor=${encodeURIComponent(
          rankKeywordMismatch,
        )}`,
      )
      .set(bearer(primary.key))
      .expect(400);

    const valid = encodeV1LegacyCsvCursor(siteA, keywordA.id);
    expect(decodeV1LegacyCsvCursor(valid)).toEqual({
      v: 1,
      siteId: siteA,
      keywordCursor: keywordA.id,
    });
    const nonCanonical = Buffer.from(
      JSON.stringify({ keywordCursor: keywordA.id, siteId: siteA, v: 1 }),
      'utf8',
    ).toString('base64url');
    expect(() => decodeV1LegacyCsvCursor(nonCanonical)).toThrow('publicApi.errors.invalidCursor');
    expect(await getTestDb().select().from(vendorResponses)).toEqual([]);
  });

  it('filters rank history by the Prompt 03 enum and localizes unknown engines', async () => {
    const { user, key } = await seedUserWithKey('engines@x.co');
    const siteId = await seedSite(user.id, 'engines.example.com');
    await seedKeyword(user.id, siteId, 'google phrase', 'google');
    await seedKeyword(user.id, siteId, 'bing phrase', 'bing');

    const all = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history?format=csv`)
      .set(bearer(key));
    expect(all.text).toContain('google');
    expect(all.text).toContain('bing');

    const bing = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history?engine=bing`)
      .set(bearer(key));
    expect(bing.body.keywords.map((row: { phrase: string }) => row.phrase)).toEqual([
      'bing phrase',
    ]);
    expect(Object.keys(bing.body.keywords[0])).toEqual(['id', 'phrase', 'series']);

    // Compatibility boundary: legacy JSON/plain CSV still take the first 100
    // global keywords and then filter. Only explicitly paged CSV moves the
    // engine predicate into SQL so traversal can reach older engine rows.
    await getTestDb()
      .insert(keywords)
      .values(
        Array.from({ length: 101 }, (_, index) => ({
          accountId: user.id,
          siteId,
          phrase: `newer google ${index}`,
          locationCode: 2840,
          languageCode: 'en',
          engine: 'google' as const,
          createdAt: new Date(Date.now() + 60_000 + index),
        })),
      );
    const legacyJson = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history?engine=bing`)
      .set(bearer(key));
    expect(legacyJson.text).toBe('{"keywords":[]}');

    const legacyCsv = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history?format=csv&engine=bing`)
      .set(bearer(key));
    expect(csvDataLines(legacyCsv.text)).toEqual([]);
    expect(legacyCsv.headers['x-next-cursor']).toBeUndefined();

    const pagedCsv = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history?format=csv&limit=25&engine=bing`)
      .set(bearer(key));
    expect(csvDataLines(pagedCsv.text)).toHaveLength(1);
    expect(pagedCsv.text).toContain('bing phrase');

    const invalid = await request(app)
      .get(`/api/v1/sites/${siteId}/rank-history?engine=duckduckgo`)
      .set('Accept-Language', 'fr')
      .set(bearer(key));
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toBe(DICTIONARIES.fr.publicApi.errors.invalidEngine);

    expect(parseV1HistoryQuery({ engine: 'amazon' }).engine).toBe('amazon');
    expect(parseV1HistoryQuery({}).engine).toBeUndefined();
  });

  it('paginates SERP observations with strict cursors and explicit observation labels', async () => {
    const { user, key } = await seedUserWithKey('serp-pages@x.co');
    const siteId = await seedSite(user.id, 'serp-pages.example.com');
    const keyword = await seedKeyword(user.id, siteId, 'serp pages');
    await seedStoredRows(user.id, siteId, keyword.id);

    const first = await request(app)
      .get(`/api/v1/serp-features?siteId=${siteId}&limit=1`)
      .set(bearer(key));
    expect(first.status).toBe(200);
    expect(first.body.serpFeatures).toHaveLength(1);
    expect(first.body.serpFeatures[0].sourceKind).toBe('provider_observation');
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await request(app)
      .get(`/api/v1/serp-features?siteId=${siteId}&limit=1&cursor=${first.body.nextCursor}`)
      .set(bearer(key));
    expect(second.body.serpFeatures).toHaveLength(1);
    expect(second.body.serpFeatures[0].id).not.toBe(first.body.serpFeatures[0].id);
    expect(second.body.nextCursor).toBeNull();

    const csv = await request(app)
      .get(`/api/v1/serp-features?siteId=${siteId}&limit=1&format=csv`)
      .set(bearer(key));
    expect(csv.headers['x-next-cursor']).toEqual(expect.any(String));
    expect(csv.text).toContain('provider_observation');

    const invalid = await request(app)
      .get(`/api/v1/serp-features?siteId=${siteId}&cursor=not%21base64`)
      .set(bearer(key));
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toBe(DICTIONARIES.en.publicApi.errors.invalidCursor);
  });

  it('paginates backlink rows, preserves nulls/labels, and enforces the 1000 ceiling', async () => {
    const { user, key } = await seedUserWithKey('backlink-pages@x.co');
    const siteId = await seedSite(user.id, 'backlink-pages.example.com');
    const keyword = await seedKeyword(user.id, siteId, 'backlink pages');
    await seedStoredRows(user.id, siteId, keyword.id);

    const first = await request(app)
      .get(`/api/v1/backlink-rows?siteId=${siteId}&limit=1`)
      .set(bearer(key));
    expect(first.body.backlinkRows).toHaveLength(1);
    expect(first.body.backlinkRows[0]).toMatchObject({
      spamScore: 61,
      dofollow: true,
      isBroken: false,
      sourceKind: 'provider_observation',
    });
    const second = await request(app)
      .get(`/api/v1/backlink-rows?siteId=${siteId}&limit=1&cursor=${first.body.nextCursor}`)
      .set(bearer(key));
    expect(second.body.backlinkRows[0]).toMatchObject({
      firstSeen: null,
      lastSeen: null,
      rationale: null,
      sourceKind: 'provider_observation',
    });
    expect(second.body.nextCursor).toBeNull();

    const csv = await request(app)
      .get(`/api/v1/backlink-rows?siteId=${siteId}&limit=1&format=csv`)
      .set(bearer(key));
    expect(csv.headers['x-next-cursor']).toEqual(expect.any(String));
    expect(csv.text).toContain('provider_observation');

    await request(app)
      .get(`/api/v1/backlink-rows?siteId=${siteId}&limit=1001`)
      .set(bearer(key))
      .expect(400);
    await request(app)
      .get(`/api/v1/backlink-rows?siteId=${siteId}&limit=0`)
      .set(bearer(key))
      .expect(400);
  });

  it('returns 404 for foreign sites, filters every SQL row by owner, and meters nothing', async () => {
    const primary = await seedUserWithKey('owner-a@x.co');
    const foreign = await seedUserWithKey('owner-b@x.co');
    const primarySite = await seedSite(primary.user.id, 'owner-a.example.com');
    const foreignSite = await seedSite(foreign.user.id, 'owner-b.example.com');
    const primaryKeyword = await seedKeyword(primary.user.id, primarySite, 'owner a');
    const foreignKeyword = await seedKeyword(foreign.user.id, foreignSite, 'owner b');
    await seedStoredRows(primary.user.id, primarySite, primaryKeyword.id);
    await seedStoredRows(foreign.user.id, foreignSite, foreignKeyword.id);

    for (const endpoint of ['serp-features', 'backlink-rows']) {
      await request(app)
        .get(`/api/v1/${endpoint}?siteId=${foreignSite}`)
        .set(bearer(primary.key))
        .expect(404);
      const own = await request(app)
        .get(`/api/v1/${endpoint}?siteId=${primarySite}`)
        .set(bearer(primary.key));
      expect(JSON.stringify(own.body)).not.toContain(foreignSite);
    }
  });

  it('rejects malformed site/query/cursor shapes without reading a page', async () => {
    const { key } = await seedUserWithKey('bad-query@x.co');
    await request(app).get('/api/v1/serp-features').set(bearer(key)).expect(400);
    await request(app).get('/api/v1/serp-features?siteId=bad').set(bearer(key)).expect(400);
    await request(app).get('/api/v1/sites?format=json').set(bearer(key)).expect(400);

    const valid = encodeV1ExportCursor(new Date('2026-07-01T00:00:00.000Z'), randomUUID());
    expect(decodeV1ExportCursor(valid)).toMatchObject({
      v: 1,
      at: '2026-07-01T00:00:00.000Z',
    });
    const wrongShape = Buffer.from(JSON.stringify({ v: 2 }), 'utf8').toString('base64url');
    expect(() => decodeV1ExportCursor(wrongShape)).toThrow('publicApi.errors.invalidCursor');
  });
});

describe('legacy CSV controller defensive seams', () => {
  it('classifies non-object paging input and every cursor error guard', () => {
    expect(v1ControllerTestables.hasLegacyCsvPagingKey(null)).toBe(false);
    expect(v1ControllerTestables.hasLegacyCsvPagingKey('limit=1')).toBe(false);
    expect(v1ControllerTestables.hasLegacyCsvPagingKey({ limit: 1 })).toBe(true);

    const unknownCursor = HttpError.badRequest({ code: 'RANKS_ERRORS_UNKNOWN_CURSOR', messageKey: 'ranks.errors.unknownCursor' });
    expect(() =>
      v1ControllerTestables.rethrowLegacyCsvCursorError(unknownCursor, 'cursor'),
    ).toThrow('publicApi.errors.invalidCursor');

    const failure = new Error('database unavailable');
    expect(() =>
      v1ControllerTestables.rethrowLegacyCsvCursorError(failure, undefined),
    ).toThrow(failure);
    expect(() =>
      v1ControllerTestables.rethrowLegacyCsvCursorError(failure, 'cursor'),
    ).toThrow(failure);
    expect(() =>
      v1ControllerTestables.rethrowLegacyCsvCursorError(
        new HttpError(500, { code: 'RANKS_ERRORS_UNKNOWN_CURSOR', messageKey: 'ranks.errors.unknownCursor' }),
        'cursor',
      ),
    ).toThrow('ranks.errors.unknownCursor');
    expect(() =>
      v1ControllerTestables.rethrowLegacyCsvCursorError(
        HttpError.badRequest({
          code: 'RANKS_ERRORS_KEYWORD_NOT_FOUND',
          messageKey: 'ranks.errors.keywordNotFound',
        }),
        'cursor',
      ),
    ).toThrow('ranks.errors.keywordNotFound');
  });

  it('translates cursor races while preserving unrelated read failures', async () => {
    await expect(
      v1ControllerTestables.runLegacyCsvKeywordRead(
        async () => {
          throw HttpError.badRequest({ code: 'RANKS_ERRORS_UNKNOWN_CURSOR', messageKey: 'ranks.errors.unknownCursor' });
        },
        'cursor',
      ),
    ).rejects.toThrow('publicApi.errors.invalidCursor');

    const failure = new Error('database unavailable');
    await expect(
      v1ControllerTestables.runLegacyCsvKeywordRead(
        async () => {
          throw failure;
        },
        undefined,
      ),
    ).rejects.toBe(failure);
  });
});

describe('existing rate buckets enroll both new endpoints', () => {
  function mountedMini(ipMax: number, tokenMax: number): express.Express {
    const mini = express();
    mini.use(language);
    mini.use(
      '/api/v1',
      createApiIpRateLimiter({ max: ipMax, windowMs: 60_000 }),
      createApiRateLimiter({ max: tokenMax, windowMs: 60_000 }),
      createApiKeyAuth(() => db()),
      v1Router,
    );
    mini.use(errorHandler);
    return mini;
  }

  it('applies the authenticated per-token bucket to serp-features', async () => {
    const { user, key } = await seedUserWithKey('token-rate@x.co');
    const siteId = await seedSite(user.id, 'token-rate.example.com');
    markTokenAuthenticated(createHash('sha256').update(key).digest('hex'));
    const mini = mountedMini(10, 1);
    await request(mini).get(`/api/v1/serp-features?siteId=${siteId}`).set(bearer(key)).expect(200);
    await request(mini).get(`/api/v1/serp-features?siteId=${siteId}`).set(bearer(key)).expect(429);
  });

  it('applies the pre-auth per-IP bucket to backlink-rows and records route=api', async () => {
    const mini = mountedMini(1, 10);
    await request(mini)
      .get('/api/v1/backlink-rows?siteId=000000000000000000000000')
      .set('Authorization', 'Bearer rmf_unknown_one')
      .expect(401);
    await request(mini)
      .get('/api/v1/backlink-rows?siteId=000000000000000000000000')
      .set('Authorization', 'Bearer rmf_unknown_two')
      .expect(429);
    await new Promise((resolve) => setImmediate(resolve));
    const hits = await getTestDb().query.rateLimitHits.findMany();
    expect(hits.some((hit) => hit.route === 'api')).toBe(true);
  });
});
