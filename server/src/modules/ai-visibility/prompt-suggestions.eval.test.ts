/**
 * Deterministic evaluation of the zero-spend suggestion path over
 * recorded site fixtures: category relevance, output language, near-duplicate
 * suppression, grounded comparisons and sparse evidence. No database, no
 * provider, no network: the same inputs always produce the same prompts.
 */
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../shared/i18n/locales.js';
import { buildPromptCandidates } from './prompt-candidates.js';
import { NEAR_DUPLICATE_JACCARD, jaccard, similarityTokens } from './prompt-similarity.js';
import { buildSiteProfile } from './site-profile.js';
import { FIXTURE_COMPETITORS, FIXTURE_DOMAIN, LOCALE_FIXTURES } from './suggestions.fixtures.js';

function run(locale: SupportedLocale) {
  const fixture = LOCALE_FIXTURES[locale];
  const input = {
    domain: FIXTURE_DOMAIN,
    outputLocale: locale,
    keywords: fixture.keywords,
    gscQueries: fixture.gscQueries,
    titleSeeds: [] as string[],
    competitorDomains: FIXTURE_COMPETITORS,
    pages: fixture.pages,
  };
  const profile = buildSiteProfile(input);
  return { fixture, profile, prompts: buildPromptCandidates({ ...input, profile }) };
}

const SCRIPT: Record<'ru' | 'ar' | 'zh', RegExp> = {
  ru: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
  zh: /\p{Script=Han}/u,
};
const FOREIGN_SCRIPT = /\p{Script=Cyrillic}|\p{Script=Arabic}|\p{Script=Han}/u;

/** First prompt of each locale: the best-tools question for the strongest category. */
const FIRST_PROMPT: Record<SupportedLocale, string> = {
  en: 'What are the best tools for podcast show notes?',
  ar: 'ما أفضل الأدوات المخصصة لـ«النصوص المكتوبة للبودكاست»؟',
  fr: 'Quels sont les meilleurs outils pour « notes de podcast » ?',
  de: 'Welche Tools eignen sich am besten für „Podcast Transkripte“?',
  es: '¿Cuáles son las mejores herramientas para «notas de podcast»?',
  ru: 'Какие сервисы лучше всего подходят для задачи «заметки к подкасту»?',
  zh: '有哪些适合播客节目笔记的好用工具？',
};

describe('suggestion evaluation: the reported production case', () => {
  it('replaces the formulaic page-label prompts with category prompts', () => {
    const { profile, prompts } = run('en');
    const texts = prompts.map((row) => row.prompt);
    // Page-label queries used to be the first three suggestions.
    for (const formulaic of [
      'What is the best episode pricing?',
      'Which episode pricing should I use?',
      'Is it worth paying for episode pricing?',
      'How do I choose the right episode pricing?',
    ]) {
      expect(texts).not.toContain(formulaic);
    }
    expect(texts.some((text) => text.toLowerCase().includes('pricing'))).toBe(false);
    expect(profile.categories.map((category) => category.phrase)).toEqual([
      'podcast show notes',
      'podcast transcripts',
    ]);
    expect(texts.slice(0, 8)).toEqual([
      'What are the best tools for podcast show notes?',
      'episodebrief.com vs castmagic.io',
      'What should I look for when choosing a tool for podcast show notes?',
      'What is a good alternative to castmagic.io?',
      'Which is better for podcast show notes: episodebrief.com or castmagic.io?',
      'What should I look for when choosing a tool for podcast transcripts?',
      'episodebrief.com vs podsqueeze.com',
      'Is a paid tool worth it for podcast transcripts?',
    ]);
  });
});

describe.each(SUPPORTED_LOCALES)('suggestion evaluation (%s)', (locale) => {
  const { fixture, profile, prompts } = run(locale);

  it('finds the offering from crawled copy and calls the evidence rich', () => {
    expect(profile.evidenceLevel).toBe('rich');
    for (const term of fixture.expectedCategoryTerms) {
      expect(
        profile.categories.some((category) => category.phrase.toLowerCase().includes(term)),
      ).toBe(true);
    }
  });

  it('invents nothing: every category phrase is spelled out in the evidence', () => {
    const corpus = [
      ...fixture.pages.flatMap((page) => [page.title, page.metaDescription, ...page.h1]),
      ...fixture.keywords,
      ...fixture.gscQueries,
    ]
      .join(' ')
      .toLowerCase();
    for (const category of profile.categories) {
      expect(corpus).toContain(category.phrase.toLowerCase());
    }
  });

  it('keeps navigation terms and the brand out of every category and prompt', () => {
    const brandFree = prompts
      .filter((row) => row.evidenceSource !== 'competitor')
      .map((row) => row.prompt.toLowerCase());
    for (const term of fixture.navigationTerms) {
      expect(profile.categories.some((category) => category.phrase.toLowerCase().includes(term))).toBe(false);
      expect(brandFree.some((text) => text.includes(term))).toBe(false);
    }
    expect(profile.categories.some((category) => /episodebrief/i.test(category.phrase))).toBe(false);
  });

  it('writes every prompt in the output language and opens with the category question', () => {
    expect(prompts[0]!.prompt).toBe(FIRST_PROMPT[locale]);
    if (locale === 'ru' || locale === 'ar' || locale === 'zh') {
      const categoryRows = prompts.filter((row) => row.evidenceSource === 'title');
      expect(categoryRows.length).toBeGreaterThan(0);
      expect(categoryRows.every((row) => SCRIPT[locale].test(row.prompt))).toBe(true);
    } else {
      expect(prompts.some((row) => FOREIGN_SCRIPT.test(row.prompt))).toBe(false);
    }
  });

  it('suppresses near-duplicates: no two prompts reach the Jaccard threshold', () => {
    for (let a = 0; a < prompts.length; a += 1) {
      for (let b = a + 1; b < prompts.length; b += 1) {
        const overlap = jaccard(
          similarityTokens(prompts[a]!.prompt, locale),
          similarityTokens(prompts[b]!.prompt, locale),
        );
        expect(overlap).toBeLessThan(NEAR_DUPLICATE_JACCARD);
      }
    }
  });

  it('names only the competitors the account stored', () => {
    const allowed = new Set([FIXTURE_DOMAIN, ...FIXTURE_COMPETITORS]);
    const named = prompts.flatMap((row) => row.prompt.match(/[a-z0-9-]+\.(?:com|io)/g) ?? []);
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((domain) => allowed.has(domain))).toBe(true);
    const comparisons = prompts.filter((row) => row.promptType === 'comparison');
    expect(comparisons.length).toBeGreaterThanOrEqual(3);
    expect(comparisons.every((row) => row.evidenceSource === 'competitor')).toBe(true);
  });
});

describe('suggestion evaluation: sparse evidence', () => {
  const sparse = {
    domain: FIXTURE_DOMAIN,
    outputLocale: 'en' as const,
    keywords: [] as string[],
    gscQueries: ['episodebrief login'],
    titleSeeds: [] as string[],
    competitorDomains: [] as string[],
    pages: [
      {
        url: `https://${FIXTURE_DOMAIN}/`,
        title: 'Welcome | EpisodeBrief',
        metaDescription: null,
        h1: ['Home'],
      },
    ],
  };

  it('claims no offering: only truthful brand questions, reported as no evidence', () => {
    const profile = buildSiteProfile(sparse);
    expect(profile).toMatchObject({ categories: [], evidenceLevel: 'none', pageCount: 1 });
    expect(buildPromptCandidates({ ...sparse, profile }).map((row) => row.prompt)).toEqual([
      'What does episodebrief.com do?',
      'Is episodebrief.com a good choice?',
    ]);
  });

  it('adds only brand questions around one supported category, reported as limited', () => {
    const input = { ...sparse, keywords: ['podcast show notes'] };
    const profile = buildSiteProfile(input);
    expect(profile.evidenceLevel).toBe('limited');
    const texts = buildPromptCandidates({ ...input, profile }).map((row) => row.prompt);
    expect(texts).toEqual([
      'What are the best tools for podcast show notes?',
      'What should I look for when choosing a tool for podcast show notes?',
      'What does episodebrief.com do?',
      'Is episodebrief.com a good choice?',
    ]);
  });

  it('never names a competitor the account did not store', () => {
    const texts = buildPromptCandidates(sparse).map((row) => row.prompt.toLowerCase());
    expect(texts.some((text) => text.includes('castmagic') || text.includes(' vs '))).toBe(false);
  });
});
