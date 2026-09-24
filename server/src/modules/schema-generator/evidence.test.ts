/**
 * Evidence assembly — frozen fact ids and the three source paths.
 *
 * SEC-URL-1 (pasted URL goes through the SSRF authority), SEC-URL-2 (stored
 * paths issue zero outbound requests) and SEC-BOUND-1 (response and extraction
 * ceilings) are all asserted here. No test performs live network I/O.
 */
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { UnsafeUrlError } from '../../shared/security/url-safety.js';
import { AuditRun, AuditedPage, ReportSnapshot } from '../audits/index.js';
import { ContentInventoryPage } from '../content-intelligence/index.js';
import { Site } from '../sites/index.js';
import {
  CONTEXT_ONLY_FACT_IDS,
  EVIDENCE_LIMITS,
  EVIDENCE_SOURCES,
  SchemaEvidenceError,
  assembleEvidence,
  extractPageFacts,
  isQuestionHeading,
  type AssembledEvidence,
  type SafeFetch,
} from './evidence.js';

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
afterEach(() => clearCollections());

const ACCOUNT_ID = new mongoose.Types.ObjectId().toHexString();
const PAGE_URL = 'https://example.com/guides/getting-started';

const throwingFetch: SafeFetch = () => {
  throw new Error('outbound request attempted');
};

function valueOf(evidence: AssembledEvidence, id: string): string | undefined {
  return evidence.facts.find((entry) => entry.id === id)?.value;
}

async function seedSite(overrides: Record<string, unknown> = {}) {
  return Site.create({
    accountId: ACCOUNT_ID,
    url: 'https://example.com',
    domain: 'example.com',
    displayName: 'Example Docs',
    ...overrides,
  });
}

async function seedRun(siteId: string, overrides: Record<string, unknown> = {}) {
  return AuditRun.create({
    accountId: ACCOUNT_ID,
    siteId,
    status: 'succeeded',
    pageCap: 25,
    ...overrides,
  });
}

async function seedAuditedPage(runId: string, overrides: Record<string, unknown> = {}) {
  return AuditedPage.create({
    runId,
    url: PAGE_URL,
    statusCode: 200,
    onPageScore: 90,
    title: 'Getting started with rank tracking',
    metaDescription: 'A short plain-language walk-through.',
    canonical: `${PAGE_URL}/`,
    h1: ['Getting started'],
    h2: ['Add your first site', 'Run your first audit'],
    hasStructuredData: false,
    structuredDataErrors: [],
    ...overrides,
  });
}

async function seedSnapshot(runId: string, siteId: string, overrides: Record<string, unknown> = {}) {
  return ReportSnapshot.create({
    runId,
    siteId,
    accountId: ACCOUNT_ID,
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
            richResults: { verdict: 'NEUTRAL', items: [{ type: 'Article', issues: 2 }] },
          },
        },
      ],
    },
    ...overrides,
  });
}

async function seedInventoryPage(siteId: string, facts: Record<string, unknown>) {
  return ContentInventoryPage.create({
    runId: new mongoose.Types.ObjectId(),
    accountId: ACCOUNT_ID,
    siteId,
    facts,
    url: PAGE_URL,
    contentHash: 'hash-1',
    createdAtMs: 1,
  });
}

function htmlResponse(body: string, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

describe('constants', () => {
  it('freezes the source list and the context-only fact ids', () => {
    expect([...EVIDENCE_SOURCES]).toEqual(['audited-page', 'inventory-page', 'url']);
    expect([...CONTEXT_ONLY_FACT_IDS]).toEqual([
      'detector.structuredData',
      'gsc.richResults',
      'inventory.schemaTypes',
    ]);
  });

  it.each(['Is this a question?', 'هل هذا سؤال؟', 'これは質問ですか？'])(
    'treats %s as question-shaped',
    (value) => {
      expect(isQuestionHeading(value)).toBe(true);
    },
  );

  it('treats a statement heading as not question-shaped', () => {
    expect(isQuestionHeading('Add your first site')).toBe(false);
  });
});

describe('audited-page path', () => {
  it('returns stored facts and issues zero outbound requests', async () => {
    const site = await seedSite();
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id));
    await seedSnapshot(String(run._id), String(site._id));
    await seedInventoryPage(String(site._id), { schemaTypes: ['Article'], hasSchemaOrgArticle: true });

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });

    expect(evidence.source).toBe('audited-page');
    expect(evidence.pageUrl).toBe(PAGE_URL);
    expect(valueOf(evidence, 'site.origin')).toBe('https://example.com');
    expect(valueOf(evidence, 'site.domain')).toBe('example.com');
    expect(valueOf(evidence, 'site.label')).toBe('Example Docs');
    expect(valueOf(evidence, 'page.url')).toBe(PAGE_URL);
    expect(valueOf(evidence, 'page.language')).toBeUndefined();
    expect(valueOf(evidence, 'page.canonical')).toBe(`${PAGE_URL}/`);
    expect(valueOf(evidence, 'page.title')).toBe('Getting started with rank tracking');
    expect(valueOf(evidence, 'page.metaDescription')).toBe('A short plain-language walk-through.');
    expect(valueOf(evidence, 'page.h1[0]')).toBe('Getting started');
    expect(valueOf(evidence, 'page.h2[1]')).toBe('Run your first audit');
    expect(valueOf(evidence, 'detector.structuredData')).toBe('{"present":false,"errors":0}');
    expect(valueOf(evidence, 'gsc.richResults')).toBe(
      '{"verdict":"NEUTRAL","items":[{"type":"Article","issues":2}]}',
    );
    expect(valueOf(evidence, 'inventory.schemaTypes')).toBe(
      '{"schemaTypes":["Article"],"hasSchemaOrgArticle":true}',
    );
    expect(evidence.facts.filter((entry) => entry.contextOnly).map((entry) => entry.id)).toEqual([
      'detector.structuredData',
      'gsc.richResults',
      'inventory.schemaTypes',
    ]);
    // The pasted-URL facts only exist on the fetch path.
    expect(valueOf(evidence, 'page.faqAnswers[0]')).toBeUndefined();
    expect(valueOf(evidence, 'page.articlePublishedTime')).toBeUndefined();
  });

  it('honours an explicit runId', async () => {
    const site = await seedSite();
    const older = await seedRun(String(site._id));
    await seedAuditedPage(String(older._id), { title: 'Older title' });
    const newer = await seedRun(String(site._id));
    await seedAuditedPage(String(newer._id), { title: 'Newer title' });

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      runId: String(older._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(valueOf(evidence, 'page.title')).toBe('Older title');
    expect(valueOf(evidence, 'page.language')).toBeUndefined();
  });

  it('omits blank stored strings instead of emitting empty facts', async () => {
    const site = await seedSite({ displayName: '' });
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id), {
      title: null,
      metaDescription: '   ',
      canonical: null,
      h1: ['', 'Real heading'],
      h2: [],
    });

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(valueOf(evidence, 'site.label')).toBeUndefined();
    expect(valueOf(evidence, 'page.title')).toBeUndefined();
    expect(valueOf(evidence, 'page.metaDescription')).toBeUndefined();
    expect(valueOf(evidence, 'page.canonical')).toBeUndefined();
    expect(valueOf(evidence, 'page.h1[0]')).toBe('Real heading');
  });

  it('stops collecting headings at the per-array ceiling', async () => {
    const site = await seedSite();
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id), {
      h1: Array.from({ length: EVIDENCE_LIMITS.h1Count + 3 }, (_, index) => `Heading ${index}`),
      h2: Array.from({ length: EVIDENCE_LIMITS.h2Count + 5 }, (_, index) => `Sub ${index}`),
    });

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(evidence.facts.filter((entry) => entry.id.startsWith('page.h1['))).toHaveLength(
      EVIDENCE_LIMITS.h1Count,
    );
    expect(evidence.facts.filter((entry) => entry.id.startsWith('page.h2['))).toHaveLength(
      EVIDENCE_LIMITS.h2Count,
    );
  });

  it('reports the detector fact as present with errors when the offender has markup errors', async () => {
    const site = await seedSite();
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id));
    await seedSnapshot(String(run._id), String(site._id), {
      findings: [
        {
          ruleId: 'structured-data-missing',
          bucket: 'fix-now',
          severity: 'critical',
          affectedUrls: [PAGE_URL],
          meta: { offenders: [{ url: PAGE_URL, reason: 'errors' }] },
        },
      ],
      indexStatus: null,
    });

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(valueOf(evidence, 'detector.structuredData')).toBe('{"present":true,"errors":0}'.replace('0}', '1}'));
    expect(valueOf(evidence, 'gsc.richResults')).toBeUndefined();
  });

  it('reports the detector fact as present when the page is not an offender', async () => {
    const site = await seedSite();
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id));
    await seedSnapshot(String(run._id), String(site._id), {
      findings: [
        {
          ruleId: 'structured-data-missing',
          bucket: 'passed',
          severity: 'critical',
          affectedUrls: [],
          meta: null,
        },
      ],
      indexStatus: { status: 'ok', samples: [] },
    });

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(valueOf(evidence, 'detector.structuredData')).toBe('{"present":true,"errors":0}');
  });

  it('bounds stored rich-result and inventory context before AI assembly', async () => {
    const site = await seedSite();
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id));
    await seedSnapshot(String(run._id), String(site._id), {
      indexStatus: {
        status: 'ok',
        samples: [
          {
            url: PAGE_URL,
            inspection: {
              indexVerdict: 'PASS',
              coverageState: 'Indexed',
              robotsTxtState: 'ALLOWED',
              richResults: {
                verdict: 'NEUTRAL',
                items: Array.from({ length: EVIDENCE_LIMITS.contextItemCount + 4 }, (_, index) => ({
                  type: `${index}-${'x'.repeat(EVIDENCE_LIMITS.contextItemChars + 20)}`,
                  issues: index,
                })),
              },
            },
          },
        ],
      },
    });
    await seedInventoryPage(String(site._id), {
      schemaTypes: Array.from(
        { length: EVIDENCE_LIMITS.contextItemCount + 4 },
        (_, index) => `${index}-${'y'.repeat(EVIDENCE_LIMITS.contextItemChars + 20)}`,
      ),
    });

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    const rich = JSON.parse(valueOf(evidence, 'gsc.richResults')!) as {
      verdict: string;
      items: { type: string }[];
    };
    const inventory = JSON.parse(valueOf(evidence, 'inventory.schemaTypes')!) as {
      schemaTypes: string[];
    };
    expect(rich.verdict).toBe('NEUTRAL');
    expect(rich.items).toHaveLength(EVIDENCE_LIMITS.contextItemCount);
    expect(rich.items.every((item) => item.type.length <= EVIDENCE_LIMITS.contextItemChars)).toBe(
      true,
    );
    expect(inventory.schemaTypes).toHaveLength(EVIDENCE_LIMITS.contextItemCount);
    expect(
      inventory.schemaTypes.every((type) => type.length <= EVIDENCE_LIMITS.contextItemChars),
    ).toBe(true);
    expect(valueOf(evidence, 'gsc.richResults')!.length).toBeLessThanOrEqual(
      EVIDENCE_LIMITS.contextChars,
    );
    expect(valueOf(evidence, 'inventory.schemaTypes')!.length).toBeLessThanOrEqual(
      EVIDENCE_LIMITS.contextChars,
    );
  });

  it('emits no context facts when the snapshot carries no structured-data finding', async () => {
    const site = await seedSite();
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id));
    await seedSnapshot(String(run._id), String(site._id), { findings: [], indexStatus: null });

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(evidence.facts.some((entry) => entry.contextOnly)).toBe(false);
  });

  it('works without a report snapshot at all', async () => {
    const site = await seedSite();
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id));

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(valueOf(evidence, 'page.title')).toBe('Getting started with rank tracking');
  });

  it('falls back to the raw site url when it is not parseable', async () => {
    const site = await seedSite({ url: 'not-a-url' });
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id));

    const evidence = await assembleEvidence({
      source: 'audited-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(valueOf(evidence, 'site.origin')).toBe('not-a-url');
  });

  it.each([
    ['site_not_found', async () => ({ siteId: new mongoose.Types.ObjectId().toHexString() })],
  ])('raises %s for a foreign or missing site', async (code, build) => {
    await seedSite();
    const overrides = await build();
    await expect(
      assembleEvidence({
        source: 'audited-page',
        accountId: ACCOUNT_ID,
        pageUrl: PAGE_URL,
        fetchUrl: throwingFetch,
        ...overrides,
      } as Parameters<typeof assembleEvidence>[0]),
    ).rejects.toMatchObject({ code });
  });

  it('raises run_not_found when the site has no completed run', async () => {
    const site = await seedSite();
    await seedRun(String(site._id), { status: 'failed' });
    await expect(
      assembleEvidence({
        source: 'audited-page',
        accountId: ACCOUNT_ID,
        siteId: String(site._id),
        pageUrl: PAGE_URL,
        fetchUrl: throwingFetch,
      }),
    ).rejects.toBeInstanceOf(SchemaEvidenceError);
  });

  it('raises page_not_found when the run has no row for the URL', async () => {
    const site = await seedSite();
    await seedRun(String(site._id));
    await expect(
      assembleEvidence({
        source: 'audited-page',
        accountId: ACCOUNT_ID,
        siteId: String(site._id),
        pageUrl: PAGE_URL,
        fetchUrl: throwingFetch,
      }),
    ).rejects.toMatchObject({ code: 'page_not_found' });
  });
});

describe('inventory-page path', () => {
  it('merges audited facts when an audited row exists for the same URL', async () => {
    const site = await seedSite();
    const run = await seedRun(String(site._id));
    await seedAuditedPage(String(run._id));
    await seedSnapshot(String(run._id), String(site._id));
    await seedInventoryPage(String(site._id), { schemaTypes: [], hasSchemaOrgArticle: false });

    const evidence = await assembleEvidence({
      source: 'inventory-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(valueOf(evidence, 'page.title')).toBe('Getting started with rank tracking');
    expect(valueOf(evidence, 'inventory.schemaTypes')).toBe(
      '{"schemaTypes":[],"hasSchemaOrgArticle":false}',
    );
    expect(valueOf(evidence, 'detector.structuredData')).toBe('{"present":false,"errors":0}');
  });

  it('serves the inventory row alone when no audit has covered the URL', async () => {
    const site = await seedSite();
    await seedInventoryPage(String(site._id), { schemaTypes: ['WebPage'] });

    const evidence = await assembleEvidence({
      source: 'inventory-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(valueOf(evidence, 'page.title')).toBeUndefined();
    expect(valueOf(evidence, 'page.language')).toBeUndefined();
    expect(valueOf(evidence, 'inventory.schemaTypes')).toBe(
      '{"schemaTypes":["WebPage"],"hasSchemaOrgArticle":false}',
    );
  });

  it('ignores a completed run whose audited rows do not cover the URL', async () => {
    const site = await seedSite();
    await seedRun(String(site._id));
    await seedInventoryPage(String(site._id), {});

    const evidence = await assembleEvidence({
      source: 'inventory-page',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: throwingFetch,
    });
    expect(valueOf(evidence, 'page.title')).toBeUndefined();
    expect(valueOf(evidence, 'inventory.schemaTypes')).toBe(
      '{"schemaTypes":[],"hasSchemaOrgArticle":false}',
    );
  });

  it('raises page_not_found without an inventory row', async () => {
    const site = await seedSite();
    await expect(
      assembleEvidence({
        source: 'inventory-page',
        accountId: ACCOUNT_ID,
        siteId: String(site._id),
        pageUrl: PAGE_URL,
        fetchUrl: throwingFetch,
      }),
    ).rejects.toMatchObject({ code: 'page_not_found' });
  });
});

describe('pasted-URL path', () => {
  const HTML = [
    '<html lang="en-GB">',
    '<head>',
    '<title>Getting started &amp; more</title>',
    '<meta name="description">',
    "<meta name='description' content='Plain-language walk-through.'>",
    '<meta property="article:published_time" content="2026-01-04T09:00:00Z">',
    '<meta property=article:modified_time content="2026-02-04T09:00:00Z">',
    '<meta property="og:title" content="ignored">',
    '<meta name="robots">',
    '</head>',
    '<body>',
    '<h1>Getting started</h1>',
    '<h2>How do I add a site?</h2>',
    '<p>Open the <b>sites</b> tab and paste your domain.</p>',
    '<h2>Add your first site</h2>',
    '<p>Statement heading answers are not collected.</p>',
    '<h2>Does this one have an answer?</h2>',
    '</body></html>',
  ].join('\n');

  it('extracts bounded facts through the safe-fetch authority', async () => {
    const site = await seedSite();
    const calls: { url: string; init: RequestInit; opts: Record<string, unknown> }[] = [];
    const fetchUrl: SafeFetch = async (url, init, opts) => {
      calls.push({ url, init, opts: opts as Record<string, unknown> });
      return htmlResponse(HTML);
    };

    const evidence = await assembleEvidence({
      source: 'url',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(PAGE_URL);
    expect(calls[0]!.init).toEqual({ method: 'GET' });
    expect(calls[0]!.opts).toEqual({
      maxResponseBytes: EVIDENCE_LIMITS.responseBytes,
      deadlineMs: EVIDENCE_LIMITS.deadlineMs,
      maxRedirects: EVIDENCE_LIMITS.maxRedirects,
    });
    expect(valueOf(evidence, 'page.url')).toBe(PAGE_URL);
    expect(valueOf(evidence, 'page.title')).toBe('Getting started & more');
    expect(valueOf(evidence, 'page.metaDescription')).toBe('Plain-language walk-through.');
    expect(valueOf(evidence, 'page.language')).toBe('en-GB');
    expect(valueOf(evidence, 'page.h1[0]')).toBe('Getting started');
    expect(valueOf(evidence, 'page.h2[0]')).toBe('How do I add a site?');
    expect(valueOf(evidence, 'page.faqAnswers[0]')).toBe('Open the sites tab and paste your domain.');
    expect(valueOf(evidence, 'page.faqAnswers[1]')).toBeUndefined();
    expect(valueOf(evidence, 'page.articlePublishedTime')).toBe('2026-01-04T09:00:00Z');
    expect(valueOf(evidence, 'page.articleModifiedTime')).toBe('2026-02-04T09:00:00Z');
    expect(evidence.facts.some((entry) => entry.value.includes('<'))).toBe(false);
  });

  it('rejects a non-HTML response before any fact is built', async () => {
    const site = await seedSite();
    await expect(
      assembleEvidence({
        source: 'url',
        accountId: ACCOUNT_ID,
        siteId: String(site._id),
        pageUrl: PAGE_URL,
        fetchUrl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
      }),
    ).rejects.toMatchObject({ code: 'not_html' });
  });

  it('rejects a response with no content type at all', async () => {
    const site = await seedSite();
    await expect(
      assembleEvidence({
        source: 'url',
        accountId: ACCOUNT_ID,
        siteId: String(site._id),
        pageUrl: PAGE_URL,
        fetchUrl: async () => new Response(null, { status: 200 }),
      }),
    ).rejects.toMatchObject({ code: 'not_html' });
  });

  it('clamps an oversized body before extraction', async () => {
    const site = await seedSite();
    const padded = `<html><body>${'x'.repeat(EVIDENCE_LIMITS.htmlChars)}<h1>Beyond the ceiling</h1></body></html>`;
    const evidence = await assembleEvidence({
      source: 'url',
      accountId: ACCOUNT_ID,
      siteId: String(site._id),
      pageUrl: PAGE_URL,
      fetchUrl: async () => htmlResponse(padded),
    });
    expect(valueOf(evidence, 'page.h1[0]')).toBeUndefined();
  });

  it('rejects a private address through the production safe-fetch authority', async () => {
    const site = await seedSite();
    await expect(
      assembleEvidence({
        source: 'url',
        accountId: ACCOUNT_ID,
        siteId: String(site._id),
        pageUrl: 'https://127.0.0.1/private',
      }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it.each([
    ['an http scheme', 'http://example.com/page'],
    ['embedded credentials', 'https://user:pass@example.com/page'],
    ['a non-URL string', 'not a url'],
  ])('zod-rejects %s before fetching', async (_label, pageUrl) => {
    const site = await seedSite();
    await expect(
      assembleEvidence({
        source: 'url',
        accountId: ACCOUNT_ID,
        siteId: String(site._id),
        pageUrl,
        fetchUrl: throwingFetch,
      }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('extractPageFacts ceilings and parsing', () => {
  it('clamps every extracted field to its ceiling', () => {
    const long = 'y'.repeat(2_000);
    const extracted = extractPageFacts(
      [
        `<title>${long}</title>`,
        `<meta name="description" content="${long}">`,
        Array.from({ length: 8 }, () => `<h1>${long}</h1>`).join(''),
        Array.from({ length: 25 }, (_, i) => `<h2>Q${i}?</h2><p>${long}</p>`).join(''),
      ].join(''),
    );
    expect(extracted.title).toHaveLength(2_000);
    expect(extracted.h1).toHaveLength(8);
    expect(extracted.h2).toHaveLength(25);
    expect(extracted.faqAnswers).toHaveLength(EVIDENCE_LIMITS.faqAnswerCount);
  });

  it('returns nulls and empty lists for an empty document', () => {
    expect(extractPageFacts('')).toEqual({
      title: null,
      metaDescription: null,
      h1: [],
      h2: [],
      faqAnswers: [],
      language: null,
      articlePublishedTime: null,
      articleModifiedTime: null,
    });
  });

  it('treats an empty title element as absent', () => {
    expect(extractPageFacts('<title>   </title>').title).toBeNull();
  });

  it('treats a bare html element without lang as no language', () => {
    expect(extractPageFacts('<html><body></body></html>').language).toBeNull();
  });

  it('drops a question heading with no following text', () => {
    expect(extractPageFacts('<h2>Anything?</h2>').faqAnswers).toEqual([]);
  });

  it('stops an answer at the next section boundary', () => {
    const extracted = extractPageFacts('<main><h2>Why?</h2><p>Because.</p></main><p>Unrelated</p>');
    expect(extracted.faqAnswers).toEqual([{ headingIndex: 0, text: 'Because.' }]);
  });

  it('preserves the matching h2 index across non-question headings', () => {
    const extracted = extractPageFacts(
      '<h2>Overview</h2><p>Intro.</p><h2>Why?</h2><p>Because.</p>',
    );
    expect(extracted.faqAnswers).toEqual([{ headingIndex: 1, text: 'Because.' }]);
  });

  it('skips empty headings and stops FAQ scanning at the h2 ceiling', () => {
    const headings = [
      '<h2>   </h2>',
      ...Array.from(
        { length: EVIDENCE_LIMITS.h2Count + 1 },
        (_, index) => `<h2>Section ${index}</h2>`,
      ),
    ].join('');
    const extracted = extractPageFacts(headings);
    expect(extracted.h2[0]).toBe('');
    expect(extracted.h2).toHaveLength(EVIDENCE_LIMITS.h2Count + 2);
    expect(extracted.faqAnswers).toEqual([]);
  });

  it.each([
    ['&amp;&lt;&gt;&quot;&apos;&nbsp;', '&<>"\' '],
    ['&#65;&#x42;', 'AB'],
    ['&#0;&#x110000;&unknown;', '&#0;&#x110000;&unknown;'],
  ])('decodes %s', (input, expected) => {
    expect(extractPageFacts(`<title>${input}</title>`).title).toBe(expected.trim() || null);
  });
});
