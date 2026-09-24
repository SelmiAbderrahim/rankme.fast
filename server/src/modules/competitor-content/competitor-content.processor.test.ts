/**
 * Competitor content processor tests (spec 09). Full pipeline against real
 * PGlite + mongodb-memory-server with a fake content source + fake AI runner
 * and an injected resolver (no real DNS). Proves:
 *   - evidence → scrape → deterministic deltas → partial budget stop → AI →
 *     n-gram guard rejects copied prose → opportunities;
 *   - deterministic deltas are INDEPENDENT of the AI output;
 *   - NO raw HTML is ever stored;
 *   - owned-unusable / no-comparable-pages / cancel each record one terminal
 *     event keyed by the run's idempotency key;
 *   - terminal replay + missing-run are no-ops.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import pino from 'pino';
import { eq } from 'drizzle-orm';
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
import type {
  ContentDocument,
  ContentSourceProvider,
  ScrapePageResult,
} from '../../shared/providers/content-source.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { PublicUrlResolver } from '../../shared/security/url-safety.js';
import { competitorContentEvents } from '../../db/schema/competitor-content-events.js';
import { competitorProfiles } from '../../db/schema/index.js';
import { Site } from '../sites/index.js';
import {
  CompetitorContentRun,
  CompetitorContentSnapshot,
  CompetitorPageFacts,
} from './competitor-content.model.js';
import * as deltaModule from './competitor-content.delta.js';
import * as collectModule from './competitor-content.collect.js';
import {
  advance,
  addWarning,
  createCompetitorContentProcessor,
  competitorContentProcessorTestables,
  finalize,
  runAiComparison,
  type CompetitorContentProcessorDeps,
} from './competitor-content.processor.js';

const ACCOUNT = '000000000000000000000abc';
const SITE = '000000000000000000000def';
const logger = pino({ level: 'silent' });
const db = (): ApplicationDb => getTestDb() as unknown as ApplicationDb;
const publicResolver: PublicUrlResolver = async () => [{ address: '8.8.8.8', family: 4 }];

const COMPETITOR_SNIPPET = 'Marathon training plans build weekly mileage with long runs speed work and recovery days';

function doc(url: string, over: Partial<ContentDocument> = {}): ContentDocument {
  return {
    sourceUrl: url,
    statusCode: 200,
    title: url.includes('rival') ? 'Marathon training' : 'Best running shoes',
    description: 'desc',
    canonical: url,
    robots: ['index'],
    language: 'en',
    markdown: '# t',
    text: url.includes('rival') ? COMPETITOR_SNIPPET : 'Owned running shoes buying guide with sizing tips',
    headings: url.includes('rival')
      ? [{ level: 1, text: 'Marathon' }, { level: 2, text: 'Weekly mileage' }, { level: 2, text: 'Speed work' }, { level: 2, text: 'Recovery' }]
      : [{ level: 1, text: 'Shoes' }],
    links: [{ url: `${url}x`, external: false }],
    structuredData: url.includes('rival') ? [{ type: 'FAQPage', property: 'q', value: 'a' }] : [],
    contentHash: `hash-${url}`,
    capturedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function fakeSource(script: Record<string, () => Promise<ScrapePageResult> | ScrapePageResult> = {}): ContentSourceProvider {
  return {
    async scrapePage(input) {
      const h = script[input.url];
      if (h) return h();
      return { document: doc(input.url), usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true } };
    },
    async crawlSite() { throw new Error('unused'); },
  };
}

function fakeAi(object: unknown = { comparison: 'Your page is shorter and lacks FAQ schema; expand it.', citations: [] }, cost = 10_000n): AiProfileRunner {
  return { async run() { return { object, provenance: { actualOrEstimatedCostMicros: cost } }; } } as unknown as AiProfileRunner;
}

function baseDeps(over: Partial<CompetitorContentProcessorDeps> = {}): CompetitorContentProcessorDeps {
  return {
    db: db(),
    contentSource: fakeSource(),
    ai: fakeAi(),
    aiProviderOrder: [],
    logger,
    resolver: publicResolver,
    ...over,
  };
}

async function makeRun(over: Record<string, unknown> = {}): Promise<string> {
  const key = `res_${Math.random().toString(36).slice(2)}`;
  const requestedInput = (over.input as {
    competitorIds: string[];
    competitorDomains: string[];
    pageLimit: number;
  } | undefined) ?? { competitorIds: ['a'], competitorDomains: ['rival.com'], pageLimit: 15 };
  const ownedUrl = (over.ownedUrl as string | undefined) ?? 'https://example.com/page';
  await Site.updateOne(
    { _id: SITE },
    { $setOnInsert: { accountId: ACCOUNT, url: 'https://example.com', domain: 'example.com', label: 's' } },
    { upsert: true },
  );
  const profileIds = requestedInput.competitorDomains.map(
    (_domain, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  for (const [index, domain] of requestedInput.competitorDomains.entries()) {
    await db().insert(competitorProfiles).values({
      id: profileIds[index]!,
      accountId: ACCOUNT,
      siteId: SITE,
      origin: `https://${domain}`,
      registrableDomain: domain,
      source: 'manual',
      status: 'active',
    }).onConflictDoNothing();
  }
  const input = {
    competitorIds: profileIds,
    competitorDomains: requestedInput.competitorDomains,
    pageLimit: requestedInput.pageLimit,
    compatibilityMode: 'legacy_explicit',
    pageMatches: requestedInput.competitorDomains.map((domain, index) => ({
      source: 'legacy_explicit',
      landscapeReportId: null,
      landscapeOpportunityId: null,
      suggestionId: null,
      competitorProfileId: profileIds[index]!,
      competitorDomain: domain,
      suggestedRankingUrl: `https://${domain}/`,
      selectedUrl: `https://${domain}/`,
      ownedUrl,
      keywordEvidence: [{
        keyword: 'running',
        class: 'shared_behind',
        ownedPosition: 8,
        competitorPosition: 3,
        ownedUrl,
        competitorUrl: `https://${domain}/`,
        searchVolume: 100,
        intent: 'informational',
        provenanceIndexes: [0],
      }],
    })),
  };
  const { input: _input, ownedUrl: _ownedUrl, ...rest } = over;
  const run = await CompetitorContentRun.create({
    accountId: ACCOUNT,
    ownerUserId: ACCOUNT,
    siteId: SITE,
    origin: 'https://example.com',
    ownedUrl,
    keyword: 'running',
    locale: 'en',
    status: 'queued',
    input,
    stages: [{ name: 'queued', startedAt: new Date(), completedAt: null, error: null }],
    warnings: [],
    error: null,
    inputFingerprint: `fp_${key}`,
    idempotencyKey: key,
    requestedAt: new Date(),
    costMicros: 0,
    aiCostMicros: 0,
    ...rest,
  });
  return String(run._id);
}

function job(runId: string): Job {
  const run = { accountId: ACCOUNT, siteId: SITE, runId, reservationKey: 'res-x' };
  return { data: run } as unknown as Job;
}

async function eventKinds(): Promise<string[]> {
  const rows = await db().select().from(competitorContentEvents).where(eq(competitorContentEvents.accountId, ACCOUNT));
  return rows.map((r) => r.kind).sort();
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopMemoryMongo();
  await stopTestPostgres();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await clearCollections();
  await truncateAllTables();
});

describe('createCompetitorContentProcessor — terminal short-circuits', () => {
  it('drops a job whose run is missing', async () => {
    await createCompetitorContentProcessor(baseDeps())(job('0000000000000000000000ff') as never, undefined as never);
    // No throw, nothing persisted.
    expect(await CompetitorContentRun.countDocuments({})).toBe(0);
  });

  it('no-ops on a terminal run (replay)', async () => {
    const runId = await makeRun({ status: 'completed' });
    await createCompetitorContentProcessor(baseDeps())(job(runId) as never, undefined as never);
    expect((await CompetitorContentRun.findById(runId))!.status).toBe('completed');
  });

  it('returns when the run goes terminal before the collecting advance', async () => {
    const runId = await makeRun();
    // First findById (the top guard) sees queued; advance() re-loads and sees null.
    const spy = vi.spyOn(CompetitorContentRun, 'findById').mockResolvedValueOnce(null as never);
    await createCompetitorContentProcessor(baseDeps())(job(runId) as never, undefined as never);
    spy.mockRestore();
    expect((await CompetitorContentRun.findById(runId))!.status).toBe('queued');
  });
});

describe('createCompetitorContentProcessor — pipeline', () => {
  it('completes the full pipeline with deterministic deltas + AI explanation', async () => {
    const runId = await makeRun();
    await createCompetitorContentProcessor(baseDeps())(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('completed');
    const findings = run!.findings as { deltas: unknown[]; opportunities: unknown[]; aiExplanation: string | null };
    expect(findings.deltas).toHaveLength(1);
    expect(findings.opportunities.length).toBeGreaterThan(0);
    expect(findings.aiExplanation).toBe('Your page is shorter and lacks FAQ schema; expand it.');
    // Owned + competitor page facts persisted.
    expect(await CompetitorPageFacts.countDocuments({ runId: run!._id })).toBe(2);
    expect(await eventKinds()).toEqual(['completed']);
  });

  it('stores NO raw HTML in page facts or snapshots', async () => {
    const runId = await makeRun();
    const nasty = fakeSource({
      'https://rival.com/': () => ({
        document: doc('https://rival.com/', { text: 'clean words here <script>evil()</script> more text', title: 'Rival <iframe>' }),
        usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true },
      }),
    });
    await createCompetitorContentProcessor(baseDeps({ contentSource: nasty }))(job(runId) as never, undefined as never);
    const snapshots = await CompetitorContentSnapshot.find({});
    for (const s of snapshots) expect(s.excerpt.toLowerCase()).not.toContain('<script');
    const pages = await CompetitorPageFacts.find({});
    for (const p of pages) expect(JSON.stringify(p.facts).toLowerCase()).not.toContain('<script');
  });

  it('REJECTS an AI explanation that reproduces a competitor snippet (n-gram guard)', async () => {
    const runId = await makeRun();
    // The model echoes the competitor snippet almost verbatim.
    const deps = baseDeps({ ai: fakeAi({ comparison: COMPETITOR_SNIPPET, citations: [] }) });
    await createCompetitorContentProcessor(deps)(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect((run!.findings as { aiExplanation: string | null }).aiExplanation).toBeNull();
    expect(run!.warnings.some((w) => w.code === 'competitor_ai_rejected')).toBe(true);
    // Cost is still counted (the model ran).
    expect(Number(run!.aiCostMicros)).toBeGreaterThan(0);
  });

  it('produces IDENTICAL deltas regardless of the AI output (determinism)', async () => {
    const run1 = await makeRun();
    await createCompetitorContentProcessor(baseDeps({ ai: fakeAi({ comparison: 'AAA unique one', citations: [] }) }))(job(run1) as never, undefined as never);
    const run2 = await makeRun();
    await createCompetitorContentProcessor(baseDeps({ ai: fakeAi({ comparison: 'BBB different two', citations: [] }) }))(job(run2) as never, undefined as never);
    const d1 = (await CompetitorContentRun.findById(run1))!.findings as { deltas: unknown };
    const d2 = (await CompetitorContentRun.findById(run2))!.findings as { deltas: unknown };
    expect(JSON.stringify(d1.deltas)).toBe(JSON.stringify(d2.deltas));
  });

  it('finishes partial when a competitor page cannot be read', async () => {
    const runId = await makeRun({ input: { competitorIds: ['a', 'b'], competitorDomains: ['rival.com', 'bad.com'], pageLimit: 15 } });
    const src = fakeSource({ 'https://bad.com/': () => { throw new Error('scrape failed'); } });
    await createCompetitorContentProcessor(baseDeps({ contentSource: src }))(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('partial');
    expect((run!.findings as { partialDomains: string[] }).partialDomains).toContain('bad.com');
    expect(run!.warnings.some((w) => w.code === 'competitor_partial')).toBe(true);
  });

  it('adds the stopped-early warning + skips AI when the budget is exhausted', async () => {
    const runId = await makeRun({ input: { competitorIds: ['a', 'b'], competitorDomains: ['rival.com', 'big.com'], pageLimit: 15 } });
    const src = fakeSource({
      // rival.com admitted cheaply, then big.com would blow the ceiling.
      'https://rival.com/': () => ({ document: doc('https://rival.com/'), usage: { credits: 1, estimatedCostMicros: 100n, estimated: true } }),
      'https://big.com/': () => ({ document: doc('https://big.com/'), usage: { credits: 1, estimatedCostMicros: 999_999n, estimated: true } }),
    });
    // Ceiling admits owned (1_000) + rival (100) = 1_100, then stops before big.com.
    await createCompetitorContentProcessor(baseDeps({ contentSource: src, costCeilingMicros: 2_000, aiBudgetMicros: 0 }))(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('partial');
    expect(run!.warnings.some((w) => w.code === 'competitor_stopped_early')).toBe(true);
    expect((run!.findings as { aiExplanation: string | null }).aiExplanation).toBeNull();
    expect(run!.warnings.some((w) => w.code === 'competitor_ai_skipped')).toBe(true);
  });
});

describe('createCompetitorContentProcessor — failed and cancelled terminal stops', () => {
  it.each([
    ['profile mismatch', { competitorDomain: 'wrong.example' }],
    ['unsafe URL', { selectedUrl: 'http://127.0.0.1/private' }],
  ])('fails before provider spend for a frozen %s', async (_label, override) => {
    const runId = await makeRun();
    const run = await CompetitorContentRun.findById(runId).lean();
    const match = run?.input.pageMatches[0];
    if (!match) throw new Error('test fixture did not create a frozen page match');
    await CompetitorContentRun.collection.updateOne(
      { _id: run?._id },
      { $set: { 'input.pageMatches': [{ ...match, ...override }] } },
    );
    const source = fakeSource();
    const scrape = vi.spyOn(source, 'scrapePage');
    await createCompetitorContentProcessor(baseDeps({ contentSource: source }))(
      job(runId) as never,
      undefined as never,
    );
    const failed = await CompetitorContentRun.findById(runId);
    expect(failed?.status).toBe('failed');
    expect(failed?.error?.category).toBe('no_confirmed_competitors');
    expect(scrape).not.toHaveBeenCalled();
  });

  it('fails when the owned page is unusable', async () => {
    const runId = await makeRun();
    const src = fakeSource({ 'https://example.com/page': () => { throw new Error('boom'); } });
    await createCompetitorContentProcessor(baseDeps({ contentSource: src }))(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('failed');
    expect(run!.error!.category).toBe('owned_page_unusable');
    expect(await eventKinds()).toEqual(['failed']);
    const events = await db().select().from(competitorContentEvents).where(eq(competitorContentEvents.runId, runId));
    expect(events.map((event) => event.reservationKey)).toEqual([run!.idempotencyKey]);
  });

  it('fails when no competitor page can be read', async () => {
    const runId = await makeRun();
    const src = fakeSource({ 'https://rival.com/': () => { throw new Error('boom'); } });
    await createCompetitorContentProcessor(baseDeps({ contentSource: src }))(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('failed');
    expect(run!.error!.category).toBe('no_comparable_pages');
  });

  it('fails when collection throws', async () => {
    const runId = await makeRun();
    vi.spyOn(collectModule, 'collectPages').mockRejectedValueOnce(new Error('collect exploded'));
    await createCompetitorContentProcessor(baseDeps())(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('failed');
    expect(run!.error!.category).toBe('collection_failed');
  });

  it('fails when the comparison throws', async () => {
    const runId = await makeRun();
    vi.spyOn(deltaModule, 'compareReviewedPairs').mockImplementationOnce(() => { throw new Error('cmp boom'); });
    await createCompetitorContentProcessor(baseDeps())(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('failed');
    expect(run!.error!.category).toBe('comparison_failed');
  });

  it('cancels when the collection signal is aborted', async () => {
    const runId = await makeRun();
    const controller = new AbortController();
    controller.abort();
    await createCompetitorContentProcessor(baseDeps({ signal: controller.signal }))(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('cancelled');
    expect(await eventKinds()).toEqual(['cancelled']);
  });

  it('no-ops when the run went terminal during collection', async () => {
    const runId = await makeRun();
    // The competitor scrape cancels the run as a side effect, so the
    // post-collect terminal re-check short-circuits.
    const src = fakeSource({
      'https://rival.com/': async () => {
        await CompetitorContentRun.updateOne({ _id: runId }, { $set: { status: 'cancelled', completedAt: new Date() } });
        return { document: doc('https://rival.com/'), usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true } };
      },
    });
    await createCompetitorContentProcessor(baseDeps({ contentSource: src }))(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('cancelled');
    // No completed/failed event — the processor short-circuited.
    expect(await eventKinds()).toEqual([]);
  });

  it('tolerates a page-persist failure without aborting the run', async () => {
    const runId = await makeRun();
    vi.spyOn(CompetitorPageFacts, 'updateOne').mockRejectedValueOnce(new Error('mongo down'));
    await createCompetitorContentProcessor(baseDeps())(job(runId) as never, undefined as never);
    // The run still finishes (owned persist failed, but the crawl continues).
    const run = await CompetitorContentRun.findById(runId);
    expect(['completed', 'partial', 'failed']).toContain(run!.status);
  });

  it('skips the snapshot for a page whose excerpt is empty', async () => {
    const runId = await makeRun();
    const src = fakeSource({
      'https://rival.com/': () => ({ document: doc('https://rival.com/', { text: '   ' }), usage: { credits: 1, estimatedCostMicros: 1_000n, estimated: true } }),
    });
    await createCompetitorContentProcessor(baseDeps({ contentSource: src }))(job(runId) as never, undefined as never);
    const snaps = await CompetitorContentSnapshot.find({});
    // Owned excerpt is non-empty; the competitor's whitespace text → no snapshot.
    expect(snaps.some((s) => s.sourceUrl.includes('rival'))).toBe(false);
    expect(snaps.some((s) => s.sourceUrl.includes('example.com'))).toBe(true);
  });

  it('runs without an injected resolver (real DNS path) + no focus keyword', async () => {
    const runId = await makeRun({ keyword: null, ownedUrl: 'https://example.com/page', input: { competitorIds: ['a'], competitorDomains: ['example.org'], pageLimit: 15 } });
    await createCompetitorContentProcessor({ db: db(), contentSource: fakeSource(), ai: fakeAi(), aiProviderOrder: [], logger })(job(runId) as never, undefined as never);
    const run = await CompetitorContentRun.findById(runId);
    expect(run!.status).toBe('completed');
    expect((run!.findings as { keyword: string | null }).keyword).toBeNull();
  });

  it('no-ops when the run goes terminal right before the comparing advance', async () => {
    const runId = await makeRun();
    const orig = CompetitorContentRun.findById.bind(CompetitorContentRun);
    let n = 0;
    vi.spyOn(CompetitorContentRun, 'findById').mockImplementation(((id: unknown) => {
      n += 1;
      // Calls: 1 advance(collecting), 2 afterCollect, 3 advance(comparing) → null.
      return (n === 3 ? Promise.resolve(null) : orig(id as never)) as never;
    }) as never);
    await createCompetitorContentProcessor(baseDeps())(job(runId) as never, undefined as never);
    const run = await orig(runId);
    expect(run!.status).toBe('collecting');
  });
});

describe('exported helpers', () => {
  it('drops malformed frozen page matches while retaining valid entries', async () => {
    const run = await CompetitorContentRun.findById(await makeRun()).lean();
    const valid = run?.input.pageMatches[0];
    if (!valid) throw new Error('test fixture did not create a frozen page match');
    expect(
      competitorContentProcessorTestables.parseFrozenPageMatches([
        { malformed: true },
        valid,
      ]),
    ).toEqual([valid]);
  });

  it('normalizes comparable URLs and fails null or malformed candidates closed', () => {
    expect(
      competitorContentProcessorTestables.sameNormalizedPageUrl(
        'https://example.com/page',
        'https://example.com/page',
      ),
    ).toBe(true);
    expect(
      competitorContentProcessorTestables.sameNormalizedPageUrl(null, 'https://example.com/page'),
    ).toBe(false);
    expect(
      competitorContentProcessorTestables.sameNormalizedPageUrl('not a URL', 'https://example.com/page'),
    ).toBe(false);
  });

  it('addWarning dedupes by code', async () => {
    const run = await CompetitorContentRun.findById(await makeRun());
    addWarning(run!, 'x', 'key');
    addWarning(run!, 'x', 'key');
    expect(run!.warnings.filter((w) => w.code === 'x')).toHaveLength(1);
  });

  it('advance returns null for a terminal or missing run', async () => {
    const runId = await makeRun({ status: 'completed' });
    expect(await advance(runId, 'collecting', () => new Date())).toBeNull();
    expect(await advance('0000000000000000000000ff', 'collecting', () => new Date())).toBeNull();
  });

  it('advance is idempotent when already at the target stage', async () => {
    const runId = await makeRun({ status: 'collecting' });
    const doc2 = await advance(runId, 'collecting', () => new Date());
    expect(doc2!.status).toBe('collecting');
  });

  it('advance skips the stage-complete stamp when no open stage matches', async () => {
    const runId = await makeRun({ stages: [] });
    const doc2 = await advance(runId, 'collecting', () => new Date());
    expect(doc2!.status).toBe('collecting');
  });

  it('finalize stamps a terminal state even with no open stage entry', async () => {
    const runId = await makeRun({ status: 'collecting', stages: [] });
    await finalize({ db: db(), payload: { accountId: ACCOUNT, siteId: SITE, runId, reservationKey: 'k' }, status: 'completed', now: () => new Date() });
    expect((await CompetitorContentRun.findById(runId))!.status).toBe('completed');
  });

  it('finalize short-circuits a terminal or missing run', async () => {
    const runId = await makeRun({ status: 'completed' });
    await finalize({ db: db(), payload: { accountId: ACCOUNT, siteId: SITE, runId, reservationKey: 'k' }, status: 'failed', now: () => new Date() });
    expect((await CompetitorContentRun.findById(runId))!.status).toBe('completed');
    await finalize({ db: db(), payload: { accountId: ACCOUNT, siteId: SITE, runId: '0000000000000000000000ff', reservationKey: 'k' }, status: 'failed', now: () => new Date() });
  });

  it('runAiComparison returns null when no competitor snippets are supplied', async () => {
    const run = await CompetitorContentRun.findById(await makeRun());
    const owned = { url: 'https://example.com/p', role: 'owned' as const, competitorDomain: null, statusCode: 200, title: 't', description: null, headings: [], wordCount: 1, schemaTypes: [], hasSchemaOrgArticle: false, internalLinkCount: 0, externalLinkCount: 0, contentHash: 'h', primaryTopics: [], secondaryTopics: [], snippet: '' };
    const result = await runAiComparison(baseDeps(), run!, owned, [], 140_000, 250_000);
    expect(result.explanation).toBeNull();
  });

  it('runAiComparison handles a domain-null page, missing cost, and empty output', async () => {
    const run = await CompetitorContentRun.findById(await makeRun());
    const owned = { url: 'https://example.com/p', role: 'owned' as const, competitorDomain: null, statusCode: 200, title: 't', description: null, headings: [], wordCount: 1, schemaTypes: [], hasSchemaOrgArticle: false, internalLinkCount: 0, externalLinkCount: 0, contentHash: 'h', primaryTopics: [], secondaryTopics: [], snippet: '' };
    const page = { facts: { ...owned, role: 'competitor' as const, snippet: 'competitor evidence words here', url: 'https://rival.com/' }, excerpt: 'x', contentHash: 'h', domain: null, costMicros: 0 };
    const emptyAi = { async run() { return { object: { comparison: '', citations: [] }, provenance: {} }; } } as unknown as AiProfileRunner;
    const result = await runAiComparison(baseDeps({ ai: emptyAi }), run!, owned, [page], 140_000, 250_000);
    expect(result.explanation).toBeNull(); // empty comparison → null
    expect(result.aiCostMicros).toBe(0); // missing provenance cost → 0n → 0
  });

  it('runAiComparison skips + warns when the AI call throws', async () => {
    const run = await CompetitorContentRun.findById(await makeRun());
    const owned = { url: 'https://example.com/p', role: 'owned' as const, competitorDomain: null, statusCode: 200, title: 't', description: null, headings: [], wordCount: 1, schemaTypes: [], hasSchemaOrgArticle: false, internalLinkCount: 0, externalLinkCount: 0, contentHash: 'h', primaryTopics: [], secondaryTopics: [], snippet: '' };
    const throwingAi = { async run() { throw new Error('ai down'); } } as unknown as AiProfileRunner;
    const page = { facts: { ...owned, role: 'competitor' as const, snippet: 'competitor words here', url: 'https://rival.com/' }, excerpt: 'x', contentHash: 'h', domain: 'rival.com', costMicros: 0 };
    const result = await runAiComparison(baseDeps({ ai: throwingAi }), run!, owned, [page], 140_000, 250_000);
    expect(result.explanation).toBeNull();
    expect(run!.warnings.some((w) => w.code === 'competitor_ai_skipped')).toBe(true);
  });
});
