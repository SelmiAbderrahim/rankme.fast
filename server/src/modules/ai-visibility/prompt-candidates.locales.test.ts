/**
 * Locale sweep for the authored suggestion templates: every template of every
 * locale is exercised, and the verb-led how-to template only receives seeds
 * that already read as that language.
 */
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import { buildPromptCandidates } from './prompt-candidates.js';
import type { SiteProfile } from './site-profile.js';

const base = {
  domain: 'example.com',
  outputLocale: 'en' as const,
  keywords: [] as string[],
  gscQueries: [] as string[],
  titleSeeds: [] as string[],
  competitorDomains: [] as string[],
};

const profileOf = (phrases: string[], evidenceLevel: SiteProfile['evidenceLevel']): SiteProfile => ({
  categories: phrases.map((phrase) => ({ phrase, support: 6, evidenceSource: 'title' as const })),
  evidenceLevel,
  pageCount: 1,
});

describe('buildPromptCandidates locale sweep', () => {
  it('exercises every authored template in every locale', () => {
    for (const outputLocale of SUPPORTED_LOCALES) {
      const rich = buildPromptCandidates({
        ...base,
        outputLocale,
        competitorDomains: ['rival.example', 'other.example'],
        profile: profileOf(['alpha', 'beta', 'gamma', 'delta'], 'rich'),
      });
      // 4 categories x 2 questions, 2 match-ups, 2 alternatives, 2 category comparisons.
      expect(rich).toHaveLength(14);
      expect(new Set(rich.map((row) => row.prompt)).size).toBe(14);
      const thin = buildPromptCandidates({ ...base, outputLocale, profile: profileOf([], 'none') });
      expect(thin.map((row) => row.promptType)).toEqual(['brandAccuracy', 'objection']);
    }
  });

  it('casts native verb-led seeds as how-to and drops English or German ones', () => {
    const taskFor: Record<string, string> = {
      en: 'fix crawl errors',
      fr: 'améliorer la vitesse du site',
      es: 'mejorar los resultados del sitio',
      ru: 'исправить ошибки сканирования',
      ar: 'تحسين سرعة الموقع',
      zh: '优化网站速度',
    };
    for (const [outputLocale, seed] of Object.entries(taskFor)) {
      const [first] = buildPromptCandidates({
        ...base,
        outputLocale: outputLocale as (typeof SUPPORTED_LOCALES)[number],
        gscQueries: [seed],
        profile: profileOf([], 'none'),
      });
      expect(first).toMatchObject({ promptType: 'problemFirst', evidenceRef: seed });
      expect(first!.prompt).toContain(seed);
      expect(first!.prompt).not.toBe(seed);
    }
    // An English verb inside a French or Spanish how-to is a mixed-language question.
    for (const outputLocale of ['fr', 'es'] as const) {
      const out = buildPromptCandidates({
        ...base,
        outputLocale,
        gscQueries: ['fix crawl errors'],
        profile: profileOf([], 'none'),
      });
      expect(out.some((row) => row.evidenceRef === 'fix crawl errors')).toBe(false);
    }
    // German has no verb-first how-to: task-shaped seeds are dropped.
    const german = buildPromptCandidates({
      ...base,
      outputLocale: 'de',
      gscQueries: ['fix crawl errors', 'wie schreibe ich shownotes'],
      profile: profileOf([], 'none'),
    });
    expect(german.filter((row) => row.promptType === 'problemFirst').map((row) => row.prompt)).toEqual([
      'wie schreibe ich shownotes',
    ]);
  });
});
