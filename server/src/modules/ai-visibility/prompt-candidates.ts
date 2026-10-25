/**
 * Deterministic, zero-spend AI-Visibility suggestion candidates.
 *
 * What a buyer asks an AI assistant is about the CATEGORY the site competes
 * in, so every topic prompt is built from a category phrase derived by
 * `buildSiteProfile` from the site's own crawled copy, tracked keywords and
 * search queries, never from a raw top query. Raw seeds are used only when
 * they already read as a question (verbatim) or a task ("How do I …?").
 *
 * Competitor prompts come exclusively from competitors the account has stored
 * for the site. When the evidence yields fewer than two categories the set is
 * topped up with two truthful brand questions that claim nothing about what the
 * site offers, and the caller reports the run as limited-evidence.
 */

import type { SupportedLocale } from '../../shared/i18n/locales.js';
import type { AiPromptSuggestionRow } from '../../db/schema/index.js';
import {
  classifySeed,
  seedFitsLocale,
  startsWithEnglishTaskVerb,
  type SeedShape,
} from './prompt-seed-quality.js';
import { dropNearDuplicates } from './prompt-similarity.js';
import {
  MIN_RICH_CATEGORIES,
  buildSiteProfile,
  type EvidencePage,
  type SiteProfile,
} from './site-profile.js';

/** Template questions one category may produce. */
export const TEMPLATES_PER_TOPIC = 2;
export const MAX_PROMPT_CANDIDATES = 20;
const MIN_SEED_LENGTH = 3;
const MAX_SEED_LENGTH = 120;
const MIN_PROMPT_LENGTH = 4;
const MAX_PROMPT_LENGTH = 280;

type Taxonomy = Pick<
  AiPromptSuggestionRow,
  'funnelStage' | 'promptType' | 'intent' | 'branded'
>;

/** A template-built candidate: prompt text plus the taxonomy + evidence trail. */
export interface TemplateCandidate extends Taxonomy {
  prompt: string;
  evidenceSource: AiPromptSuggestionRow['evidenceSource'];
  evidenceRef: string | null;
}

type Cast = (category: string) => string;

interface PromptCatalog {
  /** Four category questions: best tools, what to look for, paid worth it, getting started. */
  category: readonly [Cast, Cast, Cast, Cast];
  /**
   * Verb-led seeds ("turn podcast episodes into show notes") → "How do I …?".
   * Absent when the language cannot take a verb-first seed (German puts the
   * infinitive last), in which case task seeds are dropped.
   */
  howTo?: (seed: string) => string;
  comparison: (site: string, competitor: string) => string;
  alternative: (competitor: string) => string;
  /** "A or B for {category}?" — used with the site vs a rival, or two rivals. */
  compareFor: (a: string, b: string, category: string) => string;
  brandWhat: (site: string) => string;
  brandChoice: (site: string) => string;
}

/**
 * Authored product prose, one natural phrasing per locale. Outside English
 * and Chinese the category sits inside that language's quotation marks, so a
 * phrase lifted from page copy stays an inert label instead of a noun with the
 * wrong article, gender or case.
 */
const CATALOGS: Record<SupportedLocale, PromptCatalog> = {
  en: {
    category: [
      (x) => `What are the best tools for ${x}?`,
      (x) => `What should I look for when choosing a tool for ${x}?`,
      (x) => `Is a paid tool worth it for ${x}?`,
      (x) => `How do I get started with ${x}?`,
    ],
    howTo: (seed) => `How do I ${seed}?`,
    comparison: (site, competitor) => `${site} vs ${competitor}`,
    alternative: (competitor) => `What is a good alternative to ${competitor}?`,
    compareFor: (a, b, x) => `Which is better for ${x}: ${a} or ${b}?`,
    brandWhat: (site) => `What does ${site} do?`,
    brandChoice: (site) => `Is ${site} a good choice?`,
  },
  ar: {
    category: [
      (x) => `ما أفضل الأدوات المخصصة لـ«${x}»؟`,
      (x) => `ما الذي يجب أن أنتبه له عند اختيار أداة لـ«${x}»؟`,
      (x) => `هل تستحق الأداة المدفوعة لـ«${x}» ثمنها؟`,
      (x) => `كيف أبدأ مع «${x}»؟`,
    ],
    howTo: (seed) => `كيف يمكنني ${seed}؟`,
    comparison: (site, competitor) => `${site} مقابل ${competitor}`,
    alternative: (competitor) => `بديل لـ ${competitor}`,
    compareFor: (a, b, x) => `${a} أم ${b}: أيهما أفضل لـ«${x}»؟`,
    brandWhat: (site) => `ماذا يقدم ${site}؟`,
    brandChoice: (site) => `هل ${site} خيار جيد؟`,
  },
  fr: {
    category: [
      (x) => `Quels sont les meilleurs outils pour « ${x} » ?`,
      (x) => `Sur quels critères choisir un outil pour « ${x} » ?`,
      (x) => `Un outil payant vaut-il le coup pour « ${x} » ?`,
      (x) => `Comment bien démarrer avec « ${x} » ?`,
    ],
    howTo: (seed) => `Comment ${seed} ?`,
    comparison: (site, competitor) => `${site} ou ${competitor}`,
    alternative: (competitor) => `alternative à ${competitor}`,
    compareFor: (a, b, x) => `${a} ou ${b} : lequel choisir pour « ${x} » ?`,
    brandWhat: (site) => `Que fait ${site} ?`,
    brandChoice: (site) => `${site} est-il un bon choix ?`,
  },
  de: {
    category: [
      (x) => `Welche Tools eignen sich am besten für „${x}“?`,
      (x) => `Worauf sollte ich bei der Wahl eines Tools für „${x}“ achten?`,
      (x) => `Lohnt sich ein kostenpflichtiges Tool für „${x}“?`,
      (x) => `Wie fange ich mit „${x}“ an?`,
    ],
    comparison: (site, competitor) => `${site} vs. ${competitor}`,
    alternative: (competitor) => `Alternative zu ${competitor}`,
    compareFor: (a, b, x) => `${a} oder ${b}: Was ist besser für „${x}“?`,
    brandWhat: (site) => `Was macht ${site}?`,
    brandChoice: (site) => `Ist ${site} eine gute Wahl?`,
  },
  es: {
    category: [
      (x) => `¿Cuáles son las mejores herramientas para «${x}»?`,
      (x) => `¿En qué debo fijarme al elegir una herramienta para «${x}»?`,
      (x) => `¿Merece la pena pagar por una herramienta para «${x}»?`,
      (x) => `¿Cómo empiezo con «${x}»?`,
    ],
    howTo: (seed) => `¿Cómo puedo ${seed}?`,
    comparison: (site, competitor) => `${site} frente a ${competitor}`,
    alternative: (competitor) => `alternativa a ${competitor}`,
    compareFor: (a, b, x) => `${a} o ${b}: ¿cuál es mejor para «${x}»?`,
    brandWhat: (site) => `¿Qué hace ${site}?`,
    brandChoice: (site) => `¿Es ${site} una buena opción?`,
  },
  ru: {
    category: [
      (x) => `Какие сервисы лучше всего подходят для задачи «${x}»?`,
      (x) => `На что обратить внимание при выборе сервиса для «${x}»?`,
      (x) => `Стоит ли платить за сервис для «${x}»?`,
      (x) => `С чего начать работу над задачей «${x}»?`,
    ],
    howTo: (seed) => `Как ${seed}?`,
    comparison: (site, competitor) => `${site} или ${competitor}`,
    alternative: (competitor) => `альтернатива ${competitor}`,
    compareFor: (a, b, x) => `${a} или ${b}: что лучше подходит для «${x}»?`,
    brandWhat: (site) => `Чем занимается ${site}?`,
    brandChoice: (site) => `Стоит ли выбирать ${site}?`,
  },
  zh: {
    category: [
      (x) => `有哪些适合${x}的好用工具？`,
      (x) => `选择${x}工具时应该注意什么？`,
      (x) => `${x}值得购买付费工具吗？`,
      (x) => `如何开始${x}？`,
    ],
    howTo: (seed) => `如何${seed}？`,
    comparison: (site, competitor) => `${site}与${competitor}对比`,
    alternative: (competitor) => `${competitor}的替代方案`,
    compareFor: (a, b, x) => `${a}与${b}，哪个更适合${x}？`,
    brandWhat: (site) => `${site}是做什么的？`,
    brandChoice: (site) => `${site}值得选择吗？`,
  },
};

const CATEGORY_TAXONOMY: readonly Taxonomy[] = [
  { promptType: 'categoryDiscovery', funnelStage: 'consideration', intent: 'commercial', branded: false },
  { promptType: 'useCase', funnelStage: 'consideration', intent: 'commercial', branded: false },
  { promptType: 'pricingCommercial', funnelStage: 'decision', intent: 'commercial', branded: false },
  { promptType: 'problemFirst', funnelStage: 'awareness', intent: 'informational', branded: false },
];

const PROBLEM_FIRST_TAXONOMY: Taxonomy = {
  promptType: 'problemFirst',
  funnelStage: 'awareness',
  intent: 'informational',
  branded: false,
};

const COMPARISON_TAXONOMY = {
  promptType: 'comparison',
  funnelStage: 'decision',
  intent: 'commercial',
} as const;

/** Round-robin across lists so the first eight mix every kind of prompt. */
function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) if (index < list.length) out.push(list[index]!);
  }
  return out;
}

export function buildPromptCandidates(input: {
  domain: string;
  outputLocale: SupportedLocale;
  keywords: string[];
  gscQueries: string[];
  titleSeeds: string[];
  competitorDomains: string[];
  /** Crawled pages for the profile; ignored when `profile` is supplied. */
  pages?: readonly EvidencePage[];
  /** Pre-built profile, so the caller can report its evidence level. */
  profile?: SiteProfile;
}): TemplateCandidate[] {
  const locale = input.outputLocale;
  const catalog = CATALOGS[locale];
  const profile =
    input.profile ??
    buildSiteProfile({
      domain: input.domain,
      outputLocale: locale,
      pages: input.pages ?? [],
      keywords: input.keywords,
      gscQueries: input.gscQueries,
    });

  // Question and task seeds only. Plain topic seeds feed the profile instead
  // of being cast through a template.
  const seen = new Set<string>();
  const problems: TemplateCandidate[] = [];
  const collect = (raw: string, evidenceSource: 'keyword' | 'gsc' | 'title'): void => {
    const seed = raw.trim();
    const identity = seed.toLocaleLowerCase('en-US');
    if (seed.length < MIN_SEED_LENGTH || seed.length > MAX_SEED_LENGTH || seen.has(identity)) return;
    if (!seedFitsLocale(seed, locale)) return;
    const shape: SeedShape | null = classifySeed(seed);
    if (shape !== 'question' && shape !== 'task') return;
    // An English verb in a French or Spanish how-to ("Comment fix …") is a
    // mixed-language question, so only native verb-led seeds reach the template.
    const howTo = catalog.howTo;
    if (shape === 'task' && (!howTo || (locale !== 'en' && startsWithEnglishTaskVerb(seed)))) {
      return;
    }
    seen.add(identity);
    problems.push({
      prompt: shape === 'question' ? seed : howTo!(seed),
      ...PROBLEM_FIRST_TAXONOMY,
      evidenceSource,
      evidenceRef: seed,
    });
  };
  for (const raw of input.keywords) collect(raw, 'keyword');
  for (const raw of input.gscQueries) collect(raw, 'gsc');
  for (const raw of input.titleSeeds) collect(raw, 'title');

  const versus = input.competitorDomains.map((domain): TemplateCandidate => ({
    prompt: catalog.comparison(input.domain, domain),
    ...COMPARISON_TAXONOMY,
    // Contains the site's own domain, so it IS a branded prompt.
    branded: true,
    evidenceSource: 'competitor',
    evidenceRef: domain,
  }));
  const alternatives = input.competitorDomains.map((domain): TemplateCandidate => ({
    prompt: catalog.alternative(domain),
    promptType: 'alternatives',
    funnelStage: 'consideration',
    intent: 'commercial',
    // Names only the competitor — unbranded discovery from our side.
    branded: false,
    evidenceSource: 'competitor',
    evidenceRef: domain,
  }));

  // Category comparisons name only competitors the account stored, and only
  // for the best-supported category.
  const lead = profile.categories[0];
  const [rivalA, rivalB] = input.competitorDomains;
  const categoryComparisons: TemplateCandidate[] = [];
  if (lead && rivalA) {
    categoryComparisons.push({
      prompt: catalog.compareFor(input.domain, rivalA, lead.phrase),
      ...COMPARISON_TAXONOMY,
      branded: true,
      evidenceSource: 'competitor',
      evidenceRef: rivalA,
    });
    if (rivalB) {
      categoryComparisons.push({
        prompt: catalog.compareFor(rivalA, rivalB, lead.phrase),
        ...COMPARISON_TAXONOMY,
        branded: false,
        evidenceSource: 'competitor',
        evidenceRef: rivalB,
      });
    }
  }

  // Two questions per category, offset per category so neighbours open
  // differently ("best tools", "what to look for", "paid worth it", "start").
  const categoryRounds: TemplateCandidate[][] = [];
  for (let round = 0; round < TEMPLATES_PER_TOPIC; round += 1) {
    categoryRounds.push(
      profile.categories.map((category, index) => {
        const slot = (round + index) % CATEGORY_TAXONOMY.length;
        return {
          prompt: catalog.category[slot]!(category.phrase),
          ...CATEGORY_TAXONOMY[slot]!,
          evidenceSource: category.evidenceSource,
          evidenceRef: category.phrase,
        };
      }),
    );
  }

  // Thin evidence: say only what is true of any site, never what it offers.
  const brandFallback: TemplateCandidate[] =
    profile.categories.length >= MIN_RICH_CATEGORIES
      ? []
      : [
          {
            prompt: catalog.brandWhat(input.domain),
            promptType: 'brandAccuracy',
            funnelStage: 'awareness',
            intent: 'informational',
            branded: true,
            evidenceSource: null,
            evidenceRef: null,
          },
          {
            prompt: catalog.brandChoice(input.domain),
            promptType: 'objection',
            funnelStage: 'decision',
            intent: 'commercial',
            branded: true,
            evidenceSource: null,
            evidenceRef: null,
          },
        ];

  // Category questions lead: they are what a buyer asks an assistant before
  // any brand is named. Competitor lists follow, then the first eight mix both.
  const ordered = interleave([
    categoryRounds[0]!,
    versus,
    problems,
    categoryRounds[1]!,
    alternatives,
    categoryComparisons,
    brandFallback,
  ]);

  const exact = new Set<string>();
  const kept: TemplateCandidate[] = [];
  for (const candidate of ordered) {
    const prompt = candidate.prompt.trim();
    const key = prompt.toLowerCase();
    if (prompt.length < MIN_PROMPT_LENGTH || prompt.length > MAX_PROMPT_LENGTH || exact.has(key)) {
      continue;
    }
    exact.add(key);
    kept.push({ ...candidate, prompt });
  }
  return dropNearDuplicates(kept, locale).slice(0, MAX_PROMPT_CANDIDATES);
}
