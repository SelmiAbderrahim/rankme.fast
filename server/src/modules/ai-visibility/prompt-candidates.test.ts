import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import {
  MAX_PROMPT_CANDIDATES,
  TEMPLATES_PER_TOPIC,
  buildPromptCandidates,
} from './prompt-candidates.js';
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

describe('buildPromptCandidates', () => {
  it('authors natural category questions and grounded match-ups in every supported locale', () => {
    // One two-word topic per output language, in its own script.
    const topicFor: Record<string, string> = {
      en: 'podcast show notes',
      fr: 'notes de podcast',
      de: 'podcast zusammenfassung',
      es: 'resumen de podcast',
      ru: 'заметки подкаста',
      ar: 'ملاحظات البودكاست',
      zh: '播客节目笔记',
    };
    const firstPrompts = SUPPORTED_LOCALES.map((outputLocale) => {
      const topic = topicFor[outputLocale]!;
      const out = buildPromptCandidates({
        ...base,
        domain: 'source.example',
        outputLocale,
        keywords: [topic],
        competitorDomains: ['evidence.example'],
      });
      const prompts = out.map((row) => row.prompt);
      expect(out.filter((row) => row.evidenceRef === topic)).toHaveLength(TEMPLATES_PER_TOPIC);
      expect(prompts.some((prompt) => prompt.includes(topic))).toBe(true);
      expect(prompts.some((prompt) => prompt.includes('source.example'))).toBe(true);
      expect(prompts.some((prompt) => prompt.includes('evidence.example'))).toBe(true);
      // Competitor rows cite the competitor, category rows the category; the
      // thin-evidence brand rows cite nothing.
      expect(
        out.every((row) => [topic, 'evidence.example', null].includes(row.evidenceRef)),
      ).toBe(true);
      return out[0]!.prompt;
    });
    expect(new Set(firstPrompts).size).toBe(SUPPORTED_LOCALES.length);
  });

  it('never casts a page-label query through a formulaic template', () => {
    const out = buildPromptCandidates({
      ...base,
      domain: 'episodebrief.com',
      keywords: ['episode pricing', 'podcast show notes generator'],
      gscQueries: ['episode pricing', 'podcast transcript tool'],
      titleSeeds: ['podcast show notes templates'],
    });
    const prompts = out.map((row) => row.prompt);
    for (const formulaic of [
      'What is the best episode pricing?',
      'Which episode pricing should I use?',
      'Is it worth paying for episode pricing?',
    ]) {
      expect(prompts).not.toContain(formulaic);
    }
    expect(prompts.some((prompt) => prompt.toLowerCase().includes('pricing'))).toBe(false);
    expect(prompts).toContain('What are the best tools for podcast show notes?');
  });

  it('offsets the template per category so neighbours open differently', () => {
    const out = buildPromptCandidates({
      ...base,
      profile: profileOf(['seo audit', 'site speed', 'link building'], 'rich'),
    });
    const byCategory = (phrase: string): string[] =>
      out.filter((row) => row.evidenceRef === phrase).map((row) => row.prompt);
    expect(byCategory('seo audit')).toEqual([
      'What are the best tools for seo audit?',
      'What should I look for when choosing a tool for seo audit?',
    ]);
    expect(byCategory('site speed')).toEqual([
      'What should I look for when choosing a tool for site speed?',
      'Is a paid tool worth it for site speed?',
    ]);
    expect(byCategory('link building')).toEqual([
      'Is a paid tool worth it for link building?',
      'How do I get started with link building?',
    ]);
    const taxonomy = out.find((row) => row.prompt.startsWith('Is a paid tool'));
    expect(taxonomy).toMatchObject({
      promptType: 'pricingCommercial',
      funnelStage: 'decision',
      intent: 'commercial',
      branded: false,
      evidenceSource: 'title',
    });
  });

  it('uses question seeds verbatim, casts task seeds as how-to, and ignores plain topics', () => {
    const out = buildPromptCandidates({
      ...base,
      domain: 'episodebrief.com',
      keywords: ['podcast show notes generator'],
      gscQueries: ['how do i write show notes for a podcast', 'answers, grouped by where you are'],
      titleSeeds: ['turn podcast episodes into show notes'],
    });
    const prompts = out.map((row) => row.prompt);
    expect(prompts).toContain('how do i write show notes for a podcast');
    expect(prompts).toContain('How do I turn podcast episodes into show notes?');
    const problems = out.filter((row) => row.promptType === 'problemFirst' && row.evidenceSource !== null);
    expect(problems.map((row) => [row.evidenceSource, row.evidenceRef])).toEqual(
      expect.arrayContaining([
        ['gsc', 'how do i write show notes for a podcast'],
        ['title', 'turn podcast episodes into show notes'],
      ]),
    );
    // A comma-joined tagline is dropped, never forced into a template.
    expect(prompts.some((prompt) => prompt.includes(','))).toBe(false);
  });

  it('dedupes seeds across groups and filters out-of-range or foreign-language seeds', () => {
    const out = buildPromptCandidates({
      ...base,
      keywords: [
        'how do I write show notes',
        'ab',
        `how ${'z'.repeat(121)}`,
        'comment écrire des notes',
        'turn podcasts into notes',
      ],
      gscQueries: ['HOW DO I WRITE SHOW NOTES ', 'turn podcasts into notes'],
      titleSeeds: [],
    });
    const problems = out.filter((row) => row.promptType === 'problemFirst');
    expect(problems.map((row) => row.evidenceRef)).toEqual([
      'how do I write show notes',
      'turn podcasts into notes',
    ]);
  });

  it('collapses near-identical question phrasings, first one wins', () => {
    const out = buildPromptCandidates({
      ...base,
      gscQueries: ['how do i write show notes', 'how can i write show notes', 'what is a rss feed'],
    });
    expect(
      out.filter((row) => row.promptType === 'problemFirst').map((row) => row.prompt),
    ).toEqual(['how do i write show notes', 'what is a rss feed']);
  });

  it('keeps native seeds and drops English ones for a French output', () => {
    const out = buildPromptCandidates({
      ...base,
      outputLocale: 'fr',
      gscQueries: ['comment écrire des notes de podcast', 'how to write show notes'],
    });
    expect(out.filter((row) => row.promptType === 'problemFirst').map((row) => row.evidenceRef)).toEqual([
      'comment écrire des notes de podcast',
    ]);
  });

  it('names only stored competitors: match-ups, alternatives and category comparisons', () => {
    const none = buildPromptCandidates({ ...base, profile: profileOf(['seo audit', 'site speed'], 'rich') });
    expect(none.some((row) => row.evidenceSource === 'competitor')).toBe(false);

    const one = buildPromptCandidates({
      ...base,
      competitorDomains: ['rival.example'],
      profile: profileOf(['seo audit', 'site speed'], 'rich'),
    });
    const oneCompetitor = one.filter((row) => row.evidenceSource === 'competitor');
    expect(oneCompetitor.map((row) => row.prompt).sort()).toEqual([
      'Which is better for seo audit: example.com or rival.example?',
      'What is a good alternative to rival.example?',
      'example.com vs rival.example',
    ].sort());
    expect(oneCompetitor.find((row) => row.promptType === 'alternatives')).toMatchObject({
      funnelStage: 'consideration',
      intent: 'commercial',
      branded: false,
      evidenceRef: 'rival.example',
    });
    expect(oneCompetitor.find((row) => row.prompt === 'example.com vs rival.example')).toMatchObject({
      promptType: 'comparison',
      funnelStage: 'decision',
      branded: true,
    });

    const two = buildPromptCandidates({
      ...base,
      competitorDomains: ['rival.example', 'other.example'],
      profile: profileOf(['seo audit', 'site speed'], 'rich'),
    });
    const rivalry = two.find((row) => row.prompt.includes('rival.example or other.example'));
    expect(rivalry).toMatchObject({ branded: false, evidenceRef: 'other.example', promptType: 'comparison' });

    // No category, no category comparison: only the brand-level match-up.
    const noCategory = buildPromptCandidates({
      ...base,
      competitorDomains: ['rival.example', 'other.example'],
      profile: profileOf([], 'none'),
    });
    expect(noCategory.some((row) => row.prompt.includes(' or '))).toBe(false);
  });

  it('tops thin evidence up with two brand questions that claim nothing about the offering', () => {
    const none = buildPromptCandidates({ ...base, profile: profileOf([], 'none') });
    expect(none).toEqual([
      {
        prompt: 'What does example.com do?',
        promptType: 'brandAccuracy',
        funnelStage: 'awareness',
        intent: 'informational',
        branded: true,
        evidenceSource: null,
        evidenceRef: null,
      },
      {
        prompt: 'Is example.com a good choice?',
        promptType: 'objection',
        funnelStage: 'decision',
        intent: 'commercial',
        branded: true,
        evidenceSource: null,
        evidenceRef: null,
      },
    ]);
    const limited = buildPromptCandidates({ ...base, profile: profileOf(['seo audit'], 'limited') });
    expect(limited.filter((row) => row.evidenceSource === null)).toHaveLength(2);
    const rich = buildPromptCandidates({ ...base, profile: profileOf(['seo audit', 'site speed'], 'rich') });
    expect(rich.filter((row) => row.evidenceSource === null)).toHaveLength(0);
  });

  it('builds its own profile from pages, keywords and queries when none is supplied', () => {
    const out = buildPromptCandidates({
      ...base,
      domain: 'episodebrief.com',
      pages: [
        {
          url: 'https://episodebrief.com/',
          title: 'Podcast show notes',
          metaDescription: 'Podcast show notes made simple.',
          h1: [],
        },
      ],
    });
    expect(out[0]!.prompt).toBe('What are the best tools for podcast show notes?');
    expect(out[0]!.evidenceSource).toBe('title');
  });

  it('drops prompts outside the 4..280 length window and repeated competitor prompts', () => {
    const empty = buildPromptCandidates({
      ...base,
      domain: '',
      competitorDomains: ['', ''],
      profile: profileOf([], 'none'),
    });
    // '' vs '' → 'vs' is too short; the alternative prompt appears once.
    expect(empty.map((row) => row.prompt)).toContain('What is a good alternative to ?');
    expect(empty.filter((row) => row.prompt === 'What is a good alternative to ?')).toHaveLength(1);
    expect(empty.some((row) => row.prompt === 'vs')).toBe(false);
    const longCompetitor = `${'b'.repeat(140)}.com`;
    const long = buildPromptCandidates({
      ...base,
      domain: `${'a'.repeat(140)}.com`,
      competitorDomains: [longCompetitor],
      profile: profileOf(['seo audit', 'site speed'], 'rich'),
    });
    expect(long.some((row) => row.prompt.length > 280)).toBe(false);
    expect(long.map((row) => row.prompt)).toContain(`What is a good alternative to ${longCompetitor}?`);
  });

  it('caps the output at the candidate ceiling', () => {
    const out = buildPromptCandidates({
      ...base,
      gscQueries: Array.from({ length: 12 }, (_, index) => `how do i fix problem number ${index} on a site`),
      competitorDomains: ['a.example', 'b.example', 'c.example', 'd.example', 'e.example'],
      profile: profileOf(['seo audit', 'site speed', 'link building', 'rank tracking'], 'rich'),
    });
    expect(out.length).toBeLessThanOrEqual(MAX_PROMPT_CANDIDATES);
    expect(out.length).toBeGreaterThan(8);
  });
});
