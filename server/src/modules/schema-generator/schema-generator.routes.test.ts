/**
 * Schema generator router integration tests (spec §8.3, §9).
 *
 * Covers the terminal shapes, every must-reject fact class of spec §6.3 at
 * the HTTP layer, the honesty invariants (every emitted property carries an
 * evidence row; every omitted property carries a reason), SSRF rejection with
 * nothing stored, stored-only assembly for the audited
 * path, the kill switch, cross-account 404s, the create bucket's 429, and the
 * download headers.
 *
 * No live AI and no live network: the profile runner is built over the
 * deterministic fake generation provider and the pasted-URL path is driven by
 * an injected transport.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { createAiProfileRunner } from '../../shared/ai-profiles/index.js';
import { translate } from '../../shared/i18n/index.js';
import {
  createFakeAiGenerationProvider,
  type FakeAiOutcome,
} from '../../shared/providers/ai-generation-fake.js';
import { UnsafeUrlError } from '../../shared/security/url-safety.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { AuditRun, AuditedPage, ReportSnapshot } from '../audits/index.js';
import { ContentInventoryPage } from '../content-intelligence/index.js';
import { Site } from '../sites/index.js';
import { SchemaGeneration } from './schema-generation.model.js';
import {
  setSchemaGeneratorAiRunner,
  setSchemaGeneratorFetch,
} from './schema-generator.holder.js';
import { listGenerations } from './schema-generator.service.js';
import { SCHEMA_TYPE_REGISTRY, SUPPORTED_SCHEMA_TYPES } from './schema-types.registry.js';
import type { SafeFetch } from './evidence.js';

const app = createApp();
const PAGE_URL = 'https://example.test/guide/step-one';
let emailSeq = 0;

/** Rebuild the injected runner so a test can choose the provider's outcomes. */
function useAi(outcomes: readonly FakeAiOutcome[] = ['success'], objects?: object): void {
  setSchemaGeneratorAiRunner(
    createAiProfileRunner({
      provider: createFakeAiGenerationProvider({
        outcomes,
        ...(objects ? { objects: { schema_generator: objects } } : {}),
      }),
    }),
    ['fake'],
  );
}

async function seedUser(): Promise<TestUser> {
  emailSeq += 1;
  return signupVerifiedUser(app, {
    email: `schema-generator-${emailSeq}@example.test`,
  });
}

async function seedSite(user: TestUser, domain = 'example.test'): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(user.id),
    url: `https://${domain}`,
    domain,
    displayName: 'Example Co',
  });
  return String(site._id);
}

async function seedAuditedPage(
  user: TestUser,
  siteId: string,
  overrides: Partial<{
    url: string;
    title: string | null;
    metaDescription: string | null;
    h1: string[];
    h2: string[];
    canonical: string | null;
    hasStructuredData: boolean;
    structuredDataErrors: string[];
  }> = {},
): Promise<string> {
  const run = await AuditRun.create({
    accountId: new mongoose.Types.ObjectId(user.id),
    siteId: new mongoose.Types.ObjectId(siteId),
    status: 'succeeded',
    pageCap: 25,
  });
  const runId = String(run._id);
  await AuditedPage.create({
    runId: run._id,
    url: overrides.url ?? PAGE_URL,
    statusCode: 200,
    title: overrides.title === undefined ? 'The complete guide' : overrides.title,
    metaDescription:
      overrides.metaDescription === undefined
        ? 'A plain-language description of the guide.'
        : overrides.metaDescription,
    h1: overrides.h1 ?? ['The complete guide'],
    h2: overrides.h2 ?? ['What is it?', 'Step one', 'Step two'],
    canonical: overrides.canonical === undefined ? PAGE_URL : overrides.canonical,
    hasStructuredData: overrides.hasStructuredData ?? false,
    structuredDataErrors: overrides.structuredDataErrors ?? [],
    onPageScore: 82,
  });
  return runId;
}

const generate = (user: TestUser, body: object) =>
  request(app)
    .post('/api/schema-generator/generations')
    .set('Cookie', user.cookie)
    .send(body);

const auditedBody = (siteId: string, schemaType = 'WebPage') => ({
  siteId,
  source: 'audited-page',
  pageUrl: PAGE_URL,
  schemaType,
});

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSchemaGeneratorAiRunner(null, ['fake']);
  setSchemaGeneratorFetch(null);
  (env as { SCHEMA_GENERATOR_ENABLED: boolean }).SCHEMA_GENERATOR_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setSchemaGeneratorFetch(null);
  useAi();
  (env as { SCHEMA_GENERATOR_ENABLED: boolean }).SCHEMA_GENERATOR_ENABLED = true;
});

describe('auth', () => {
  it('rejects unauthenticated calls on every route with 401', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    await request(app).get('/api/schema-generator/types').expect(401);
    await request(app).get(`/api/schema-generator/sources?siteId=${id}`).expect(401);
    await request(app).post('/api/schema-generator/preview').send({}).expect(401);
    await request(app).post('/api/schema-generator/generations').send({}).expect(401);
    await request(app).get('/api/schema-generator/generations').expect(401);
    await request(app).get(`/api/schema-generator/generations/${id}`).expect(401);
    await request(app).get(`/api/schema-generator/generations/${id}/download`).expect(401);
  });
});

describe('registry projection', () => {
  it('serves the seven frozen types with their property classes', async () => {
    const user = await seedUser();
    const res = await request(app)
      .get('/api/schema-generator/types')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.registryVersion).toBe('1');
    expect(res.body.types.map((entry: { type: string }) => entry.type)).toEqual([
      'WebPage',
      'WebSite',
      'Organization',
      'Article',
      'BreadcrumbList',
      'FAQPage',
      'HowTo',
    ]);
    const article = res.body.types.find((entry: { type: string }) => entry.type === 'Article');
    expect(article.required.map((p: { name: string }) => p.name)).toEqual([
      'headline',
      'author',
      'datePublished',
    ]);
    const image = article.recommended.find((p: { name: string }) => p.name === 'image');
    expect(image.neverFilled).toBe(true);
    expect(image.evidenceFactIds).toEqual([]);
  });
});

describe('sources', () => {
  it('lists audited pages with detector context and inventory pages with supported-type gaps', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const runId = await seedAuditedPage(user, siteId, {
      hasStructuredData: true,
      structuredDataErrors: ['missing name'],
    });
    await ReportSnapshot.create({
      runId: new mongoose.Types.ObjectId(runId),
      siteId: new mongoose.Types.ObjectId(siteId),
      accountId: new mongoose.Types.ObjectId(user.id),
      readinessScore: 70,
      counts: { fixNow: 1, watch: 0, passed: 4 },
      findings: [],
      indexStatus: {
        status: 'ok',
        samples: [
          {
            url: PAGE_URL,
            inspection: {
              indexVerdict: 'NEUTRAL',
              coverageState: 'Indexed',
              robotsTxtState: 'ALLOWED',
              richResults: { verdict: 'NEUTRAL', items: [{ type: 'Article', issues: 1 }] },
            },
          },
        ],
      },
    });
    await ContentInventoryPage.create({
      runId: new mongoose.Types.ObjectId(),
      accountId: new mongoose.Types.ObjectId(user.id),
      siteId: new mongoose.Types.ObjectId(siteId),
      url: 'https://example.test/pricing',
      contentHash: 'hash-1',
      createdAtMs: Date.now(),
      facts: { schemaTypes: [], hasSchemaOrgArticle: false },
    });
    await ContentInventoryPage.create({
      runId: new mongoose.Types.ObjectId(),
      accountId: new mongoose.Types.ObjectId(user.id),
      siteId: new mongoose.Types.ObjectId(siteId),
      url: 'https://example.test/blog',
      contentHash: 'hash-2',
      createdAtMs: Date.now(),
      facts: { schemaTypes: ['FAQPage'], hasSchemaOrgArticle: true },
    });
    await ContentInventoryPage.create({
      runId: new mongoose.Types.ObjectId(),
      accountId: new mongoose.Types.ObjectId(user.id),
      siteId: new mongoose.Types.ObjectId(siteId),
      url: 'https://example.test/fully-marked',
      contentHash: 'hash-3',
      createdAtMs: Date.now(),
      facts: {
        schemaTypes: [...SUPPORTED_SCHEMA_TYPES],
        hasSchemaOrgArticle: true,
      },
    });

    const res = await request(app)
      .get(`/api/schema-generator/sources?siteId=${siteId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.runId).toBe(runId);
    expect(res.body.auditedPages).toEqual([
      {
        url: PAGE_URL,
        title: 'The complete guide',
        hasStructuredData: true,
        structuredDataErrors: 1,
        richResultsVerdict: 'NEUTRAL',
      },
    ]);
    // Empty and partially marked-up rows both have a supported-type gap. A
    // page already carrying the complete supported registry is not work.
    expect(res.body.inventoryPages).toHaveLength(2);
    expect(res.body.inventoryPages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://example.test/pricing',
          schemaTypes: [],
          hasSchemaOrgArticle: false,
        }),
        expect.objectContaining({
          url: 'https://example.test/blog',
          schemaTypes: ['FAQPage', 'Article'],
          hasSchemaOrgArticle: true,
        }),
      ]),
    );
  });

  it('serves an empty audited list before the first successful run', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const res = await request(app)
      .get(`/api/schema-generator/sources?siteId=${siteId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body).toMatchObject({ runId: null, auditedPages: [], inventoryPages: [] });
  });

  it('returns 404 for another account site', async () => {
    const owner = await seedUser();
    const siteId = await seedSite(owner);
    const stranger = await seedUser();
    const res = await request(app)
      .get(`/api/schema-generator/sources?siteId=${siteId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    expect(res.body.error.message).toBe(translate('en', 'schemaGenerator.errors.notFound'));
  });
});

describe('generation', () => {
  it('refuses a paused site with the localized 409 and stores nothing', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    await Site.updateOne({ _id: siteId }, { $set: { paused: true, pausedAt: new Date() } });

    const res = await generate(user, auditedBody(siteId)).expect(409);
    expect(res.body.error.message).toBe(translate('en', 'sites.errors.paused'));
    expect(await SchemaGeneration.countDocuments({})).toBe(0);
  });

  it('emits a conforming WebPage with an evidence row per property and reasons for the rest', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);

    const res = await generate(user, auditedBody(siteId)).expect(201);
    expect(res.body.status).toBe('complete');
    expect(res.body.registryVersion).toBe('1');
    expect(res.body.mediaType).toBe('application/ld+json');

    const payload = JSON.parse(
      res.body.payload
        .replace(/\\u003c/g, '<')
        .replace(/\\u003e/g, '>')
        .replace(/\\u0026/g, '&'),
    );
    expect(payload['@context']).toBe('https://schema.org');
    expect(payload['@type']).toBe('WebPage');
    expect(payload.name).toBe('The complete guide');
    expect(payload.url).toBe(PAGE_URL);
    expect(payload.isPartOf).toEqual({ '@type': 'WebSite', url: 'https://example.test' });

    // HONEST-1 — every emitted property (beyond the two JSON-LD keywords)
    // carries at least one evidence row naming the fact that filled it.
    const emitted = Object.keys(payload).filter((key) => !key.startsWith('@'));
    for (const property of emitted) {
      expect(res.body.evidence.some((row: { property: string }) => row.property === property)).toBe(
        true,
      );
    }
    // HONEST-2 — every registry property NOT emitted carries an omission
    // reason; the two sets partition the registry.
    const omitted = res.body.omissions.map((row: { property: string }) => row.property);
    const registryProperties = SCHEMA_TYPE_REGISTRY.WebPage.properties.map(
      (property) => property.name,
    );
    expect(new Set([...emitted, ...omitted])).toEqual(new Set(registryProperties));
    expect(omitted).toContain('primaryImageOfPage');
    for (const row of res.body.omissions) {
      expect(['no_evidence', 'evidence_ambiguous', 'not_applicable']).toContain(row.reasonCode);
      expect(['required', 'recommended']).toContain(row.class);
    }
    expect(res.body.conformance).toMatchObject({ registryVersion: '1', status: 'conforms' });
  });

  it('reports the honest Article required gap for datePublished on the audited path', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);

    const res = await generate(user, auditedBody(siteId, 'Article')).expect(201);
    expect(res.body.conformance.status).toBe('gaps');
    expect(
      res.body.conformance.requiredGaps.map((gap: { property: string }) => gap.property),
    ).toEqual(['datePublished']);
    expect(res.body.conformance.requiredGaps[0].reasonCode).toBe('no_evidence');
    // The author is assembled from the site record, never invented.
    const payload = JSON.parse(res.body.payload);
    expect(payload.author).toEqual({ '@type': 'Organization', name: 'Example Co' });
  });

  it('builds a deterministic BreadcrumbList from the URL path with no AI involvement', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    const res = await generate(user, auditedBody(siteId, 'BreadcrumbList')).expect(201);
    const payload = JSON.parse(res.body.payload);
    expect(payload.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Example Co', item: 'https://example.test' },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Guide',
        item: 'https://example.test/guide',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Step One',
        item: 'https://example.test/guide/step-one',
      },
    ]);
  });

  it('reports an honest FAQPage gap when the stored crawl holds no answers', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    const res = await generate(user, auditedBody(siteId, 'FAQPage')).expect(201);
    expect(res.body.conformance.status).toBe('gaps');
    expect(res.body.conformance.requiredGaps[0]).toMatchObject({ property: 'mainEntity' });
    expect(JSON.parse(res.body.payload).mainEntity).toBeUndefined();
  });

  it('orders HowTo steps by the assembler, never by AI-supplied positions', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    const res = await generate(user, auditedBody(siteId, 'HowTo')).expect(201);
    const payload = JSON.parse(res.body.payload);
    expect(payload.step.map((step: { position: number }) => step.position)).toEqual([1, 2, 3]);
    expect(payload.step[0].name).toBe('What is it?');
  });

  it('returns 404 for a page the account never crawled and for a foreign site', async () => {
    const owner = await seedUser();
    const siteId = await seedSite(owner);
    await seedAuditedPage(owner, siteId);
    await generate(owner, {
      ...auditedBody(siteId),
      pageUrl: 'https://example.test/never-crawled',
    }).expect(404);

    const stranger = await seedUser();
    await generate(stranger, auditedBody(siteId)).expect(404);
  });

  it('honours an explicit runId and 404s a run the account does not own', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const runId = await seedAuditedPage(user, siteId);
    const res = await generate(user, { ...auditedBody(siteId), runId }).expect(201);
    expect(res.body.status).toBe('complete');
    await generate(user, {
      ...auditedBody(siteId),
      runId: new mongoose.Types.ObjectId().toString(),
    }).expect(404);
  });

  it('rejects a malformed body before anything is stored', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await generate(user, { ...auditedBody(siteId), schemaType: 'Product' }).expect(400);
    await generate(user, { ...auditedBody(siteId), source: 'guesswork' }).expect(400);
    await generate(user, { siteId }).expect(400);
    expect(await SchemaGeneration.countDocuments({})).toBe(0);
  });
});

describe('must-reject fact classes over HTTP (spec §6.3)', () => {
  it.each([
    ['invented rating', 'aggregateRating', '4.8'],
    ['invented price', 'offers', '$49'],
    ['invented review', 'review', 'Great product'],
    ['invented author', 'author', 'Jane Doe'],
  ])('never emits %s', async (_label, property, value) => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    useAi(['success'], {
      assignments: [
        { property: 'name', factId: 'page.title', value: 'The complete guide' },
        { property, factId: 'page.title', value },
      ],
      omissions: [],
      citations: [],
    });
    const res = await generate(user, auditedBody(siteId)).expect(201);
    const payload = JSON.parse(res.body.payload);
    expect(payload[property]).toBeUndefined();
    expect(res.body.evidence.some((row: { value: string }) => row.value === value)).toBe(false);
  });

  it('never emits an invented publication date and still reports the required gap', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    useAi(['success'], {
      assignments: [
        { property: 'headline', factId: 'page.h1[0]', value: 'The complete guide' },
        { property: 'datePublished', factId: 'page.title', value: '2020-01-01' },
      ],
      omissions: [],
      citations: [],
    });
    const res = await generate(user, auditedBody(siteId, 'Article')).expect(201);
    expect(JSON.parse(res.body.payload).datePublished).toBeUndefined();
    expect(res.body.conformance.requiredGaps).toEqual([
      { property: 'datePublished', reasonCode: 'no_evidence' },
    ]);
  });

  it('drops a paraphrase and renders evidence_ambiguous next to the omission', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    useAi(['success'], {
      assignments: [
        { property: 'name', factId: 'page.title', value: 'The complete guide' },
        { property: 'description', factId: 'page.metaDescription', value: 'A reworded summary.' },
      ],
      omissions: [],
      citations: [],
    });
    const res = await generate(user, auditedBody(siteId)).expect(201);
    expect(JSON.parse(res.body.payload).description).toBeUndefined();
    const omission = res.body.omissions.find(
      (row: { property: string }) => row.property === 'description',
    );
    expect(omission.reasonCode).toBe('evidence_ambiguous');
  });

  it('drops a hallucinated citation and a context-fact citation', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    useAi(['success'], {
      assignments: [
        { property: 'name', factId: 'page.h2[99]', value: 'invented' },
        { property: 'description', factId: 'gsc.richResults', value: 'PASS' },
      ],
      omissions: [],
      citations: [],
    });
    const res = await generate(user, auditedBody(siteId)).expect(201);
    const payload = JSON.parse(res.body.payload);
    expect(payload.name).toBeUndefined();
    expect(payload.description).toBeUndefined();
    // Every assignment was rejected but the deterministic markup survived, so
    // the terminal is `ai_output_rejected`.
    expect(res.body.status).toBe('failed');
    expect(res.body.failureReason).toBe('ai_output_rejected');
    expect(payload.url).toBe(PAGE_URL);
  });
});

describe('preview and provider failure', () => {

  it('previews the community spend disclosure without generating', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const body = { siteId, source: 'audited-page', pageUrl: PAGE_URL, schemaType: 'WebPage' };
    const res = await request(app)
      .post('/api/schema-generator/preview')
      .set('Cookie', user.cookie)
      .send(body)
      .expect(200);
    expect(res.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
    expect(await SchemaGeneration.countDocuments({})).toBe(0);
  });

  it('stores the ai_provider_failed terminal when the provider dies with zero retained output', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    useAi(['unavailable']);
    const res = await generate(user, auditedBody(siteId)).expect(502);
    expect(res.body.error.message).toBe(
      translate('en', 'schemaGenerator.errors.generationFailed'),
    );

    const stored = await SchemaGeneration.findOne({ accountId: user.id }).lean();
    expect(stored).toMatchObject({
      status: 'failed',
      failureReason: 'ai_provider_failed',
      payload: null,
    });
  });

  it('stores nothing when the evidence preflight cannot assemble the page', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await generate(user, auditedBody(siteId)).expect(404);
    expect(await SchemaGeneration.countDocuments({})).toBe(0);
  });
});

describe('pasted-URL path', () => {
  const html = `<!doctype html><html lang="en"><head>
      <title>Fetched guide</title>
      <meta name="description" content="Fetched description.">
      <meta property="article:published_time" content="2026-05-01T00:00:00Z">
      <meta property="article:modified_time" content="2026-06-01T00:00:00Z">
    </head><body><h1>Fetched guide</h1>
      <h2>Overview</h2><p>This heading is not a question.</p>
      <h2>What is it?</h2><p>It is a fetched guide.</p>
      <h2>How does it work?</h2><p>It works well.</p>
    </body></html>`;

  const okFetch: SafeFetch = async () =>
    new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

  it('fills Article dates and FAQ pairs from the safely fetched page', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    setSchemaGeneratorFetch(okFetch);

    const article = await generate(user, {
      siteId,
      source: 'url',
      pageUrl: 'https://example.test/fetched',
      schemaType: 'Article',
    }).expect(201);
    expect(article.body.conformance.status).toBe('conforms');
    const articlePayload = JSON.parse(article.body.payload);
    expect(articlePayload.datePublished).toBe('2026-05-01T00:00:00Z');
    expect(articlePayload.dateModified).toBe('2026-06-01T00:00:00Z');
    expect(articlePayload.inLanguage).toBe('en');

    const faq = await generate(user, {
      siteId,
      source: 'url',
      pageUrl: 'https://example.test/fetched',
      schemaType: 'FAQPage',
    }).expect(201);
    expect(faq.body.conformance.status).toBe('conforms');
    const faqPayload = JSON.parse(faq.body.payload);
    expect(faqPayload.mainEntity).toHaveLength(2);
    expect(faqPayload.mainEntity[0]).toEqual({
      '@type': 'Question',
      name: 'What is it?',
      acceptedAnswer: { '@type': 'Answer', text: 'It is a fetched guide.' },
    });
  });

  it('rejects a private-address URL with 400 and stores nothing', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    setSchemaGeneratorFetch(async () => {
      throw new UnsafeUrlError('blocked private address');
    });
    const res = await generate(user, {
      siteId,
      source: 'url',
      pageUrl: 'https://internal.example.test/admin',
      schemaType: 'WebPage',
    }).expect(400);
    expect(res.body.error.message).toBe(translate('en', 'schemaGenerator.errors.unsafeUrl'));
    expect(await SchemaGeneration.countDocuments({})).toBe(0);
  });

  it('rejects a non-https address before any DNS work happens', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await generate(user, {
      siteId,
      source: 'url',
      pageUrl: 'http://example.test/insecure',
      schemaType: 'WebPage',
    }).expect(400);
    await generate(user, {
      siteId,
      source: 'url',
      pageUrl: 'not-a-url',
      schemaType: 'WebPage',
    }).expect(400);
  });

  it('rejects a non-HTML response with the localized message', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    setSchemaGeneratorFetch(async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const res = await generate(user, {
      siteId,
      source: 'url',
      pageUrl: 'https://example.test/data.json',
      schemaType: 'WebPage',
    }).expect(400);
    expect(res.body.error.message).toBe(translate('en', 'schemaGenerator.errors.notHtml'));
  });

  it('maps an unexpected transport failure onto the localized 400 rather than a 500', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    setSchemaGeneratorFetch(async () => {
      throw new Error('socket hang up');
    });
    const res = await generate(user, {
      siteId,
      source: 'url',
      pageUrl: 'https://example.test/flaky',
      schemaType: 'WebPage',
    }).expect(400);
    expect(res.body.error.message).toBe(translate('en', 'schemaGenerator.errors.unsafeUrl'));
  });

  it('SEC-URL-2 — the audited path issues zero outbound requests', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    setSchemaGeneratorFetch(async () => {
      throw new Error('the audited-page path must never fetch');
    });
    await generate(user, auditedBody(siteId)).expect(201);
  });
});

describe('inventory-page source', () => {
  it('generates from an inventory row and 404s when no row exists', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    await ContentInventoryPage.create({
      runId: new mongoose.Types.ObjectId(),
      accountId: new mongoose.Types.ObjectId(user.id),
      siteId: new mongoose.Types.ObjectId(siteId),
      url: PAGE_URL,
      contentHash: 'hash-3',
      createdAtMs: Date.now(),
      facts: { schemaTypes: [], hasSchemaOrgArticle: false },
    });
    const res = await generate(user, {
      ...auditedBody(siteId),
      source: 'inventory-page',
    }).expect(201);
    expect(res.body.source).toBe('inventory-page');

    await generate(user, {
      siteId,
      source: 'inventory-page',
      pageUrl: 'https://example.test/not-in-inventory',
      schemaType: 'WebPage',
    }).expect(404);
  });
});

describe('stored generations', () => {
  it('lists newest first, re-opens, and downloads as JSON-LD', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    const first = await generate(user, auditedBody(siteId)).expect(201);
    const second = await generate(user, auditedBody(siteId, 'Organization')).expect(201);

    const list = await request(app)
      .get(`/api/schema-generator/generations?siteId=${siteId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([
      second.body.id,
      first.body.id,
    ]);

    const reopened = await request(app)
      .get(`/api/schema-generator/generations/${first.body.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(reopened.body.payload).toBe(first.body.payload);

    const download = await request(app)
      .get(`/api/schema-generator/generations/${first.body.id}/download`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(download.headers['content-type']).toContain('application/ld+json');
    expect(download.headers['content-disposition']).toBe(
      `attachment; filename="WebPage-${first.body.id}.jsonld"`,
    );
    expect(download.text).toBe(first.body.payload);
  });

  it('lists across every site when no siteId is supplied', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    await generate(user, auditedBody(siteId)).expect(201);
    const list = await request(app)
      .get('/api/schema-generator/generations')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
  });

  it('filters an aggregate generation list to the selected Site grant', async () => {
    const user = await seedUser();
    const allowedSiteId = await seedSite(user, 'allowed-schema.example');
    const deniedSiteId = await seedSite(user, 'denied-schema.example');
    await SchemaGeneration.create([
      {
        accountId: user.id,
        siteId: allowedSiteId,
        pageUrl: 'https://allowed-schema.example/page',
        source: 'audited-page',
        schemaType: 'WebPage',
        registryVersion: 'test-v1',
        status: 'complete',
        payload: '{}',
      },
      {
        accountId: user.id,
        siteId: deniedSiteId,
        pageUrl: 'https://denied-schema.example/page',
        source: 'audited-page',
        schemaType: 'WebPage',
        registryVersion: 'test-v1',
        status: 'complete',
        payload: '{}',
      },
    ]);

    const scoped = await listGenerations({
      accountId: user.id,
      allowedSiteIds: [allowedSiteId],
      limit: 20,
    });
    expect(scoped.items).toHaveLength(1);
    expect(scoped.items[0]?.siteId).toBe(allowedSiteId);

    const empty = await listGenerations({
      accountId: user.id,
      allowedSiteIds: [],
      limit: 20,
    });
    expect(empty.items).toEqual([]);

    await expect(
      listGenerations({
        accountId: user.id,
        siteId: deniedSiteId,
        allowedSiteIds: [allowedSiteId],
        limit: 20,
      }),
    ).rejects.toMatchObject({ status: 404, message: 'schemaGenerator.errors.notFound' });
  });

  it('404s a failed generation download that retained nothing', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    useAi(['unavailable']);
    await generate(user, auditedBody(siteId)).expect(502);
    const stored = await SchemaGeneration.findOne({ accountId: user.id }).lean();
    await request(app)
      .get(`/api/schema-generator/generations/${String(stored!._id)}/download`)
      .set('Cookie', user.cookie)
      .expect(404);
  });

  it('returns 404 for another account generation and 400 for a malformed id', async () => {
    const owner = await seedUser();
    const siteId = await seedSite(owner);
    await seedAuditedPage(owner, siteId);
    const created = await generate(owner, auditedBody(siteId)).expect(201);

    const stranger = await seedUser();
    await request(app)
      .get(`/api/schema-generator/generations/${created.body.id}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .get(`/api/schema-generator/generations/${created.body.id}/download`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .get(`/api/schema-generator/generations?siteId=${siteId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .get('/api/schema-generator/generations/not-an-id')
      .set('Cookie', owner.cookie)
      .expect(400);
  });
});

describe('kill switch', () => {
  it('returns the ownership 404 before disclosing the disabled flag', async () => {
    const owner = await seedUser();
    const siteId = await seedSite(owner);
    const stranger = await seedUser();
    (env as { SCHEMA_GENERATOR_ENABLED: boolean }).SCHEMA_GENERATOR_ENABLED = false;

    await generate(stranger, auditedBody(siteId)).expect(404);
    await request(app)
      .post('/api/schema-generator/preview')
      .set('Cookie', stranger.cookie)
      .send({ siteId, source: 'audited-page', pageUrl: PAGE_URL })
      .expect(404);
  });

  it('closes preview and generate but leaves every stored read open', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    const created = await generate(user, auditedBody(siteId)).expect(201);

    (env as { SCHEMA_GENERATOR_ENABLED: boolean }).SCHEMA_GENERATOR_ENABLED = false;
    const blocked = await generate(user, auditedBody(siteId)).expect(403);
    expect(blocked.body.error.message).toBe(
      translate('en', 'schemaGenerator.errors.productUnavailable'),
    );
    await request(app)
      .post('/api/schema-generator/preview')
      .set('Cookie', user.cookie)
      .send({ siteId, source: 'audited-page', pageUrl: PAGE_URL })
      .expect(403);

    await request(app)
      .get(`/api/schema-generator/generations/${created.body.id}`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/schema-generator/generations/${created.body.id}/download`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/schema-generator/generations?siteId=${siteId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/schema-generator/sources?siteId=${siteId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get('/api/schema-generator/types')
      .set('Cookie', user.cookie)
      .expect(200);
  });
});

describe('SEC-REDACT', () => {
  it('sends only assembled facts to the model and persists no prompt or model echo', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const runId = await seedAuditedPage(user, siteId);
    await ReportSnapshot.create({
      runId: new mongoose.Types.ObjectId(runId),
      siteId: new mongoose.Types.ObjectId(siteId),
      accountId: new mongoose.Types.ObjectId(user.id),
      readinessScore: 70,
      counts: { fixNow: 1, watch: 0, passed: 0 },
      findings: [
        {
          ruleId: 'structured-data-missing',
          bucket: 'watch',
          severity: 'warning',
          affectedUrls: [PAGE_URL],
          meta: { offenders: [{ url: PAGE_URL, reason: 'missing' }] },
        },
      ],
      indexStatus: {
        status: 'ok',
        samples: [
          {
            url: PAGE_URL,
            inspection: {
              indexVerdict: 'PASS',
              coverageState: 'Indexed',
              robotsTxtState: 'ALLOWED',
              richResults: { verdict: 'NEUTRAL', items: [] },
            },
          },
        ],
      },
    });
    await ContentInventoryPage.create({
      runId: new mongoose.Types.ObjectId(),
      accountId: new mongoose.Types.ObjectId(user.id),
      siteId: new mongoose.Types.ObjectId(siteId),
      url: PAGE_URL,
      contentHash: 'schema-context',
      createdAtMs: Date.now(),
      facts: { schemaTypes: ['Article'], hasSchemaOrgArticle: true },
    });

    const seen: string[] = [];
    setSchemaGeneratorAiRunner(
      {
        preflight: () => undefined,
        run: async (input) => {
          seen.push(JSON.stringify(input.input));
          return {
            trust: 'untrusted',
            status: 'complete',
            object: { assignments: [], omissions: [], citations: [] },
            warnings: [],
            qualityFlags: ['complete'],
            provenance: {
              task: 'schema_generator',
              profileVersion: '1.1.0',
              outputSchemaVersion: '1',
              promptTemplateId: 'schema-generator',
              promptTemplateVersion: '2',
              provider: 'fake',
              model: 'test-model',
              finishReason: 'stop',
              attempts: 1,
              fallbackUsed: false,
              latencyMs: 0,
              actualOrEstimatedCostMicros: 0n,
            },
            classification: { generatedFields: 'untrusted', renderAs: 'text_only' },
          } as never;
        },
      },
      ['fake'],
    );

    const res = await generate(user, auditedBody(siteId)).expect(201);
    const sent = JSON.parse(seen[0]!);
    // Only requestable properties and the facts they may cite are supplied.
    expect(sent.properties.map((p: { name: string }) => p.name)).toEqual(['name', 'description']);
    // Facts are addressed by opaque citation slugs. The three assignable facts
    // are followed by bounded detector, Search Console and inventory context.
    expect(sent.facts.map((f: { id: string }) => f.id)).toEqual([
      'f0',
      'f1',
      'f2',
      'f3',
      'f4',
      'f5',
    ]);
    expect(sent.facts.map((f: { family: string }) => f.family).sort()).toEqual([
      'detector.structuredData',
      'gsc.richResults',
      'inventory.schemaTypes',
      'page.h1',
      'page.metaDescription',
      'page.title',
    ]);
    expect(
      Object.fromEntries(
        sent.facts.map((fact: { family: string; sourceIndex: number | null }) => [
          fact.family,
          fact.sourceIndex,
        ]),
      ),
    ).toEqual({
      'page.title': null,
      'page.metaDescription': null,
      'page.h1': 0,
      'detector.structuredData': null,
      'gsc.richResults': null,
      'inventory.schemaTypes': null,
    });
    const propertyMenus = sent.properties.flatMap(
      (property: { evidenceFactIds: string[] }) => property.evidenceFactIds,
    );
    expect(propertyMenus).not.toContain('f3');
    expect(propertyMenus).not.toContain('f4');
    expect(propertyMenus).not.toContain('f5');
    expect(seen[0]).not.toContain('<html');
    expect(seen[0]).toContain('detector.structuredData');

    const stored = await SchemaGeneration.findById(res.body.id).lean();
    // SEC-REDACT: provenance only — no prompt text, no raw model response.
    expect(Object.keys(stored!.provenance as object).sort()).toEqual([
      'costMicros',
      'model',
      'outputSchemaVersion',
      'profileVersion',
      'provider',
    ]);
    expect(JSON.stringify(stored)).not.toContain('Assign supplied page facts');
  });
});

describe('SEC-RATE', () => {
  it('429s the 11th create in a window while stored reads keep serving', async () => {
    const user = await seedUser(); // cap 60 — the bucket bites first
    const siteId = await seedSite(user);
    await seedAuditedPage(user, siteId);
    for (let i = 0; i < 10; i += 1) await generate(user, auditedBody(siteId)).expect(201);
    await generate(user, auditedBody(siteId)).expect(429);
    await request(app)
      .get(`/api/schema-generator/generations?siteId=${siteId}`)
      .set('Cookie', user.cookie)
      .expect(200);
  });
});
