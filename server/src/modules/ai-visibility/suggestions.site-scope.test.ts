/**
 * AI Visibility suggestions for one site came from another site's data ("best paystub generator" on a Saudi rewards site, plus the raw
 * homepage title "best welcome - example rewards").
 *
 * Current-tree root cause: generation already reads only account+site scoped
 * evidence, but the newest stored run is served on every read, so a run built
 * before site scoping kept showing leaked phrases. These tests pin the fix:
 * provenance-checked stored reads, the output guard, market languages, and
 * cross-site input isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import type { Db } from '../../db/client.js';
import { keywords } from '../../db/schema/keywords.js';
import { keywordResearchHistory } from '../../db/schema/keyword-research-history.js';
import {
  createFakeAiVisibilityProvider,
  createFakeSummaryProvider,
  type SummaryProvider,
} from '../../shared/providers/index.js';
import { Site } from '../sites/index.js';
import { AuditRun } from '../audits/audit-run.model.js';
import { AuditedPage } from '../audits/audited-page.model.js';
import { insertSuggestionRun } from './ai-visibility.repository.js';
import { generatePromptSuggestions, readStoredSuggestions } from './ai-visibility.service.js';
import { comparisonKey, guardSuggestionRows, normalizePromptText } from './prompt-output-guard.js';
import { keywordLanguage, resolveSuggestionLanguages } from './suggestion-languages.js';

const ENGLISH = ['rewards app', 'rewards offers', 'rewards coupons', 'best rewards', 'rewards card'];
const ARABIC = ['مكافآت', 'تطبيق مكافآت', 'عروض مكافآت', 'كوبونات مكافآت', 'نقاط مكافآت'];

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

const db = (): Db => getTestDb() as unknown as Db;

async function addSite(accountId: string, domain: string, languageCode?: string): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
    ...(languageCode
      ? { defaultMarket: { locationCode: 2682, languageCode, device: 'desktop', source: 'inferred' } }
      : {}),
  });
  return String(site._id);
}

async function addAudit(accountId: string, siteId: string, title: string, url: string) {
  const run = await AuditRun.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    siteId: new mongoose.Types.ObjectId(siteId),
    pageCap: 5,
    status: 'succeeded',
    finishedAt: new Date('2026-08-11T23:00:00.000Z'),
  });
  await AuditedPage.create({ runId: run._id, url, statusCode: 200, title, h1: [], onPageScore: 90 });
}

async function track(accountId: string, siteId: string, phrases: readonly string[]) {
  await db().insert(keywords).values(
    phrases.map((phrase) => ({ accountId, siteId, phrase, locationCode: 2840, languageCode: 'en' })),
  );
}

/** Two sites on one account: the Saudi site A and another site B with its own history. */
async function seedTwoSites() {
  const accountId = new mongoose.Types.ObjectId().toString();
  const siteA = await addSite(accountId, 'rewards.example', 'ar');
  const siteB = await addSite(accountId, 'paystub.example');
  await track(accountId, siteA, [...ENGLISH, ...ARABIC]);
  await track(accountId, siteB, ['best paystub generator']);
  await db().insert(keywordResearchHistory).values([
    { accountId, siteId: siteB, kind: 'related', phrases: ['which pystub generator should i use'], locationCode: 2840, languageCode: 'en', resultCount: 1, cached: false },
    { accountId, siteId: null, kind: 'related', phrases: ['how to choose 1099 pay stub example'], locationCode: 2840, languageCode: 'en', resultCount: 1, cached: false },
  ] as never);
  await addAudit(accountId, siteA, 'Welcome - Example Rewards', 'https://rewards.example/');
  await addAudit(accountId, siteB, 'Paystub Generator | Paystub', 'https://paystub.example/');
  return { accountId, siteA, siteB };
}

const OTHER_SITE = /paystub|pystub|pay stub|1099/i;

describe('suggestion languages', () => {
  it('reads a keyword language from its script, preferring the site language for Latin text', () => {
    expect(keywordLanguage('مكافآت', 'en')).toBe('ar');
    expect(keywordLanguage('бонусы', 'en')).toBe('ru');
    expect(keywordLanguage('奖励应用', 'en')).toBe('zh');
    expect(keywordLanguage('rewards app', 'ar')).toBe('en');
    expect(keywordLanguage('rewards app', 'de')).toBe('de');
    expect(keywordLanguage('meilleur bonus sans abonnement', 'ar')).toBe('fr');
    expect(keywordLanguage('12345', 'ar')).toBeNull();
  });

  it('uses the site market language plus one keyword-evidenced language (the .sa case)', () => {
    expect(
      resolveSuggestionLanguages({ marketLanguage: 'ar', uiLocale: 'en', keywords: [...ENGLISH, ...ARABIC] }),
    ).toEqual({ primary: 'ar', secondary: 'en' });
  });

  it('ignores a one-off keyword and falls back to the interface language without a usable market', () => {
    expect(resolveSuggestionLanguages({ marketLanguage: 'ar', uiLocale: 'en', keywords: ['rewards app', ...ARABIC] })).toEqual({
      primary: 'ar',
      secondary: null,
    });
    expect(resolveSuggestionLanguages({ marketLanguage: 'pt', uiLocale: 'de', keywords: [] })).toEqual({
      primary: 'de',
      secondary: null,
    });
    expect(resolveSuggestionLanguages({ marketLanguage: null, uiLocale: 'fr', keywords: ['مكافآت', 'تطبيق'] })).toEqual({
      primary: 'fr',
      secondary: 'ar',
    });
  });

  it('picks the secondary language with the most keywords, then the first alphabetically on a tie', () => {
    const russian = ['бонусы', 'награды', 'скидки'];
    expect(
      resolveSuggestionLanguages({ marketLanguage: 'en', uiLocale: 'en', keywords: [...ARABIC.slice(0, 2), ...russian] }),
    ).toEqual({ primary: 'en', secondary: 'ru' });
    expect(
      resolveSuggestionLanguages({ marketLanguage: 'en', uiLocale: 'en', keywords: [...russian.slice(0, 2), ...ARABIC.slice(0, 2)] }),
    ).toEqual({ primary: 'en', secondary: 'ar' });
  });
});

describe('output guard', () => {
  const context = {
    pageTitles: ['Welcome - Example Rewards', 'Rewards offers'],
    seeds: ['rewards app'],
    domain: 'rewards.example',
    locale: 'en' as const,
  };
  const row = (prompt: string, extra: Partial<{ source: 'ai' | 'template'; evidenceRef: string | null }> = {}) => ({
    prompt,
    source: 'template' as const,
    evidenceRef: null,
    ...extra,
  });

  it('never emits a raw page title or a brand-separated title fragment', () => {
    const kept = guardSuggestionRows(
      [
        row('best welcome - example rewards'),
        row('Welcome — Example Rewards'),
        row('Rewards offers'),
        row('best welcome example rewards deals'),
        row('Paystub | Generator tips'),
        row('What are the best rewards apps?'),
      ],
      context,
    );
    expect(kept.map((r) => r.prompt)).toEqual(['What are the best rewards apps?']);
  });

  it('collapses whitespace and repeated punctuation', () => {
    expect(normalizePromptText('  Which   rewards app is best??  ')).toBe('Which rewards app is best?');
    expect(normalizePromptText('- best rewards cards,, today!!')).toBe('best rewards cards, today!');
    expect(comparisonKey('« Rewards » App?')).toBe('rewards app');
  });

  it('keeps AI rows only when they cite one of the site seeds (or its domain)', () => {
    const kept = guardSuggestionRows(
      [
        row('Is a rewards app worth it?', { source: 'ai', evidenceRef: 'rewards app' }),
        row('What does rewards.example do?', { source: 'ai', evidenceRef: 'rewards.example' }),
        row('which pystub generator should I use', { source: 'ai', evidenceRef: 'which pystub generator should i use' }),
        row('Too', { source: 'ai', evidenceRef: 'rewards app' }),
      ],
      context,
    );
    expect(kept.map((r) => r.prompt)).toEqual(['Is a rewards app worth it?', 'What does rewards.example do?']);
  });

  it('drops near-duplicates, first one wins', () => {
    const kept = guardSuggestionRows(
      [row('What are the best rewards apps?'), row('What are the best rewards apps')],
      context,
    );
    expect(kept).toHaveLength(1);
  });
});

describe('site-scoped generation (cross-site isolation)', () => {
  it("never hands another site's keywords, research history or titles to the generator", async () => {
    const { accountId, siteA } = await seedTwoSites();
    const seen: Array<Parameters<SummaryProvider['generatePrompts']>[0]> = [];
    const summaryProvider: SummaryProvider = {
      ...createFakeSummaryProvider(),
      async generatePrompts(input) {
        seen.push(input);
        return createFakeSummaryProvider().generatePrompts(input);
      },
    };
    const result = await generatePromptSuggestions(
      { accountId, siteId: siteA, outputLocale: 'en' },
      { db: db(), provider: createFakeAiVisibilityProvider(), summaryProvider },
    );
    expect(seen).toHaveLength(1);
    const inputs = JSON.stringify(seen[0]!.seeds);
    expect(inputs).not.toMatch(OTHER_SITE);
    // One AI call in the site's market language; no second generation.
    expect(seen[0]!.locale).toBe('ar');
    expect(result.outputLocale).toBe('ar');
    for (const suggestion of result.suggestions) {
      expect(suggestion.prompt).not.toMatch(OTHER_SITE);
      expect(suggestion.prompt.toLowerCase()).not.toContain('welcome - example rewards');
    }
    // Arabic first, with English from the site's own English keywords.
    const languages = new Set(result.suggestions.map((s) => s.language));
    expect(languages.has('ar')).toBe(true);
    expect(languages.has('en')).toBe(true);
    expect(result.suggestions.length).toBeLessThanOrEqual(8);
    expect(result.stale).toBe(false);
  });
});

describe('crawled pages without a title', () => {
  it('still keeps their H1 out of the suggestions', async () => {
    const accountId = new mongoose.Types.ObjectId().toString();
    const siteId = await addSite(accountId, 'rewards.example', 'en');
    await track(accountId, siteId, ENGLISH);
    const run = await AuditRun.create({
      accountId: new mongoose.Types.ObjectId(accountId),
      siteId: new mongoose.Types.ObjectId(siteId),
      pageCap: 5,
      status: 'succeeded',
      finishedAt: new Date('2026-08-11T23:00:00.000Z'),
    });
    await AuditedPage.create({
      runId: run._id,
      url: 'https://rewards.example/',
      statusCode: 200,
      title: null,
      h1: ['Welcome - Example Rewards'],
      onPageScore: 90,
    });
    const result = await generatePromptSuggestions(
      { accountId, siteId, outputLocale: 'en' },
      { db: db(), provider: createFakeAiVisibilityProvider(), summaryProvider: createFakeSummaryProvider() },
    );
    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of result.suggestions) {
      expect(suggestion.prompt.toLowerCase()).not.toContain('welcome - example rewards');
      expect(suggestion.language).toBe('en');
    }
  });
});

describe('stored runs from before site scoping', () => {
  const legacyRun = (accountId: string, siteId: string, keywordSeeds: string[], prompt: string) =>
    insertSuggestionRun(db(), {
      id: randomUUID(),
      accountId,
      siteId,
      outputLocale: 'ar',
      prompts: [
        {
          prompt,
          source: 'template',
          funnelStage: 'consideration',
          promptType: 'categoryDiscovery',
          intent: 'commercial',
          branded: false,
          evidenceSource: 'keyword',
          evidenceRef: null,
        },
      ],
      // No provenance marker: stored before every seed read was site-scoped.
      seeds: { keywords: keywordSeeds, titles: [], competitors: [], gscQueries: [] },
      generator: 'template',
      model: null,
      generatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

  it('withholds a run carrying another site’s phrases and offers regeneration without spending', async () => {
    const { accountId, siteA } = await seedTwoSites();
    await legacyRun(accountId, siteA, ['best paystub generator'], 'best paystub generator');
    const summaryProvider = { ...createFakeSummaryProvider(), generatePrompts: vi.fn() };
    const result = await readStoredSuggestions({ accountId, siteId: siteA, outputLocale: 'en' }, { db: db() });
    expect(result).toMatchObject({ stale: true, suggestions: [], outputLocale: 'ar' });
    expect(result.generatedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(summaryProvider.generatePrompts).not.toHaveBeenCalled();

    // Regenerating replaces it with a site-scoped run that is shown again.
    await generatePromptSuggestions(
      { accountId, siteId: siteA, outputLocale: 'en' },
      { db: db(), provider: createFakeAiVisibilityProvider(), summaryProvider: createFakeSummaryProvider() },
    );
    const fresh = await readStoredSuggestions({ accountId, siteId: siteA, outputLocale: 'en' }, { db: db() });
    expect(fresh.stale).toBe(false);
    expect(fresh.suggestions.length).toBeGreaterThan(0);
    expect(JSON.stringify(fresh.suggestions)).not.toMatch(OTHER_SITE);
  });

  it("keeps an older run built only from the site's own keywords (even removed ones)", async () => {
    const { accountId, siteA } = await seedTwoSites();
    await db().insert(keywords).values({
      accountId,
      siteId: siteA,
      phrase: 'old rewards phrase',
      locationCode: 2682,
      languageCode: 'ar',
      active: false,
    });
    await legacyRun(accountId, siteA, ['Rewards App', 'old rewards phrase'], 'ما أفضل تطبيقات المكافآت؟');
    const result = await readStoredSuggestions({ accountId, siteId: siteA, outputLocale: 'en' }, { db: db() });
    expect(result).toMatchObject({ stale: false, suggestions: [{ prompt: 'ما أفضل تطبيقات المكافآت؟' }] });
  });

  it("returns 404 for another account's site on read and generate", async () => {
    const { siteA } = await seedTwoSites();
    const stranger = new mongoose.Types.ObjectId().toString();
    await expect(
      readStoredSuggestions({ accountId: stranger, siteId: siteA, outputLocale: 'en' }, { db: db() }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      generatePromptSuggestions(
        { accountId: stranger, siteId: siteA, outputLocale: 'en' },
        { db: db(), provider: createFakeAiVisibilityProvider(), summaryProvider: createFakeSummaryProvider() },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
