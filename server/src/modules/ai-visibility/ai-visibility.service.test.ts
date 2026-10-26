/**
 * Direct unit coverage for the ai-visibility service + repository internals
 * (pure classifiers, prompt-cap race paths, evaluation-input builder, and the
 * `now`-injected / summary-provider / competitor-insert branches that the HTTP
 * layer in `ai-visibility.routes.test.ts` cannot reach).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
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
import type { Db } from '../../db/client.js';
import { Site } from '../sites/index.js';
import {
  aiCompetitorMentions,
  aiMentionSnapshots,
  aiTrackedPrompts,
  gscSearchAnalytics,
  keywordResearchHistory,
  vendorResponses,
} from '../../db/schema/index.js';
import { competitors } from '../../db/schema/competitors.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
import { AuditRun } from '../audits/audit-run.model.js';
import { AuditedPage } from '../audits/audited-page.model.js';
import {
  FAKE_CLOCK,
  VendorUnavailableError,
  createFakeAiVisibilityProvider,
  createFakeProfileSummaryProvider,
  createFakeSummaryProvider,
  recordVendorCostUsd,
  type GeneratePromptsInput,
  type AiAnswerRow,
  type AiMentionRow,
  type AiVisibilityProvider,
  type SummarizeResult,
  type SummaryProvider,
} from '../../shared/providers/index.js';
import { KEYWORD_MAX_LENGTH } from '../../shared/security/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { CooldownError, createInMemoryCooldown } from '../../shared/cooldown/index.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import {
  MAX_TRACKED_AI_PROMPTS,
  PromptAlreadyTrackedError,
  PromptCapReachedError,
  addTrackedPrompt,
  listStoredCompetitorDomains,
  listTrackedPrompts,
  trackedPromptKey,
  listKeywordPhrases,
  readAiOverviewRollup,
  readRecentCompetitorMentions,
  readRecentMentions,
  removeTrackedPrompt,
  upsertCompetitorMentions,
  upsertMentionSnapshot,
} from './ai-visibility.repository.js';
import { insertSuggestionRun, listGscQuerySeeds } from './ai-visibility.repository.js';
import { logger } from '../../config/logger.js';
import {
  addPromptForSite,
  buildAiVisibilityEvaluationInput,
  buildPromptCandidates,
  checkMentions,
  classifySentiment,
  clearAiVisibilityRowsForTests,
  computeShareOfVoicePct,
  getAiVisibilityOverview,
  getAiVisibilityTrend,
  heuristicSentiment,
  listAuditPageEvidence,
  listAuditTitleSeeds,
  loadOwnedSite,
  generatePromptSuggestions,
  readStoredSuggestions,
  removePromptForSite,
  siteDescriptionSeed,
  SUGGESTION_TARGET,
} from './ai-visibility.service.js';

const NOW = () => new Date('2026-01-15T00:00:00.000Z');
const OUTPUT_LOCALE = 'en' as const;

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

// PGlite's `TestDb` is structurally the same as the app's `Db` at runtime; the
// nominal generic differs, so narrow it here once (mirrors the sibling suites).
function testDb(): Db {
  return getTestDb() as unknown as Db;
}

function newAccountId(): string {
  return new mongoose.Types.ObjectId().toString();
}

async function seedSite(accountId: string, domain = 'example.com'): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
    gscPropertyUrl: `sc-domain:${domain}`,
    gscBindingGenerationId: 'legacy',
  });
  return (site._id as mongoose.Types.ObjectId).toString();
}

async function catchError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject, but it resolved');
}

// Satisfies the SummaryProvider contract on stubs that only exercise summarize().
const stubGeneratePrompts = async () => ({ prompts: [], model: 'stub-summary' });

function summaryStub(text: string): SummaryProvider {
  const result: SummarizeResult = { summary: text, truncated: false, model: 'stub' };
  return { generatePrompts: stubGeneratePrompts, async summarize() {
    return result;
  } };
}

// ---------------------------------------------------------------------------
// Pure classifiers
// ---------------------------------------------------------------------------

describe('heuristicSentiment', () => {
  it('is positive when a positive word sits near the in-text brand', () => {
    expect(heuristicSentiment('Example.com is excellent and trusted', 'example.com')).toBe(
      'positive',
    );
  });

  it('is negative when a negative word sits near the in-text brand', () => {
    expect(heuristicSentiment('example.com is poor and unreliable', 'example.com')).toBe(
      'negative',
    );
  });

  it('is neutral when the brand appears but no sentiment word does', () => {
    expect(heuristicSentiment('example.com is a website for teams', 'example.com')).toBe('neutral');
  });

  it('is neutral when positive and negative words tie', () => {
    expect(heuristicSentiment('example.com is excellent but expensive', 'example.com')).toBe(
      'neutral',
    );
  });

  it('is neutral when the brand is absent, even with sentiment words present', () => {
    expect(heuristicSentiment('this tool is excellent and trusted', 'absent.example')).toBe(
      'neutral',
    );
  });
});

describe('classifySentiment', () => {
  it('falls back to the heuristic when no summary provider is supplied', async () => {
    await expect(
      classifySentiment({ answer: 'example.com is excellent', domain: 'example.com' }),
    ).resolves.toBe('positive');
  });

  it('falls back to the heuristic when summaryProvider is explicitly null', async () => {
    await expect(
      classifySentiment({
        answer: 'example.com is poor',
        domain: 'example.com',
        summaryProvider: null,
      }),
    ).resolves.toBe('negative');
  });

  it('maps a "negative" summary to negative', async () => {
    await expect(
      classifySentiment({
        answer: 'anything',
        domain: 'example.com',
        summaryProvider: summaryStub('This reads NEGATIVE overall.'),
      }),
    ).resolves.toBe('negative');
  });

  it('maps a "positive" summary to positive', async () => {
    await expect(
      classifySentiment({
        answer: 'anything',
        domain: 'example.com',
        summaryProvider: summaryStub('Strongly positive coverage.'),
      }),
    ).resolves.toBe('positive');
  });

  it('keeps the classifier instruction locale fixed and exposes only the stable enum', async () => {
    let requestedLocale: string | undefined;
    const provider: SummaryProvider = {
      generatePrompts: stubGeneratePrompts,
      async summarize(input) {
        requestedLocale = input.locale;
        return {
          summary: 'Positive provider prose that must not cross the DTO boundary.',
          truncated: false,
          model: 'stub',
        };
      },
    };
    const sentiment = await classifySentiment({
      answer: 'Byte-stable source answer.',
      domain: 'example.com',
      summaryProvider: provider,
    });
    expect(requestedLocale).toBe('en');
    expect(sentiment).toBe('positive');
    expect(['positive', 'neutral', 'negative']).toContain(sentiment);
  });

  it('maps a summary with neither keyword to neutral', async () => {
    await expect(
      classifySentiment({
        answer: 'anything',
        domain: 'example.com',
        summaryProvider: summaryStub('A balanced, factual mention.'),
      }),
    ).resolves.toBe('neutral');
  });

  it('falls back to the heuristic when the summary provider throws', async () => {
    const throwing: SummaryProvider = {
      generatePrompts: stubGeneratePrompts,
      async summarize() {
        throw new Error('boom');
      },
    };
    await expect(
      classifySentiment({
        answer: 'example.com is poor',
        domain: 'example.com',
        summaryProvider: throwing,
      }),
    ).resolves.toBe('negative');
  });
});

describe('computeShareOfVoicePct', () => {
  it('returns null when nothing was mentioned', () => {
    expect(
      computeShareOfVoicePct({ brandMentionedCount: 0, competitorMentionedCount: 0 }),
    ).toBeNull();
  });

  it('rounds the brand share of total mentions', () => {
    expect(
      computeShareOfVoicePct({ brandMentionedCount: 3, competitorMentionedCount: 1 }),
    ).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// loadOwnedSite
// ---------------------------------------------------------------------------

describe('loadOwnedSite', () => {
  it('404s a malformed object id', async () => {
    const err = await catchError(loadOwnedSite({ siteId: 'not-an-id', accountId: newAccountId() }));
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
    expect((err as Error).message).toBe('aiVisibility.errors.siteNotFound');
  });

  it('404s a well-formed id that does not belong to the account', async () => {
    const err = await catchError(
      loadOwnedSite({ siteId: new mongoose.Types.ObjectId().toString(), accountId: newAccountId() }),
    );
    expect((err as HttpError).status).toBe(404);
  });

  it('returns the id + domain for an owned site', async () => {
    const account = newAccountId();
    const siteId = await seedSite(account, 'owned.example');
    await expect(loadOwnedSite({ siteId, accountId: account })).resolves.toEqual({
      id: siteId,
      domain: 'owned.example',
      marketLanguage: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Repository: addTrackedPrompt / removeTrackedPrompt / upserts / readers
// ---------------------------------------------------------------------------

describe('addTrackedPrompt', () => {
  it('inserts a new prompt', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = 'site-a';
    const row = await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    expect(row.prompt).toBe('best tool');
    expect(row.id).toBeDefined();
  });

  it.each(['  BEST Tool  ', 'best tool?', 'Best, tool!', 'best\u00a0  tool', 'ＢＥＳＴ tool'])(
    'refuses %j as a duplicate of "best tool" and stores one row',
    async (variant) => {
      const db = testDb();
      const account = newAccountId();
      const siteId = 'site-a';
      await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
      await expect(
        addTrackedPrompt(db, { accountId: account, siteId, prompt: variant }),
      ).rejects.toBeInstanceOf(PromptAlreadyTrackedError);
      expect(await listTrackedPrompts(db, { accountId: account, siteId })).toHaveLength(1);
    },
  );

  it('keys prompts by normalised text', () => {
    expect(trackedPromptKey('  Best: podcast — tools?? ')).toBe('best podcast tools');
  });

  it('throws PromptCapReachedError past the per-site cap', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = 'site-a';
    for (let i = 0; i < MAX_TRACKED_AI_PROMPTS; i += 1) {
      await addTrackedPrompt(db, { accountId: account, siteId, prompt: `prompt ${i}` });
    }
    await expect(
      addTrackedPrompt(db, { accountId: account, siteId, prompt: 'one too many' }),
    ).rejects.toBeInstanceOf(PromptCapReachedError);
  });

  it('reports a conflict (never another row) when the unique index swallows the insert', async () => {
    const db = testDb();
    const owner = newAccountId();
    const other = newAccountId();
    const siteId = 'shared-site';
    // Another account already holds (siteId, 'foo') — the unique index is on
    // (siteId, prompt), not account, so the owner's insert conflicts.
    await db.insert(aiTrackedPrompts).values({ accountId: other, siteId, prompt: 'foo' });
    await addTrackedPrompt(db, { accountId: owner, siteId, prompt: 'bar' });
    await expect(
      addTrackedPrompt(db, { accountId: owner, siteId, prompt: 'foo' }),
    ).rejects.toBeInstanceOf(PromptAlreadyTrackedError);
  });
});

describe('removeTrackedPrompt', () => {
  it('returns true when a row is deleted and false when nothing matches', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = 'site-a';
    const row = await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    await expect(
      removeTrackedPrompt(db, { accountId: account, siteId, promptId: row.id }),
    ).resolves.toBe(true);
    await expect(
      removeTrackedPrompt(db, { accountId: account, siteId, promptId: row.id }),
    ).resolves.toBe(false);
  });
});

describe('upsert helpers', () => {
  it('upsertMentionSnapshot writes one row', async () => {
    const db = testDb();
    const account = newAccountId();
    await upsertMentionSnapshot(db, {
      accountId: account,
      siteId: 'site-a',
      prompt: 'p',
      model: 'chatgpt',
      mentioned: true,
      checkedAt: FAKE_CLOCK,
    });
    const rows = await db
      .select()
      .from(aiMentionSnapshots)
      .where(eq(aiMentionSnapshots.siteId, 'site-a'));
    expect(rows).toHaveLength(1);
  });

  it('upsertCompetitorMentions is a no-op on an empty batch and inserts otherwise', async () => {
    const db = testDb();
    const account = newAccountId();
    await upsertCompetitorMentions(db, []);
    let rows = await db
      .select()
      .from(aiCompetitorMentions)
      .where(eq(aiCompetitorMentions.siteId, 'site-a'));
    expect(rows).toHaveLength(0);
    await upsertCompetitorMentions(db, [
      {
        accountId: account,
        siteId: 'site-a',
        prompt: 'p',
        model: 'chatgpt',
        competitorDomain: 'rival.example',
        mentioned: true,
        cited: false,
        checkedAt: FAKE_CLOCK,
      },
    ]);
    rows = await db
      .select()
      .from(aiCompetitorMentions)
      .where(eq(aiCompetitorMentions.siteId, 'site-a'));
    expect(rows).toHaveLength(1);
  });
});

describe('recent-mention readers', () => {
  it('read without an accountId returns every row for the site; with one it filters', async () => {
    const db = testDb();
    const a = newAccountId();
    const b = newAccountId();
    const siteId = 'site-a';
    const since = new Date('2020-01-01T00:00:00.000Z');
    await db.insert(aiMentionSnapshots).values([
      { accountId: a, siteId, prompt: 'p', model: 'chatgpt', mentioned: true, checkedAt: FAKE_CLOCK },
      { accountId: b, siteId, prompt: 'q', model: 'claude', mentioned: false, checkedAt: FAKE_CLOCK },
    ]);
    await db.insert(aiCompetitorMentions).values([
      {
        accountId: a,
        siteId,
        prompt: 'p',
        model: 'chatgpt',
        competitorDomain: 'rival.example',
        mentioned: true,
        cited: false,
        checkedAt: FAKE_CLOCK,
      },
      {
        accountId: b,
        siteId,
        prompt: 'q',
        model: 'claude',
        competitorDomain: 'rival.example',
        mentioned: false,
        cited: false,
        checkedAt: FAKE_CLOCK,
      },
    ]);
    expect(await readRecentMentions(db, { siteId, since })).toHaveLength(2);
    expect(await readRecentMentions(db, { accountId: a, siteId, since })).toHaveLength(1);
    expect(await readRecentCompetitorMentions(db, { siteId, since })).toHaveLength(2);
    expect(await readRecentCompetitorMentions(db, { accountId: a, siteId, since })).toHaveLength(1);
  });
});

describe('listKeywordPhrases / listStoredCompetitorDomains', () => {
  it('honours an explicit limit and skips inactive keywords', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = 'site-a';
    await db.insert(keywords).values([
      { accountId: account, siteId, phrase: 'k1', locationCode: 2840, languageCode: 'en' },
      { accountId: account, siteId, phrase: 'k2', locationCode: 2840, languageCode: 'en' },
      { accountId: account, siteId, phrase: 'k3', locationCode: 2840, languageCode: 'en' },
      {
        accountId: account,
        siteId,
        phrase: 'inactive',
        locationCode: 2840,
        languageCode: 'en',
        active: false,
      },
    ]);
    const limited = await listKeywordPhrases(db, { accountId: account, siteId, limit: 2 });
    expect(limited).toHaveLength(2);
    const all = await listKeywordPhrases(db, { accountId: account, siteId });
    expect(all).toHaveLength(3);
    expect(all).not.toContain('inactive');
  });

  it('dedupes competitor domains case-insensitively and honours a limit', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = 'site-a';
    await db.insert(competitors).values([
      {
        accountId: account,
        siteId,
        competitorDomain: 'Rival.Example',
        fetchedAt: new Date('2026-01-02T00:00:00.000Z'),
        snapshotDay: '2026-01-02',
      },
      {
        accountId: account,
        siteId,
        competitorDomain: 'rival.example',
        fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
        snapshotDay: '2026-01-01',
      },
    ]);
    const withLimit = await listStoredCompetitorDomains(db, { accountId: account, siteId, limit: 5 });
    expect(withLimit).toEqual(['rival.example']);
    const withDefault = await listStoredCompetitorDomains(db, { accountId: account, siteId });
    expect(withDefault).toEqual(['rival.example']);
  });
});

describe('readAiOverviewRollup', () => {
  it('returns zeroes when no active keywords exist for the site', async () => {
    const db = testDb();
    await expect(
      readAiOverviewRollup(db, {
        accountId: newAccountId(),
        siteId: 'site-a',
        since: new Date('2020-01-01'),
      }),
    ).resolves.toEqual({ citedCount: 0, totalChecked: 0 });
  });

  it('coalesces a null sum to zero when keywords exist but no rankings match', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = 'site-a';
    await db
      .insert(keywords)
      .values({ accountId: account, siteId, phrase: 'k1', locationCode: 2840, languageCode: 'en' });
    await expect(
      readAiOverviewRollup(db, { accountId: account, siteId, since: new Date('2020-01-01') }),
    ).resolves.toEqual({ citedCount: 0, totalChecked: 0 });
  });

  it('counts AI-overview rankings that were cited, scoped to the account', async () => {
    const db = testDb();
    const account = newAccountId();
    const stranger = newAccountId();
    const siteId = 'site-a';
    const [kw] = await db
      .insert(keywords)
      .values({ accountId: account, siteId, phrase: 'k1', locationCode: 2840, languageCode: 'en' })
      .returning();
    // Same siteId under another account — must never leak into the rollup.
    const [strangerKw] = await db
      .insert(keywords)
      .values({ accountId: stranger, siteId, phrase: 'k2', locationCode: 2840, languageCode: 'en' })
      .returning();
    for (const keywordId of [kw!.id, strangerKw!.id]) {
      await db.insert(rankings).values({
        keywordId,
        position: 1,
        aiOverviewPresent: true,
        aiCited: true,
        checkedAt: new Date('2026-01-05T00:00:00.000Z'),
        source: 'fresh',
      });
    }
    await expect(
      readAiOverviewRollup(db, { accountId: account, siteId, since: new Date('2020-01-01') }),
    ).resolves.toEqual({ citedCount: 1, totalChecked: 1 });
  });
});

// ---------------------------------------------------------------------------
// getAiVisibilityOverview (now-injected) + checkMentions branches
// ---------------------------------------------------------------------------

describe('getAiVisibilityOverview', () => {
  it('honours an injected clock so recent snapshots fall inside the window', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await db.insert(aiMentionSnapshots).values({
      accountId: account,
      siteId,
      prompt: 'best seo audit tool',
      model: 'chatgpt',
      mentioned: true,
      sentiment: 'positive',
      checkedAt: FAKE_CLOCK,
    });
    const overview = await getAiVisibilityOverview({ accountId: account, siteId }, { db, now: NOW });
    expect(overview.snapshots).toHaveLength(1);
    expect(overview.sentiment).toEqual({ positive: 1, neutral: 0, negative: 0 });
    expect(overview.shareOfVoicePct).toBe(100);
  });
});

describe('checkMentions', () => {
  it('classifies via the summary provider, records competitors, and reflects an empty answer as null sentiment', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    await db.insert(competitors).values({
      accountId: account,
      siteId,
      competitorDomain: 'rival.example',
      fetchedAt: new Date('2026-01-02T00:00:00.000Z'),
      snapshotDay: '2026-01-02',
    });
    const mentions: AiMentionRow[] = [
      { prompt: 'p1', model: 'chatgpt', mentioned: true, citedUrl: 'https://example.com/x', checkedAt: FAKE_CLOCK },
      { prompt: 'p2', model: 'claude', mentioned: false, checkedAt: FAKE_CLOCK },
    ];
    const answers: AiAnswerRow[] = [
      {
        prompt: 'p1',
        model: 'chatgpt',
        answer: 'example.com is excellent and trusted. rival.example is fine',
        citations: ['https://example.com/x'],
        checkedAt: FAKE_CLOCK,
      },
      { prompt: 'p2', model: 'claude', answer: '', citations: [], checkedAt: FAKE_CLOCK },
    ];
    const provider = createFakeAiVisibilityProvider({ mentions, answers });
    const overview = await checkMentions(
      { accountId: account, siteId },
      { db, provider, summaryProvider: summaryStub('positive'), now: NOW },
    );
    const mentionRows = await db
      .select()
      .from(aiMentionSnapshots)
      .where(eq(aiMentionSnapshots.siteId, siteId));
    expect(mentionRows).toHaveLength(2);
    const p1 = mentionRows.find((r) => r.prompt === 'p1');
    const p2 = mentionRows.find((r) => r.prompt === 'p2');
    expect(p1?.sentiment).toBe('positive');
    expect(p2?.sentiment).toBeNull();
    const competitorRows = await db
      .select()
      .from(aiCompetitorMentions)
      .where(eq(aiCompetitorMentions.siteId, siteId));
    expect(competitorRows).toHaveLength(2);
    expect(competitorRows.find((r) => r.prompt === 'p1')?.mentioned).toBe(true);
    expect(competitorRows.find((r) => r.prompt === 'p2')?.mentioned).toBe(false);
    expect(overview.sentiment).toEqual({ positive: 1, neutral: 0, negative: 0 });
    expect(overview.shareOfVoicePct).toBe(50);
  });

  it('bounds provider-backed sentiment at 4 calls per prompt — overflow rows fall back to the heuristic', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    // Six mention/answer pairs on ONE tracked prompt — past the 4-per-prompt
    // generation budget the `ai_mentions_checks` unit cost pays for.
    const models = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    const mentions: AiMentionRow[] = models.map((model) => ({
      prompt: 'p1',
      model,
      mentioned: true,
      checkedAt: FAKE_CLOCK,
    }));
    const answers: AiAnswerRow[] = models.map((model) => ({
      prompt: 'p1',
      model,
      // Neutral for the heuristic (brand present, no sentiment word) so the
      // provider-classified rows are distinguishable from the overflow rows.
      answer: 'A factual mention of example.com among other tools.',
      citations: [],
      checkedAt: FAKE_CLOCK,
    }));
    const provider = createFakeAiVisibilityProvider({ mentions, answers });
    const stub = summaryStub('Strongly positive coverage.');
    const summarizeSpy = vi.spyOn(stub, 'summarize');
    await checkMentions(
      { accountId: account, siteId },
      { db, provider, summaryProvider: stub, now: NOW },
    );
    // Exactly the budget — never one generation call per unbounded row.
    expect(summarizeSpy).toHaveBeenCalledTimes(4);
    const rows = await db
      .select()
      .from(aiMentionSnapshots)
      .where(eq(aiMentionSnapshots.siteId, siteId));
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.sentiment === 'positive')).toHaveLength(4);
    expect(rows.filter((r) => r.sentiment === 'neutral')).toHaveLength(2);
  });

  it('refuses a paused site with a 409 before touching the provider', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    await Site.updateOne({ _id: siteId }, { $set: { paused: true, pausedAt: new Date() } });
    const provider = createFakeAiVisibilityProvider({ mentions: [], answers: [] });
    const spy = vi.spyOn(provider, 'checkMentions');
    const err = await catchError(
      checkMentions({ accountId: account, siteId }, { db, provider, now: NOW }),
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as Error).message).toBe('sites.errors.paused');
    expect(spy).not.toHaveBeenCalled();
  });

  it('persists nothing when the provider returns no mentions', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    const provider = createFakeAiVisibilityProvider({ mentions: [], answers: [] });
    const overview = await checkMentions({ accountId: account, siteId }, { db, provider, now: NOW });
    const mentionRows = await db
      .select()
      .from(aiMentionSnapshots)
      .where(eq(aiMentionSnapshots.siteId, siteId));
    expect(mentionRows).toHaveLength(0);
    expect(overview.snapshots).toHaveLength(0);
  });

  it('maps mention model surfaces (chat_gpt → chatgpt, drops unsupported, dedupes) for the answers call', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    let requestedModels: string[] = [];
    const provider: AiVisibilityProvider = {
      async checkMentions() {
        return [
          { prompt: 'q', model: 'chat_gpt', mentioned: true, checkedAt: FAKE_CLOCK },
          { prompt: 'q', model: 'chatgpt', mentioned: true, checkedAt: FAKE_CLOCK },
          { prompt: 'q', model: 'bing', mentioned: false, checkedAt: FAKE_CLOCK },
        ];
      },
      async getAnswers(input) {
        requestedModels = input.models;
        return [];
      },
      async getAiKeywordVolume() {
        return [];
      },
    };
    await checkMentions({ accountId: account, siteId }, { db, provider, now: NOW });
    expect(requestedModels).toEqual(['chatgpt']);
  });

  it('wraps a provider failure as a 503 HttpError', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    const provider = createFakeAiVisibilityProvider({
      failure: new VendorUnavailableError('down', { provider: 'x', operation: 'y' }),
    });
    const err = await catchError(
      checkMentions({ accountId: account, siteId }, { db, provider, now: NOW }),
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
    expect((err as Error).message).toBe('aiVisibility.errors.unavailable');
  });

  it('rethrows a non-provider failure untouched', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    const provider: AiVisibilityProvider = {
      async checkMentions() {
        throw new Error('plain boom');
      },
      async getAnswers() {
        return [];
      },
      async getAiKeywordVolume() {
        return [];
      },
    };
    const err = await catchError(
      checkMentions({ accountId: account, siteId }, { db, provider, now: NOW }),
    );
    expect(err).not.toBeInstanceOf(HttpError);
    expect((err as Error).message).toBe('plain boom');
  });
});

// ---------------------------------------------------------------------------
// prompt suggestions: free stored read + metered generation
// ---------------------------------------------------------------------------

describe('readStoredSuggestions', () => {
  it('returns generatedAt: null before any generation', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await expect(
      readStoredSuggestions({ accountId: account, siteId, outputLocale: OUTPUT_LOCALE }, { db }),
    ).resolves.toEqual({
      generatedAt: null,
      outputLocale: OUTPUT_LOCALE,
      suggestions: [],
      evidence: null,
      stale: false,
    });
  });

  it('404s a site owned by another account', async () => {
    const db = testDb();
    const siteId = await seedSite(newAccountId(), 'example.com');
    const err = await catchError(
      readStoredSuggestions(
        { accountId: newAccountId(), siteId, outputLocale: OUTPUT_LOCALE },
        { db },
      ),
    );
    expect((err as HttpError).status).toBe(404);
  });

  it('returns the newest run when several exist', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    const seeds = { keywords: ['a'], titles: [], competitors: [], gscQueries: [], provenance: 'site' as const };
    const row = (prompt: string) => ({
      prompt,
      source: 'ai' as const,
      funnelStage: 'awareness' as const,
      promptType: 'problemFirst' as const,
      intent: 'informational' as const,
      branded: false,
      evidenceSource: 'keyword' as const,
      evidenceRef: 'a',
    });
    await insertSuggestionRun(db, {
      id: randomUUID(),
      accountId: account,
      siteId,
      outputLocale: OUTPUT_LOCALE,
      prompts: [row('older')],
      seeds,
      generator: 'ai',
      model: 'm',
      generatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await insertSuggestionRun(db, {
      id: randomUUID(),
      accountId: account,
      siteId,
      outputLocale: OUTPUT_LOCALE,
      prompts: [row('newer')],
      seeds,
      generator: 'ai',
      model: 'm',
      generatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await insertSuggestionRun(db, {
      id: randomUUID(),
      accountId: account,
      siteId,
      outputLocale: 'fr',
      prompts: [row('nouveau')],
      seeds,
      generator: 'ai',
      model: 'm',
      generatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    const result = await readStoredSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      { db },
    );
    expect(result.generatedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(result.suggestions.map((s) => s.prompt)).toEqual(['newer']);
    // A run stored before the site profile existed reports "unknown", not a level.
    expect(result.evidence).toBeNull();
    await expect(
      readStoredSuggestions({ accountId: account, siteId, outputLocale: 'fr' }, { db }),
    ).resolves.toMatchObject({
      generatedAt: '2026-03-01T00:00:00.000Z',
      outputLocale: 'fr',
      suggestions: [expect.objectContaining({ prompt: 'nouveau' })],
    });
    await expect(
      readStoredSuggestions({ accountId: account, siteId, outputLocale: 'de' }, { db }),
    ).resolves.toEqual({ generatedAt: null, outputLocale: 'de', suggestions: [], evidence: null, stale: false });
  });

  it('hides stored template rows seeded in another language, for free', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    const base = {
      funnelStage: 'consideration' as const,
      promptType: 'categoryDiscovery' as const,
      intent: 'commercial' as const,
      branded: false,
    };
    await insertSuggestionRun(db, {
      id: randomUUID(),
      accountId: account,
      siteId,
      outputLocale: OUTPUT_LOCALE,
      prompts: [
        { ...base, prompt: 'What is the best finalisez un épisode sans abonnement?', source: 'template', evidenceSource: 'title', evidenceRef: 'finalisez un épisode sans abonnement' },
        { ...base, prompt: 'What is the best episode pass?', source: 'template', evidenceSource: 'title', evidenceRef: 'episode pass' },
        { ...base, prompt: 'What is a good alternative to rival.example?', source: 'template', evidenceSource: 'competitor', evidenceRef: 'rival.example' },
        { ...base, prompt: 'An AI row stays as generated', source: 'ai', evidenceSource: 'keyword', evidenceRef: 'hilfe und antworten' },
        { ...base, prompt: 'A template row without a seed', source: 'template', evidenceSource: 'keyword', evidenceRef: null },
      ],
      // The AI row cites one of the run's own seeds, as the AI contract requires.
      seeds: { keywords: ['hilfe und antworten'], titles: [], competitors: [], gscQueries: [], provenance: 'site' },
      generator: 'template',
      model: null,
      generatedAt: new Date('2026-09-29T07:26:00.000Z'),
    });
    const result = await readStoredSuggestions({ accountId: account, siteId, outputLocale: OUTPUT_LOCALE }, { db });
    expect(result.suggestions.map((row) => row.prompt)).toEqual([
      'What is the best episode pass?',
      'What is a good alternative to rival.example?',
      'An AI row stays as generated',
      'A template row without a seed',
    ]);
  });
});

describe('readStoredSuggestions evidence level', () => {
  it.each(['rich', 'limited', 'none'] as const)('returns the stored %s evidence level', async (level) => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await insertSuggestionRun(db, {
      id: randomUUID(),
      accountId: account,
      siteId,
      outputLocale: OUTPUT_LOCALE,
      prompts: [],
      seeds: { keywords: [], titles: [], competitors: [], gscQueries: [], evidenceLevel: level },
      generator: 'template',
      model: null,
      generatedAt: new Date('2026-09-29T07:26:00.000Z'),
    });
    const result = await readStoredSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      { db },
    );
    expect(result.evidence).toBe(level);
  });
});

describe('listGscQuerySeeds', () => {
  async function seedGscQuery(
    db: Db,
    input: { accountId: string; siteId: string; query: string; clicks: number },
  ): Promise<void> {
    await db.insert(gscSearchAnalytics).values({
      accountId: input.accountId,
      siteId: input.siteId,
      bindingGenerationId: 'legacy',
      snapshotDate: '2026-02-01',
      dimensionSet: 'query',
      windowDays: 28,
      dimensionKey: input.query,
      clicks: input.clicks,
      impressions: input.clicks * 10,
      ctr: 0.1,
      position: 4.2,
    });
  }

  it('orders by clicks desc, dedupes case-insensitively, and honours the limit', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await seedGscQuery(db, { accountId: account, siteId, query: 'low traffic query', clicks: 1 });
    await seedGscQuery(db, { accountId: account, siteId, query: 'top query', clicks: 90 });
    await seedGscQuery(db, { accountId: account, siteId, query: 'TOP QUERY', clicks: 50 });
    await expect(
      listGscQuerySeeds(db, { accountId: account, siteId, limit: 5 }),
    ).resolves.toEqual(['top query', 'low traffic query']);
  });

  it('uses legacy GSC rows for an older bound site without a generation id', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'legacy.example');
    await Site.updateOne(
      { _id: siteId },
      { $unset: { gscBindingGenerationId: 1 } },
    );
    await seedGscQuery(db, {
      accountId: account,
      siteId,
      query: 'legacy query',
      clicks: 5,
    });
    await expect(listGscQuerySeeds(db, { accountId: account, siteId }))
      .resolves.toEqual(['legacy query']);
  });


  it('stops at the limit once enough distinct queries are collected', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    for (let i = 0; i < 6; i += 1) {
      await seedGscQuery(db, {
        accountId: account,
        siteId,
        query: `query number ${i}`,
        clicks: 100 - i,
      });
    }
    await expect(
      listGscQuerySeeds(db, { accountId: account, siteId, limit: 2 }),
    ).resolves.toEqual(['query number 0', 'query number 1']);
  });

  it('excludes rows for the same site under a different account', async () => {
    const db = testDb();
    const owner = newAccountId();
    const siteId = await seedSite(owner, 'example.com');
    await seedGscQuery(db, { accountId: owner, siteId, query: 'mine', clicks: 5 });
    // Same siteId, foreign accountId — the module reader filters on BOTH.
    await seedGscQuery(db, { accountId: newAccountId(), siteId, query: 'theirs', clicks: 99 });
    await expect(listGscQuerySeeds(db, { accountId: owner, siteId })).resolves.toEqual(['mine']);
  });

  it('ignores the query,page rollup and over-long queries', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await db.insert(gscSearchAnalytics).values({
      accountId: account,
      siteId,
      bindingGenerationId: 'legacy',
      snapshotDate: '2026-02-01',
      dimensionSet: 'query,page',
      windowDays: 28,
      dimensionKey: 'paired row',
      clicks: 99,
      impressions: 990,
      ctr: 0.1,
      position: 4.2,
    });
    await seedGscQuery(db, { accountId: account, siteId, query: 'x'.repeat(201), clicks: 80 });
    await seedGscQuery(db, { accountId: account, siteId, query: 'kept', clicks: 1 });
    await expect(listGscQuerySeeds(db, { accountId: account, siteId })).resolves.toEqual(['kept']);
  });
});

describe('generatePromptSuggestions', () => {
  const summaryRow = (promptText: string, evidenceRef = 'seo audit') => ({
    promptText,
    funnelStage: 'consideration' as const,
    promptType: 'problemFirst' as const,
    intent: 'commercial' as const,
    branded: false,
    evidenceSource: 'keyword' as const,
    evidenceRef,
  });

  const stubSummary = (
    generatePrompts: SummaryProvider['generatePrompts'],
    preflight?: () => void,
  ): SummaryProvider => ({
    ...createFakeSummaryProvider(),
    ...(preflight ? { preflightGeneratePrompts: preflight } : {}),
    generatePrompts,
  });

  it('bounds tracked keyword seeds to the AI profile contract', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await db.insert(keywords).values({
      accountId: account,
      siteId,
      phrase: 'x'.repeat(300),
      locationCode: 2840,
      languageCode: 'en',
    });

    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: 'en' },
      {
        db,
        provider: createFakeAiVisibilityProvider(),
        summaryProvider: createFakeProfileSummaryProvider(),
      },
    );

    expect(result.suggestions[0]).toMatchObject({
      source: 'ai',
      evidenceRef: 'x'.repeat(KEYWORD_MAX_LENGTH),
    });
  });

  it('passes all seven output locales to the provider and builds category prompts in each language', async () => {
    const db = testDb();
    const seen: Array<{ locale: string; keywords: string[] }> = [];
    // One two-word topic per output language, in its own script: seeds in
    // another language are never cast into a template.
    const topicFor: Record<string, string> = {
      en: 'podcast show notes',
      fr: 'notes de podcast',
      de: 'podcast zusammenfassung',
      es: 'resumen de podcast',
      ru: 'заметки подкаста',
      ar: 'ملاحظات البودكاست',
      zh: '播客节目笔记',
    };
    for (const outputLocale of SUPPORTED_LOCALES) {
      const accountId = newAccountId();
      const siteId = await seedSite(accountId, `${outputLocale}.example`);
      await db.insert(keywords).values({
        accountId,
        siteId,
        phrase: topicFor[outputLocale]!,
        locationCode: 2840,
        languageCode: 'en',
      });
      const result = await generatePromptSuggestions(
        { accountId, siteId, outputLocale },
        {
          db,
          provider: createFakeAiVisibilityProvider(),
          summaryProvider: stubSummary(async (input) => {
            seen.push({ locale: input.locale, keywords: input.seeds.keywords });
            return { prompts: [], model: 'locale-test' };
          }),
        },
      );
      expect(result.outputLocale).toBe(outputLocale);
      const categoryRows = result.suggestions.filter((row) => row.evidenceRef === topicFor[outputLocale]);
      expect(categoryRows.length).toBe(2);
      expect(categoryRows.every((row) => row.prompt.includes(topicFor[outputLocale]!))).toBe(true);
      expect(categoryRows.every((row) => row.evidenceSource === 'keyword')).toBe(true);
    }
    expect(seen).toEqual(
      SUPPORTED_LOCALES.map((locale) => ({ locale, keywords: [topicFor[locale]!] })),
    );
  });

  it('feeds GSC queries to the generator and persists the taxonomy it returns', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await db.insert(keywords).values({
      accountId: account,
      siteId,
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'en',
    });
    await db.insert(gscSearchAnalytics).values({
      accountId: account,
      siteId,
      bindingGenerationId: 'legacy',
      snapshotDate: '2026-02-01',
      dimensionSet: 'query',
      windowDays: 28,
      dimensionKey: 'how do i audit my site',
      clicks: 12,
      impressions: 120,
      ctr: 0.1,
      position: 4.2,
    });

    // Held in a box: TypeScript's control-flow analysis cannot see the
    // assignment made inside the stub callback and would otherwise narrow a
    // bare `let seen = null` to `never` at the assertions below.
    const seenRef: { current: GeneratePromptsInput | null } = { current: null };
    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      {
        db,
        provider: createFakeAiVisibilityProvider(),
        summaryProvider: stubSummary(async (input) => {
          seenRef.current = input;
          return {
            prompts: [summaryRow('what should I fix first on my site')],
            model: 'test-model',
          };
        }),
      },
    );

    expect(seenRef.current?.seeds.gscQueries).toEqual(['how do i audit my site']);
    expect(seenRef.current?.seeds.keywords).toContain('seo audit');
    expect(result.generatedAt).toEqual(expect.any(String));
    const ai = result.suggestions.find((row) => row.source === 'ai');
    expect(ai).toMatchObject({
      prompt: 'what should I fix first on my site',
      promptType: 'problemFirst',
      evidenceSource: 'keyword',
      evidenceRef: 'seo audit',
    });

    // Persisted and readable for free.
    const stored = await readStoredSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      { db },
    );
    expect(stored).toEqual(result);
  });

  it('falls back to taxonomy-tagged templates when the generator returns nothing', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await db.insert(keywords).values({
      accountId: account,
      siteId,
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'en',
    });
    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      {
        db,
        provider: createFakeAiVisibilityProvider(),
        summaryProvider: stubSummary(async () => ({ prompts: [], model: 'test-model' })),
      },
    );
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.every((row) => row.source === 'template')).toBe(true);
    // Template rows carry static taxonomy + the seed they derive from, so the
    // panel can group them exactly like AI rows.
    expect(result.suggestions[0]).toMatchObject({
      prompt: 'What are the best tools for seo audit?',
      promptType: 'categoryDiscovery',
      funnelStage: 'consideration',
      intent: 'commercial',
      branded: false,
      evidenceSource: 'keyword',
      evidenceRef: 'seo audit',
    });
    // One category is thin evidence: said so, and persisted for the free read.
    expect(result.evidence).toBe('limited');
  });

  it('never seeds one site from another site of the same account (leak regression)', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await db.insert(keywords).values({
      accountId: account,
      siteId,
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'en',
    });
    // The same account researched keywords for a DIFFERENT site. These rows
    // once leaked in as suggestion seeds ("best paystub generator" on an SEO
    // site) because keyword_research_history has no site column.
    await db.insert(keywordResearchHistory).values({
      accountId: account,
      kind: 'ideas',
      phrases: ['paystub generator', '1099 pay stub example', 'quickbooks pay stub template'],
      locationCode: 2840,
      languageCode: 'en',
      resultCount: 3,
      cached: false,
    });
    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      { db, provider: createFakeAiVisibilityProvider(), summaryProvider: null },
    );
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.some((row) => row.prompt.includes('pay stub'))).toBe(false);
    expect(result.suggestions.some((row) => row.prompt.includes('paystub'))).toBe(false);
    expect(
      result.suggestions.every((row) => row.evidenceRef === null || row.evidenceRef === 'seo audit'),
    ).toBe(true);
  });

  it('caps the retained set at SUGGESTION_TARGET', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    // Every AI row cites this tracked keyword, so the evidence guard keeps it.
    await db.insert(keywords).values({ accountId: account, siteId, phrase: 'seo audit', locationCode: 2840, languageCode: 'en' });
    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      {
        db,
        provider: createFakeAiVisibilityProvider(),
        summaryProvider: stubSummary(async () => ({
          prompts: Array.from({ length: 20 }, (_, i) => summaryRow(`question ${i}`)),
          model: 'test-model',
        })),
      },
    );
    expect(result.suggestions).toHaveLength(SUGGESTION_TARGET);
  });

  it('dedupes an AI prompt that collides with a template prompt', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await db.insert(keywords).values({
      accountId: account,
      siteId,
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'en',
    });
    const templates = buildPromptCandidates({
      domain: 'example.com',
      outputLocale: OUTPUT_LOCALE,
      keywords: ['seo audit'],
      gscQueries: [],
      titleSeeds: [],
      competitorDomains: [],
    });
    const collide = templates[0]!.prompt;
    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      {
        db,
        provider: createFakeAiVisibilityProvider(),
        summaryProvider: stubSummary(async () => ({
          prompts: [summaryRow(collide.toUpperCase())],
          model: 'test-model',
        })),
      },
    );
    const matches = result.suggestions.filter(
      (row) => row.prompt.toLowerCase() === collide.toLowerCase(),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source).toBe('ai');
  });

  it('drops a blank prompt the model returned and backfills from templates', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    // Enough keywords that the templates overshoot SUGGESTION_TARGET, so the
    // merged set is trimmed back to it.
    for (const phrase of ['seo audit', 'site speed', 'backlink check', 'page speed', 'domain authority']) {
      await db.insert(keywords).values({
        accountId: account,
        siteId,
        phrase,
        locationCode: 2840,
        languageCode: 'en',
      });
    }
    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      {
        db,
        provider: createFakeAiVisibilityProvider(),
        summaryProvider: stubSummary(async () => ({
          // Whitespace-only text trims to '' and must be dropped, not stored.
          prompts: [summaryRow('   '), summaryRow('a real question')],
          model: 'test-model',
        })),
      },
    );
    expect(result.suggestions).toHaveLength(SUGGESTION_TARGET);
    expect(result.suggestions.map((row) => row.prompt)).toContain('a real question');
    expect(result.suggestions.every((row) => row.prompt.trim().length > 0)).toBe(true);
    // One AI row survived; the rest came from templates.
    expect(result.suggestions.filter((row) => row.source === 'ai')).toHaveLength(1);
  });

  it('409s a paused site before calling the provider', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await Site.updateOne({ _id: siteId }, { $set: { paused: true } });
    let called = false;
    const err = await catchError(
      generatePromptSuggestions(
        { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
        {
          db,
          provider: createFakeAiVisibilityProvider(),
          summaryProvider: stubSummary(async () => {
            called = true;
            return { prompts: [], model: 'm' };
          }),
        },
      ),
    );
    expect((err as HttpError).status).toBe(409);
    expect(called).toBe(false);
  });

  it('404s a site owned by another account', async () => {
    const db = testDb();
    const siteId = await seedSite(newAccountId(), 'example.com');
    const err = await catchError(
      generatePromptSuggestions(
        { accountId: newAccountId(), siteId, outputLocale: OUTPUT_LOCALE },
        { db, provider: createFakeAiVisibilityProvider() },
      ),
    );
    expect((err as HttpError).status).toBe(404);
  });

  it('runs the non-spending preflight before the AI call', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    const order: string[] = [];
    await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      {
        db,
        provider: createFakeAiVisibilityProvider(),
        summaryProvider: stubSummary(
          async () => {
            order.push('generate');
            return { prompts: [summaryRow('a question', 'example')], model: 'm' };
          },
          () => order.push('preflight'),
        ),
      },
    );
    expect(order).toEqual(['preflight', 'generate']);
  });

  it('502s when the provider throws and nothing evidence-backed can be retained', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    const err = await catchError(
      generatePromptSuggestions(
        { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
        {
          db,
          provider: createFakeAiVisibilityProvider(),
          summaryProvider: stubSummary(async () => {
            throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
          }),
        },
      ),
    );
    expect((err as HttpError).status).toBe(502);
    // Nothing persisted — the previous good set (if any) is untouched.
    await expect(
      readStoredSuggestions({ accountId: account, siteId, outputLocale: OUTPUT_LOCALE }, { db }),
    ).resolves.toEqual({
      generatedAt: null,
      outputLocale: OUTPUT_LOCALE,
      suggestions: [],
      evidence: null,
      stale: false,
    });
  });

  it('keeps templates, consumes, and logs when the provider throws but seeds exist', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await db.insert(keywords).values({
      accountId: account,
      siteId,
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'en',
    });
    const warnSpy = vi.spyOn(logger, 'warn');
    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      {
        db,
        provider: createFakeAiVisibilityProvider(),
        summaryProvider: stubSummary(async () => {
          throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
        }),
      },
    );
    expect(result.suggestions.every((row) => row.source === 'template')).toBe(true);
    // The failure must never be silent — an all-template response is only
    // diagnosable through this log line.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: account, siteId }),
      expect.stringContaining('prompt suggestion provider failed'),
    );
    warnSpy.mockRestore();
  });

  it('works with no summary provider configured at all', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await db.insert(keywords).values({
      accountId: account,
      siteId,
      phrase: 'seo audit',
      locationCode: 2840,
      languageCode: 'en',
    });
    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      { db, provider: createFakeAiVisibilityProvider(), summaryProvider: null },
    );
    expect(result.suggestions.every((row) => row.source === 'template')).toBe(true);
  });

  it('arms the cooldown so a second immediate generation is rejected', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    const cooldown = createInMemoryCooldown({ defaultMs: 60_000 });
    const deps = {
      db,
      provider: createFakeAiVisibilityProvider(),
      summaryProvider: stubSummary(async () => ({
        prompts: [summaryRow('a question', 'example')],
        model: 'm',
      })),
      cooldown,
    };
    await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      deps,
    );
    const err = await catchError(
      generatePromptSuggestions(
        { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
        deps,
      ),
    );
    expect(err).toBeInstanceOf(CooldownError);
  });

  it('stamps generatedAt from the injected clock', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    const frozen = new Date('2026-03-04T05:06:07.000Z');
    const result = await generatePromptSuggestions(
      { accountId: account, siteId, outputLocale: OUTPUT_LOCALE },
      {
        db,
        provider: createFakeAiVisibilityProvider(),
        summaryProvider: stubSummary(async () => ({
          prompts: [summaryRow('a question', 'example')],
          model: 'm',
        })),
        now: () => frozen,
      },
    );
    expect(result.generatedAt).toBe(frozen.toISOString());
  });

  describe('evidence-grounded suggestions', () => {
    async function seedPodcastAudit(account: string, siteId: string): Promise<void> {
      const run = await AuditRun.create({
        accountId: new mongoose.Types.ObjectId(account),
        siteId: new mongoose.Types.ObjectId(siteId),
        pageCap: 5,
        status: 'succeeded',
        finishedAt: new Date('2026-01-10T00:00:00.000Z'),
      });
      const pages: Array<[string, string, string, string[]]> = [
        [
          'https://episodebrief.com/',
          'EpisodeBrief — Turn podcast episodes into show notes',
          'Generate podcast show notes, transcripts and episode titles from any podcast episode.',
          ['Podcast show notes in minutes'],
        ],
        ['https://episodebrief.com/pricing', 'Episode pricing | EpisodeBrief', 'Pay per episode.', ['Episode pricing']],
        [
          'https://episodebrief.com/transcripts',
          'Podcast transcripts that are ready to publish',
          'Accurate podcast transcripts with speaker labels.',
          [],
        ],
      ];
      for (const [index, [url, title, metaDescription, h1]] of pages.entries()) {
        await AuditedPage.create({
          runId: run._id,
          url,
          statusCode: 200,
          title,
          metaDescription,
          h1,
          onPageScore: 100 - index,
        });
      }
    }

    async function seedPodcastSite(db: Db): Promise<{ account: string; siteId: string }> {
      const account = newAccountId();
      const siteId = await seedSite(account, 'episodebrief.com');
      await seedPodcastAudit(account, siteId);
      await db.insert(keywords).values({
        accountId: account,
        siteId,
        phrase: 'episode pricing',
        locationCode: 2840,
        languageCode: 'en',
      });
      await db.insert(competitors).values({
        accountId: account,
        siteId,
        competitorDomain: 'castmagic.io',
        fetchedAt: new Date('2026-01-02T00:00:00.000Z'),
        snapshotDay: '2026-01-02',
      });
      return { account, siteId };
    }

    it('feeds the home-page description to the generator and never suggests a tracked prompt', async () => {
      const db = testDb();
      const { account, siteId } = await seedPodcastSite(db);
      const description =
        'Generate podcast show notes, transcripts and episode titles from any podcast episode.';
      await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'How do I write podcast show notes fast?' });
      const seen: GeneratePromptsInput[] = [];
      const row = (promptText: string) => ({
        promptText,
        funnelStage: 'consideration' as const,
        promptType: 'problemFirst' as const,
        intent: 'commercial' as const,
        branded: false,
        evidenceSource: 'title' as const,
        evidenceRef: description,
      });
      const summaryProvider: SummaryProvider = {
        ...createFakeSummaryProvider(),
        async generatePrompts(input) {
          seen.push(input);
          return {
            prompts: [
              row('how do I write podcast show notes fast'),
              row('What can turn one podcast episode into show notes and a transcript?'),
            ],
            model: 'fake-model',
          };
        },
      };
      const result = await generatePromptSuggestions(
        { accountId: account, siteId, outputLocale: 'en' },
        { db, provider: createFakeAiVisibilityProvider(), summaryProvider },
      );
      expect(seen[0]?.seeds.titles[0]).toBe(description);
      const prompts = result.suggestions.map((suggestion) => suggestion.prompt.toLowerCase());
      expect(prompts).not.toContain('how do i write podcast show notes fast');
      expect(prompts).toContain('what can turn one podcast episode into show notes and a transcript?');

      // A prompt tracked after the run is hidden on the free stored read too.
      await addTrackedPrompt(db, {
        accountId: account,
        siteId,
        prompt: 'What can turn one podcast episode into show notes and a transcript',
      });
      const stored = await readStoredSuggestions({ accountId: account, siteId, outputLocale: 'en' }, { db });
      expect(stored.suggestions.map((suggestion) => suggestion.prompt.toLowerCase())).not.toContain(
        'what can turn one podcast episode into show notes and a transcript?',
      );
    });

    it('builds category and grounded comparison prompts from crawled copy, never from the page-label query', async () => {
      const db = testDb();
      const { account, siteId } = await seedPodcastSite(db);
      const result = await generatePromptSuggestions(
        { accountId: account, siteId, outputLocale: 'en' },
        { db, provider: createFakeAiVisibilityProvider(), summaryProvider: null },
      );
      const prompts = result.suggestions.map((row) => row.prompt);
      expect(prompts).toEqual([
        'What are the best tools for podcast show notes?',
        'episodebrief.com vs castmagic.io',
        // The crawled title "Turn podcast episodes into show notes" is a task.
        'How do I turn podcast episodes into show notes?',
        'What should I look for when choosing a tool for podcast show notes?',
        'What is a good alternative to castmagic.io?',
        'Which is better for podcast show notes: episodebrief.com or castmagic.io?',
        'What should I look for when choosing a tool for podcast transcripts?',
        'Is a paid tool worth it for podcast transcripts?',
      ]);
      expect(prompts.some((prompt) => prompt.toLowerCase().includes('pricing'))).toBe(false);
      expect(result.evidence).toBe('rich');
      // Stored with its evidence level, so the free read reports the same.
      await expect(
        readStoredSuggestions({ accountId: account, siteId, outputLocale: 'en' }, { db }),
      ).resolves.toEqual(result);
    });

    it('withholds page-label and brand queries from the AI generator and adds the derived categories as title seeds', async () => {
      const db = testDb();
      const { account, siteId } = await seedPodcastSite(db);
      await db.insert(keywords).values({
        accountId: account,
        siteId,
        phrase: 'podcast show notes',
        locationCode: 2840,
        languageCode: 'en',
      });
      await db.insert(gscSearchAnalytics).values(
        ['episodebrief login', 'how do i write podcast show notes'].map((query, index) => ({
          accountId: account,
          siteId,
          bindingGenerationId: 'legacy',
          snapshotDate: '2026-02-01',
          dimensionSet: 'query' as const,
          windowDays: 28,
          dimensionKey: query,
          clicks: 10 - index,
          impressions: 100,
          ctr: 0.1,
          position: 4.2,
        })),
      );
      const seenRef: { current: GeneratePromptsInput | null } = { current: null };
      await generatePromptSuggestions(
        { accountId: account, siteId, outputLocale: 'en' },
        {
          db,
          provider: createFakeAiVisibilityProvider(),
          summaryProvider: stubSummary(async (input) => {
            seenRef.current = input;
            return { prompts: [], model: 'seed-probe' };
          }),
        },
      );
      const seeds = seenRef.current!.seeds;
      expect(seeds.keywords).toEqual(['podcast show notes']);
      expect(seeds.gscQueries).toEqual(['how do i write podcast show notes']);
      expect(seeds.titles).toEqual(
        expect.arrayContaining(['podcast show notes', 'podcast transcripts']),
      );
      expect(seeds.competitors).toEqual(['castmagic.io']);
    });

    it('collapses a near-identical AI phrasing and lets templates backfill the gap', async () => {
      const db = testDb();
      const { account, siteId } = await seedPodcastSite(db);
      const result = await generatePromptSuggestions(
        { accountId: account, siteId, outputLocale: 'en' },
        {
          db,
          provider: createFakeAiVisibilityProvider(),
          summaryProvider: stubSummary(async () => ({
            prompts: [
              summaryRow('What is the best episode pricing?', 'podcast show notes'),
              summaryRow('Which episode pricing should I use?', 'podcast show notes'),
              summaryRow('What are the best tools for podcast show notes?', 'podcast show notes'),
            ],
            model: 'dup-probe',
          })),
        },
      );
      const prompts = result.suggestions.map((row) => row.prompt);
      expect(prompts.filter((prompt) => prompt.includes('episode pricing'))).toEqual([
        'What is the best episode pricing?',
      ]);
      // The AI wording of the template question wins; the template twin is gone.
      expect(prompts.filter((prompt) => prompt === 'What are the best tools for podcast show notes?')).toHaveLength(1);
      expect(result.suggestions.filter((row) => row.source === 'ai')).toHaveLength(2);
      expect(result.suggestions.some((row) => row.source === 'template')).toBe(true);
      expect(result.suggestions.length).toBeLessThanOrEqual(SUGGESTION_TARGET);
    });

    it('degrades to the evidence-grounded templates, keeps the unit and logs when the provider fails', async () => {
      const db = testDb();
      const { account, siteId } = await seedPodcastSite(db);
      const warnSpy = vi.spyOn(logger, 'warn');
      const result = await generatePromptSuggestions(
        { accountId: account, siteId, outputLocale: 'en' },
        {
          db,
          provider: createFakeAiVisibilityProvider(),
          summaryProvider: stubSummary(async () => {
            throw new VendorUnavailableError('down', { provider: 'x', operation: 'y' });
          }),
        },
      );
      expect(result.suggestions[0]!.prompt).toBe('What are the best tools for podcast show notes?');
      expect(result.suggestions.every((row) => row.source === 'template')).toBe(true);
      expect(result.evidence).toBe('rich');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: account, siteId }),
        expect.stringContaining('prompt suggestion provider failed'),
      );
      warnSpy.mockRestore();
    });

    it('reports no evidence and returns only brand questions when a healthy model has nothing to say', async () => {
      const db = testDb();
      const account = newAccountId();
      const siteId = await seedSite(account, 'example.com');
      const result = await generatePromptSuggestions(
        { accountId: account, siteId, outputLocale: 'en' },
        {
          db,
          provider: createFakeAiVisibilityProvider(),
          summaryProvider: stubSummary(async () => ({ prompts: [], model: 'empty' })),
        },
      );
      expect(result.evidence).toBe('none');
      expect(result.suggestions.map((row) => [row.prompt, row.evidenceSource, row.source])).toEqual([
        ['What does example.com do?', null, 'template'],
        ['Is example.com a good choice?', null, 'template'],
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// listAuditTitleSeeds
// ---------------------------------------------------------------------------

describe('listAuditTitleSeeds', () => {
  it('returns [] when the site has no succeeded audit run', async () => {
    const account = newAccountId();
    const siteId = await seedSite(account);
    await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(account),
      siteId: new mongoose.Types.ObjectId(siteId),
      pageCap: 5,
      status: 'failed',
    });
    await expect(listAuditTitleSeeds({ accountId: account, siteId })).resolves.toEqual([]);
  });

  it('reads the newest succeeded run and cleans titles + h1s', async () => {
    const account = newAccountId();
    const siteId = await seedSite(account);
    const accountOid = new mongoose.Types.ObjectId(account);
    const siteOid = new mongoose.Types.ObjectId(siteId);
    const oldRun = await AuditRun.create({
      accountId: accountOid,
      siteId: siteOid,
      pageCap: 5,
      status: 'succeeded',
      finishedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await AuditedPage.create({
      runId: oldRun._id,
      url: 'https://example.com/old',
      statusCode: 200,
      title: 'Stale Old Page Title',
      h1: [],
      onPageScore: 10,
    });
    const newRun = await AuditRun.create({
      accountId: accountOid,
      siteId: siteOid,
      pageCap: 5,
      status: 'succeeded',
      finishedAt: new Date('2026-01-10T00:00:00.000Z'),
    });
    await AuditedPage.create({
      runId: newRun._id,
      url: 'https://example.com/',
      statusCode: 200,
      title: 'Website Uptime Monitoring | Example Brand',
      h1: ['Free Website Monitoring', 'Home'],
      onPageScore: 95,
    });
    await AuditedPage.create({
      runId: newRun._id,
      url: 'https://example.com/pricing',
      statusCode: 200,
      title: 'WEBSITE UPTIME MONITORING — duplicate after cleaning',
      h1: [`${'h'.repeat(90)}`],
      onPageScore: 60,
    });
    await AuditedPage.create({
      runId: newRun._id,
      url: 'https://example.com/untitled',
      statusCode: 200,
      title: null,
      h1: ['status page templates'],
      onPageScore: 40,
    });
    const seeds = await listAuditTitleSeeds({ accountId: account, siteId });
    expect(seeds).toEqual([
      'website uptime monitoring',
      'free website monitoring',
      'status page templates',
    ]);
  });

  it('keeps topic phrases and rejects fragments, page labels and the brand', async () => {
    const account = newAccountId();
    const siteId = await seedSite(account, 'episodebrief.com');
    const run = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(account),
      siteId: new mongoose.Types.ObjectId(siteId),
      pageCap: 5,
      status: 'succeeded',
      finishedAt: new Date('2026-01-10T00:00:00.000Z'),
    });
    const titles: Array<[string, string[]]> = [
      ['EpisodeBrief — Turn podcast episodes into show notes', ['From episode to publish-ready, one pass at a time']],
      ['Help and answers | EpisodeBrief', ['Answers, grouped by where you are']],
      ['How EpisodeBrief works', ['Sample output']],
      ['Episode pricing', ['Podcast show notes templates']],
    ];
    for (const [index, [title, h1]] of titles.entries()) {
      await AuditedPage.create({
        runId: run._id,
        url: `https://episodebrief.com/p${index}`,
        statusCode: 200,
        title,
        h1,
        onPageScore: 100 - index,
      });
    }
    await expect(
      listAuditTitleSeeds({ accountId: account, siteId, domain: 'www.episodebrief.com' }),
    ).resolves.toEqual(['turn podcast episodes into show notes', 'podcast show notes templates']);
  });

  it('skips pages under another language path when an output locale is given', async () => {
    const account = newAccountId();
    const siteId = await seedSite(account, 'episodebrief.com');
    const run = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(account),
      siteId: new mongoose.Types.ObjectId(siteId),
      pageCap: 5,
      status: 'succeeded',
      finishedAt: new Date('2026-01-10T00:00:00.000Z'),
    });
    const pages: Array<[string, string]> = [
      ['https://episodebrief.com/fr/tarifs', 'Traitement ponctuel podcast'],
      ['https://episodebrief.com/de-at/preise', 'Einmalige Podcast-Verarbeitung'],
      ['https://episodebrief.com/en/features', 'Podcast show notes templates'],
      ['https://episodebrief.com/guides', 'Episode summary guide'],
    ];
    for (const [index, [url, title]] of pages.entries()) {
      await AuditedPage.create({
        runId: run._id,
        url,
        statusCode: 200,
        title,
        h1: [],
        onPageScore: 100 - index,
      });
    }
    await expect(
      listAuditTitleSeeds({ accountId: account, siteId, outputLocale: 'en' }),
    ).resolves.toEqual(['podcast show notes templates', 'episode summary guide']);
    await expect(
      listAuditTitleSeeds({ accountId: account, siteId, outputLocale: 'fr' }),
    ).resolves.toEqual(['traitement ponctuel podcast', 'episode summary guide']);
  });

  it('honors the seed limit', async () => {
    const account = newAccountId();
    const siteId = await seedSite(account);
    const run = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(account),
      siteId: new mongoose.Types.ObjectId(siteId),
      pageCap: 5,
      status: 'succeeded',
      finishedAt: new Date('2026-01-10T00:00:00.000Z'),
    });
    await AuditedPage.create({
      runId: run._id,
      url: 'https://example.com/',
      statusCode: 200,
      title: 'first long page title',
      h1: ['second long heading', 'third long heading'],
      onPageScore: 95,
    });
    await expect(
      listAuditTitleSeeds({ accountId: account, siteId, seedLimit: 2 }),
    ).resolves.toEqual(['first long page title', 'second long heading']);
  });
});

describe('listAuditPageEvidence', () => {
  it('returns [] when the site has no succeeded audit run', async () => {
    const account = newAccountId();
    const siteId = await seedSite(account);
    await expect(listAuditPageEvidence({ accountId: account, siteId })).resolves.toEqual([]);
  });

  it('reads the newest run, prefers the final URL and skips unusable pages', async () => {
    const account = newAccountId();
    const siteId = await seedSite(account);
    const accountOid = new mongoose.Types.ObjectId(account);
    const siteOid = new mongoose.Types.ObjectId(siteId);
    const oldRun = await AuditRun.create({
      accountId: accountOid,
      siteId: siteOid,
      pageCap: 5,
      status: 'succeeded',
      finishedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await AuditedPage.create({
      runId: oldRun._id,
      url: 'https://example.com/stale',
      statusCode: 200,
      title: 'Stale page',
      onPageScore: 99,
    });
    const run = await AuditRun.create({
      accountId: accountOid,
      siteId: siteOid,
      pageCap: 5,
      status: 'succeeded',
      finishedAt: new Date('2026-01-10T00:00:00.000Z'),
    });
    const base = { runId: run._id, onPageScore: 50 };
    await AuditedPage.create({
      ...base,
      url: 'http://example.com/',
      finalUrl: 'https://example.com/en/',
      statusCode: 200,
      title: 'Corrected title',
      metaDescription: 'Corrected description',
      h1: ['Heading'],
      onPageScore: 90,
    });
    await AuditedPage.create({ ...base, url: 'https://example.com/bare', statusCode: 200 });
    await AuditedPage.create({ ...base, url: 'https://example.com/gone', statusCode: 404, title: 'Gone' });
    await AuditedPage.create({ ...base, url: 'https://example.com/moved', statusCode: 301, title: 'Moved' });
    await AuditedPage.create({
      ...base,
      url: 'https://example.com/hidden',
      statusCode: 200,
      title: 'Hidden',
      isIndexable: false,
    });
    await AuditedPage.create({
      ...base,
      url: 'https://example.com/blocked',
      statusCode: 200,
      title: 'Blocked',
      fetchFailure: { kind: 'robots_blocked' },
    });
    const pages = await listAuditPageEvidence({ accountId: account, siteId });
    expect(pages).toEqual([
      {
        url: 'https://example.com/en/',
        title: 'Corrected title',
        metaDescription: 'Corrected description',
        h1: ['Heading'],
      },
      { url: 'https://example.com/bare', title: null, metaDescription: null, h1: [] },
    ]);
    await expect(
      listAuditPageEvidence({ accountId: account, siteId, pageLimit: 1 }),
    ).resolves.toHaveLength(1);
    // Another account never reads this site's audit.
    await expect(
      listAuditPageEvidence({ accountId: newAccountId(), siteId }),
    ).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAiVisibilityTrend
// ---------------------------------------------------------------------------

describe('getAiVisibilityTrend', () => {
  async function seedSnapshot(
    db: Db,
    account: string,
    siteId: string,
    day: string,
    mentioned: boolean,
  ) {
    await db.insert(aiMentionSnapshots).values({
      accountId: account,
      siteId,
      prompt: 'p',
      model: 'chatgpt',
      mentioned,
      checkedAt: new Date(`${day}T12:00:00.000Z`),
    });
  }

  async function seedCompetitorRow(
    db: Db,
    account: string,
    siteId: string,
    day: string,
    mentioned: boolean,
  ) {
    await db.insert(aiCompetitorMentions).values({
      accountId: account,
      siteId,
      prompt: 'p',
      model: 'chatgpt',
      competitorDomain: 'rival.example',
      mentioned,
      cited: false,
      checkedAt: new Date(`${day}T12:00:00.000Z`),
    });
  }

  it('buckets brand and competitor rows per day, unioning competitor-only days', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await seedSnapshot(db, account, siteId, '2026-01-10', true);
    await seedSnapshot(db, account, siteId, '2026-01-10', false);
    await seedSnapshot(db, account, siteId, '2026-01-12', true);
    await seedSnapshot(db, account, siteId, '2026-01-12', true);
    await seedSnapshot(db, account, siteId, '2026-01-12', true);
    await seedSnapshot(db, account, siteId, '2026-01-12', false);
    await seedCompetitorRow(db, account, siteId, '2026-01-12', true);
    await seedCompetitorRow(db, account, siteId, '2026-01-12', true);
    await seedCompetitorRow(db, account, siteId, '2026-01-13', true);
    const result = await getAiVisibilityTrend({ accountId: account, siteId }, { db, now: NOW });
    expect(result.points).toEqual([
      { day: '2026-01-10', mentionedRatePct: 50, shareOfVoicePct: 100, checks: 2 },
      { day: '2026-01-12', mentionedRatePct: 75, shareOfVoicePct: 60, checks: 4 },
      { day: '2026-01-13', mentionedRatePct: null, shareOfVoicePct: 0, checks: 0 },
    ]);
  });

  it('applies the days window', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await seedSnapshot(db, account, siteId, '2026-01-01', true);
    await seedSnapshot(db, account, siteId, '2026-01-14', true);
    const result = await getAiVisibilityTrend(
      { accountId: account, siteId, days: 7 },
      { db, now: NOW },
    );
    expect(result.points).toEqual([
      { day: '2026-01-14', mentionedRatePct: 100, shareOfVoicePct: 100, checks: 1 },
    ]);
  });

  it('404s a site the account does not own', async () => {
    const db = testDb();
    const account = newAccountId();
    const stranger = newAccountId();
    const siteId = await seedSite(account);
    const err = await catchError(
      getAiVisibilityTrend({ accountId: stranger, siteId }, { db, now: NOW }),
    );
    expect((err as HttpError).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// vendor archive rows (cost capture)
// ---------------------------------------------------------------------------

describe('vendor archive rows (cost capture)', () => {
  async function archiveRows(db: Db) {
    return db
      .select()
      .from(vendorResponses)
      .where(eq(vendorResponses.capability, 'ai-visibility'));
  }

  it('checkMentions archives one row with the prompt count; nothing recorded → null cost', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account, 'example.com');
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'top tool' });
    const provider = createFakeAiVisibilityProvider({ mentions: [], answers: [] });
    await checkMentions({ accountId: account, siteId }, { db, provider, now: NOW });
    const rows = await archiveRows(db);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.operation).toBe('check-mentions');
    expect(row.accountId).toBe(account);
    expect(row.params).toMatchObject({ domain: 'example.com', promptCount: 2 });
    expect(row.costMicros).toBeNull();
    expect(row.fetchedAt).toEqual(NOW());
  });

  it('checkMentions persists the summed vendor cost recorded across the fan-out', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    const provider: AiVisibilityProvider = {
      async checkMentions() {
        recordVendorCostUsd(0.1);
        return [];
      },
      async getAnswers() {
        recordVendorCostUsd(0.05);
        return [];
      },
      async getAiKeywordVolume() {
        return [];
      },
    };
    await checkMentions({ accountId: account, siteId }, { db, provider, now: NOW });
    const rows = await archiveRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costMicros).toBe(150_000n);
  });

  it('a failed checkMentions archives nothing', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    const provider = createFakeAiVisibilityProvider({
      failure: new VendorUnavailableError('down', { provider: 'x', operation: 'y' }),
    });
    await catchError(checkMentions({ accountId: account, siteId }, { db, provider, now: NOW }));
    expect(await archiveRows(db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addPromptForSite / removePromptForSite
// ---------------------------------------------------------------------------

describe('addPromptForSite', () => {
  it('adds a prompt for an owned site', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    const prompt = await addPromptForSite({ accountId: account, siteId, prompt: 'best tool' }, { db });
    expect(prompt.prompt).toBe('best tool');
  });

  it('maps the prompt cap to a 409 HttpError with the limit detail', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    for (let i = 0; i < MAX_TRACKED_AI_PROMPTS; i += 1) {
      await db.insert(aiTrackedPrompts).values({ accountId: account, siteId, prompt: `prompt ${i}` });
    }
    const err = await catchError(
      addPromptForSite({ accountId: account, siteId, prompt: 'one too many' }, { db }),
    );
    expect((err as HttpError).status).toBe(409);
    expect((err as Error).message).toBe('aiVisibility.errors.promptCapReached');
    expect((err as HttpError).details).toEqual({ limit: MAX_TRACKED_AI_PROMPTS });
  });

  it('maps a duplicate to a localized 409 and rethrows any other repository error', async () => {
    const db = testDb();
    const owner = newAccountId();
    const siteId = await seedSite(owner);
    await addPromptForSite({ accountId: owner, siteId, prompt: 'Best podcast tools?' }, { db });
    const conflict = await catchError(
      addPromptForSite({ accountId: owner, siteId, prompt: 'best podcast tools' }, { db }),
    );
    expect((conflict as HttpError).status).toBe(409);
    expect((conflict as Error).message).toBe('aiVisibility.errors.promptAlreadyTracked');

    const broken = {
      ...db,
      select: () => {
        throw new Error('database unavailable');
      },
    } as unknown as typeof db;
    const err = await catchError(
      addPromptForSite({ accountId: owner, siteId, prompt: 'anything' }, { db: broken }),
    );
    expect(err).not.toBeInstanceOf(HttpError);
    expect((err as Error).message).toBe('database unavailable');
  });
});

describe('removePromptForSite', () => {
  it('removes an owned prompt', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    const row = await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'best tool' });
    await expect(
      removePromptForSite({ accountId: account, siteId, promptId: row.id }, { db }),
    ).resolves.toBeUndefined();
    const remaining = await db
      .select()
      .from(aiTrackedPrompts)
      .where(eq(aiTrackedPrompts.siteId, siteId));
    expect(remaining).toHaveLength(0);
  });

  it('404s when the prompt does not exist', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = await seedSite(account);
    const err = await catchError(
      removePromptForSite(
        { accountId: account, siteId, promptId: '00000000-0000-4000-8000-000000000000' },
        { db },
      ),
    );
    expect((err as HttpError).status).toBe(404);
    expect((err as Error).message).toBe('aiVisibility.errors.promptNotFound');
  });
});

// ---------------------------------------------------------------------------
// buildAiVisibilityEvaluationInput + clearAiVisibilityRowsForTests
// ---------------------------------------------------------------------------

describe('buildAiVisibilityEvaluationInput', () => {
  it('returns "no-prompts-tracked" when nothing is tracked', async () => {
    const db = testDb();
    const account = newAccountId();
    const result = await buildAiVisibilityEvaluationInput(db, {
      siteId: 'site-a',
      accountId: account,
    });
    expect(result).toEqual({
      status: 'no-prompts-tracked',
      aiOverviewCitedCount: 0,
      aiOverviewTotalChecked: 0,
      llmMentionedCount: 0,
      llmTotalChecked: 0,
      shareOfVoicePct: null,
      negativeSentimentCount: 0,
      competitorsPresent: false,
    });
  });

  it('rolls up mentions, competitors, sentiment, and AI overview with an injected clock', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = 'site-a';
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'tracked one' });
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'tracked two' });
    await db.insert(aiMentionSnapshots).values([
      { accountId: account, siteId, prompt: 'tracked one', model: 'chatgpt', mentioned: true, sentiment: 'positive', checkedAt: FAKE_CLOCK },
      // 'tracked two' was checked and not mentioned; 'tracked three' was never
      // checked, so it is not reported as not mentioned.
      { accountId: account, siteId, prompt: 'tracked two', model: 'claude', mentioned: false, sentiment: 'negative', checkedAt: FAKE_CLOCK },
      { accountId: account, siteId, prompt: 'tracked one', model: 'perplexity', mentioned: true, sentiment: 'neutral', checkedAt: FAKE_CLOCK },
    ]);
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'tracked three' });
    await db.insert(aiCompetitorMentions).values([
      { accountId: account, siteId, prompt: 'tracked one', model: 'chatgpt', competitorDomain: 'rival.example', mentioned: true, cited: false, checkedAt: FAKE_CLOCK },
      { accountId: account, siteId, prompt: 'tracked one', model: 'claude', competitorDomain: 'rival.example', mentioned: false, cited: false, checkedAt: FAKE_CLOCK },
    ]);
    const [kw] = await db
      .insert(keywords)
      .values({ accountId: account, siteId, phrase: 'k1', locationCode: 2840, languageCode: 'en' })
      .returning();
    await db.insert(rankings).values({
      keywordId: kw!.id,
      position: 1,
      aiOverviewPresent: true,
      aiCited: true,
      checkedAt: new Date('2026-01-05T00:00:00.000Z'),
      source: 'fresh',
    });
    const result = await buildAiVisibilityEvaluationInput(db, {
      siteId,
      accountId: account,
      now: new Date('2026-01-15T00:00:00.000Z'),
    });
    expect(result).toEqual({
      status: 'ok',
      aiOverviewCitedCount: 1,
      aiOverviewTotalChecked: 1,
      llmMentionedCount: 2,
      llmTotalChecked: 3,
      shareOfVoicePct: 67,
      negativeSentimentCount: 1,
      competitorsPresent: true,
      sentiment: { positive: 1, neutral: 1, negative: 1 },
      notMentionedPrompts: ['tracked two'],
    });
  });

  it('uses the wall clock when no now is supplied', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = 'site-a';
    await addTrackedPrompt(db, { accountId: account, siteId, prompt: 'tracked one' });
    await db.insert(aiMentionSnapshots).values({
      accountId: account,
      siteId,
      prompt: 'tracked one',
      model: 'chatgpt',
      mentioned: true,
      sentiment: 'positive',
      checkedAt: new Date(),
    });
    const result = await buildAiVisibilityEvaluationInput(db, { siteId, accountId: account });
    expect(result.status).toBe('ok');
    expect(result.llmTotalChecked).toBe(1);
    expect(result.llmMentionedCount).toBe(1);
  });
});

describe('clearAiVisibilityRowsForTests', () => {
  it('deletes both mention and competitor rows for a site', async () => {
    const db = testDb();
    const account = newAccountId();
    const siteId = 'site-a';
    await db.insert(aiMentionSnapshots).values({
      accountId: account,
      siteId,
      prompt: 'p',
      model: 'chatgpt',
      mentioned: true,
      checkedAt: FAKE_CLOCK,
    });
    await db.insert(aiCompetitorMentions).values({
      accountId: account,
      siteId,
      prompt: 'p',
      model: 'chatgpt',
      competitorDomain: 'rival.example',
      mentioned: true,
      cited: false,
      checkedAt: FAKE_CLOCK,
    });
    await clearAiVisibilityRowsForTests(db, siteId);
    expect(
      await db.select().from(aiMentionSnapshots).where(eq(aiMentionSnapshots.siteId, siteId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(aiCompetitorMentions).where(eq(aiCompetitorMentions.siteId, siteId)),
    ).toHaveLength(0);
  });
});

describe('siteDescriptionSeed ', () => {
  const page = (url: string, metaDescription: string | null) => ({ url, title: null, metaDescription, h1: [] });
  it('takes the home or language-home meta description, trimmed and bounded', () => {
    expect(siteDescriptionSeed([page('https://a.example/pricing', 'Prices'), page('https://a.example/', '  Home copy  ')])).toBe('Home copy');
    expect(siteDescriptionSeed([page('https://a.example/ar/', 'وصف')])).toBe('وصف');
    expect(siteDescriptionSeed([page('https://a.example/', 'x'.repeat(600))])).toHaveLength(500);
  });

  it('returns null without a usable home description', () => {
    expect(siteDescriptionSeed([page('https://a.example/', '   '), page('https://a.example/blog', 'Blog')])).toBeNull();
    expect(siteDescriptionSeed([page('not a url', 'Broken')])).toBeNull();
    expect(siteDescriptionSeed([])).toBeNull();
  });
});
