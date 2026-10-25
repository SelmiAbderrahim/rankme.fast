/**
 * Seed-quality rules for AI-Visibility prompt suggestions.
 *
 * The free template path casts each seed through fixed question shapes
 * ("What is the best {seed}?"). Casting raw page titles produced fragments
 * like "best help and answers" or "is from episode to publish-ready, one pass
 * at a time worth it". These pure helpers decide, deterministically and with
 * zero vendor spend, which seeds are safe to cast and how:
 *
 *  - `extractTitleTopic` turns a crawled title/H1 into a short topic noun
 *    phrase, or rejects it (sentence fragments, commas, generic page labels,
 *    the site's own brand, stop-word openers, out-of-range length).
 *  - `classifySeed` sorts a keyword / GSC query / cleaned title into
 *    `question` (already a natural question — used verbatim), `task`
 *    (verb-led — cast as "How do I …?"), `topic` (noun phrase — cast through
 *    the rotating templates), or `null` (unusable).
 *
 * The word lists are intentionally small and conservative: a rejected seed
 * only means fewer template suggestions, never a wrong one.
 */

import type { SupportedLocale } from '../../shared/i18n/locales.js';

export type SeedShape = 'question' | 'task' | 'topic';

/** Titles split on the usual "Topic | Brand" / "Topic - Brand" separators. */
const TITLE_SEPARATORS = /\s+-\s+|[|–—•·:]/;

/**
 * Sentence punctuation that marks a fragment rather than a topic. A period
 * only counts when it ends a word (so "node.js hosting" survives).
 */
const SENTENCE_PUNCTUATION = /[,;!¡¿()[\]{}"“”«»…，。！、；（）]|\.(?:\s|$)/;
const QUESTION_MARK = /[?？؟]/;
const TRAILING_QUESTION_MARK = /[?？؟]$/;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const CJK_QUESTION = /^(如何|怎么|怎样|为什么|什么|哪)|吗$/;

const TITLE_MIN_LENGTH = 4;
const TITLE_MAX_LENGTH = 60;
const TITLE_MAX_WORDS = 6;
const TOPIC_MAX_WORDS = 6;
const TASK_MAX_WORDS = 8;
const QUESTION_MIN_WORDS = 3;
const QUESTION_MAX_WORDS = 14;
const BRAND_MIN_LENGTH = 4;

/** Question openers across the seven locales (lower-case, first word). */
const INTERROGATIVES = new Set([
  'how', 'what', 'why', 'which', 'where', 'when', 'who', 'whose', 'is', 'are',
  'can', 'could', 'do', 'does', 'should', 'would', 'will',
  'comment', 'quel', 'quelle', 'quels', 'quelles', 'pourquoi', 'combien', 'où',
  'wie', 'was', 'warum', 'welche', 'welcher', 'welches', 'wo', 'wann', 'wer',
  'cómo', 'qué', 'cuál', 'cuáles', 'cuánto', 'dónde', 'cuándo',
  'как', 'что', 'какой', 'какая', 'какие', 'почему', 'где', 'когда', 'зачем', 'сколько',
  'كيف', 'ما', 'ماذا', 'لماذا', 'أين', 'متى', 'هل', 'أي',
]);

/**
 * Verb-led English seeds read naturally as "How do I {seed}?". Only verbs that
 * are rarely nouns: "rank tracker", "audit tool", "speed test" or "track
 * list" must stay topics, so rank/audit/speed/track/check/plan/… are absent.
 */
const EN_TASK_VERBS = new Set([
  'turn', 'convert', 'make', 'create', 'write', 'build', 'fix', 'improve',
  'increase', 'boost', 'grow', 'reduce', 'find', 'get', 'generate', 'automate',
  'learn', 'launch', 'transcribe', 'summarize', 'summarise', 'repurpose',
  'optimize', 'optimise', 'publish', 'measure', 'manage', 'analyze', 'analyse',
  'hire', 'finish', 'complete', 'edit', 'download', 'upload', 'compare',
  'choose', 'buy', 'start', 'promote', 'monetize', 'monetise', 'distribute',
]);

/**
 * Native infinitives / verbal nouns for the locales whose how-to template
 * ("Comment …", "¿Cómo puedo …") needs a verb-first seed. French and Spanish
 * seeds are otherwise indistinguishable from English by script. German has
 * none: its infinitive comes last ("Ladezeit verbessern"), so a verb-first
 * German seed cannot be dropped into a how-to template.
 */
const NATIVE_TASK_VERBS = new Set([
  'créer', 'améliorer', 'corriger', 'augmenter', 'transformer', 'écrire', 'générer',
  'publier', 'optimiser', 'mesurer', 'convertir',
  'crear', 'mejorar', 'escribir', 'generar', 'publicar', 'optimizar', 'aumentar',
  'medir',
  // Russian infinitives and Arabic verbal nouns read naturally after the
  // localized "Как …?" / "كيف يمكنني …؟" how-to templates.
  'создать', 'сделать', 'улучшить', 'исправить', 'увеличить', 'найти',
  'написать', 'оптимизировать', 'настроить',
  'تحسين', 'إصلاح', 'زيادة', 'إنشاء', 'كتابة', 'تحويل',
]);

const TASK_VERBS = new Set([...EN_TASK_VERBS, ...NATIVE_TASK_VERBS]);

/** Whether a seed opens with an English task verb ("fix crawl errors"). */
export function startsWithEnglishTaskVerb(seed: string): boolean {
  return EN_TASK_VERBS.has(wordsOf(seed)[0]?.toLowerCase() ?? '');
}

/** Chinese seeds are unspaced, so a task is recognized by its leading verb. */
const ZH_TASK_PREFIX = /^(提高|提升|优化|修复|创建|撰写|制作|增加|找到|生成)/;

/** Words a title may not open with: prepositions, pronouns, greetings, question words. */
const TITLE_LEAD_STOPWORDS = new Set([
  ...INTERROGATIVES,
  'from', 'to', 'for', 'with', 'about', 'by', 'of', 'in', 'on', 'at', 'into',
  'and', 'or', 'but', 'one', 'our', 'your', 'my', 'their', 'we', 'you', 'i',
  'it', 'this', 'that', 'these', 'those', 'here', 'there', 'welcome', 'meet',
  'introducing', 'hello', 'hi', 'thanks', 'thank', 'all', 'every', 'just',
  'only', 'more', 'less', 'not', 'no', 'was', 'were', 'be', 'did',
]);

/** Generic page labels — a title containing one is navigation, not a topic. */
export const PAGE_LABEL_WORDS = new Set([
  'about', 'account', 'answers', 'blog', 'careers', 'changelog', 'contact',
  'cookie', 'cookies', 'dashboard', 'demo', 'docs', 'documentation', 'example',
  'examples', 'faq', 'faqs', 'features', 'help', 'home', 'homepage', 'jobs',
  'legal', 'login', 'logout', 'news', 'overview', 'press', 'pricing', 'privacy',
  'register', 'sample', 'samples', 'settings', 'signin', 'signup', 'support',
  'team', 'terms', 'testimonials', 'welcome', 'works', '404',
]);

const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/**
 * The brand token of a domain ("www.episodebrief.com" → "episodebrief"), or
 * null when it is too short to match safely.
 */
export function brandLabelOf(domain: string): string | null {
  const label = domain.trim().toLowerCase().replace(/^www\./, '').split('.')[0]!;
  return label.length >= BRAND_MIN_LENGTH ? label : null;
}

function cleanTitleSegment(segment: string, brand: string | null): string | null {
  const text = segment.trim().toLowerCase().replace(/^(?:the|a|an)\s+/, '');
  if (text.length < TITLE_MIN_LENGTH || text.length > TITLE_MAX_LENGTH) return null;
  if (SENTENCE_PUNCTUATION.test(text) || QUESTION_MARK.test(text)) return null;
  if (brand && text.replace(/[\s-]/g, '').includes(brand)) return null;
  const words = wordsOf(text);
  if (!CJK.test(text) && (words.length < 2 || words.length > TITLE_MAX_WORDS)) return null;
  if (TITLE_LEAD_STOPWORDS.has(words[0]!)) return null;
  if (words.some((word) => PAGE_LABEL_WORDS.has(word))) return null;
  return text;
}

/**
 * A short topic phrase from a crawled title or H1, or null. Every
 * separator-delimited segment is tried in order, so "Brand — Turn podcast
 * episodes into show notes" yields the descriptive half, not the brand.
 */
export function extractTitleTopic(raw: string, brand: string | null): string | null {
  for (const segment of raw.split(TITLE_SEPARATORS)) {
    const topic = cleanTitleSegment(segment, brand);
    if (topic) return topic;
  }
  return null;
}

/** How a seed may be turned into a prompt, or null when it must be skipped. */
export function classifySeed(raw: string): SeedShape | null {
  const seed = raw.trim();
  const words = wordsOf(seed);
  if (words.length === 0 || SENTENCE_PUNCTUATION.test(seed)) return null;
  const hasQuestionMark = QUESTION_MARK.test(seed);
  // A '?' anywhere but the end means two sentences glued together.
  if (hasQuestionMark && !TRAILING_QUESTION_MARK.test(seed)) return null;
  const first = words[0]!.toLowerCase();
  const cjk = CJK.test(seed);
  if (hasQuestionMark || INTERROGATIVES.has(first) || CJK_QUESTION.test(seed)) {
    if (cjk) return 'question';
    return words.length >= QUESTION_MIN_WORDS && words.length <= QUESTION_MAX_WORDS
      ? 'question'
      : null;
  }
  if (cjk && ZH_TASK_PREFIX.test(seed)) return 'task';
  if (TASK_VERBS.has(first)) {
    return words.length >= 2 && words.length <= TASK_MAX_WORDS ? 'task' : null;
  }
  return words.length <= TOPIC_MAX_WORDS ? 'topic' : null;
}

// ---------------------------------------------------------------------------
// Output-language fit. A multilingual site's `/fr` and `/de`
// pages, or foreign-language GSC queries, must never be cast into an English
// question ("Is it worth paying for pass épisode?"). These checks are
// deliberately conservative: a rejected seed only means fewer suggestions.
// ---------------------------------------------------------------------------

/** ISO 639-1 codes that commonly lead a localized URL path (`/fr/…`, `/de-at/…`). */
const PATH_LANGUAGE_CODES = new Set([
  'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi',
  'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb',
  'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk',
  'ur', 'vi', 'zh',
]);
const PATH_LOCALE_SEGMENT = /^([a-z]{2})(?:[-_][a-z0-9]{2,4})?$/i;

/**
 * The language a URL's first path segment declares (`https://x.com/fr/p` →
 * `fr`), or null when the path carries no locale prefix.
 */
export function pathLanguageOf(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const first = pathname.split('/').find(Boolean);
  const match = first ? PATH_LOCALE_SEGMENT.exec(first) : null;
  const code = match?.[1]?.toLowerCase();
  return code && PATH_LANGUAGE_CODES.has(code) ? code : null;
}

const LATIN_LETTER = /[a-z]/i;
const CYRILLIC = /[\u0400-\u04ff]/;
const ARABIC = /[\u0600-\u06ff]/;
const HAN = /[\u3400-\u9fff]/;
/** Accented Latin letters (Latin-1 supplement + œ/Œ), excluding × and ÷. */
const ACCENTED_LATIN = /[\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff\u0152\u0153]/g;

/** Accented letters native to each Latin output language. */
const NATIVE_ACCENTS: Record<'en' | 'fr' | 'de' | 'es', string> = {
  en: '',
  fr: 'àâæçéèêëîïôœùûüÿ',
  de: 'äöüß',
  es: 'áéíóúüñ',
};

/** Short function words that identify a Latin-script language. */
const FUNCTION_WORDS: Record<'en' | 'fr' | 'de' | 'es', ReadonlySet<string>> = {
  en: new Set(['the', 'and', 'for', 'with', 'without', 'your', 'of', 'to', 'from']),
  fr: new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'sans', 'avec', 'pour', 'votre', 'vos', 'en']),
  de: new Set(['der', 'die', 'das', 'und', 'ohne', 'mit', 'für', 'ein', 'eine', 'einen', 'einer', 'ihre', 'ihr', 'zu', 'von']),
  es: new Set(['el', 'los', 'las', 'una', 'unos', 'y', 'sin', 'con', 'para', 'del', 'tu', 'tus', 'de', 'en']),
};

/**
 * Whether a seed reads as the output language, so it can be dropped into a
 * question template of that language without mixing languages.
 *
 * - Non-Latin outputs (ru / ar / zh) need at least one letter of their own
 *   script and none of the other two scripts.
 * - Latin outputs (en / fr / de / es) reject other scripts, accented letters
 *   foreign to the language ("épisode" in English), and function words that
 *   belong only to another Latin language ("und", "sans", "without" in French).
 */
export function seedFitsLocale(seed: string, locale: SupportedLocale): boolean {
  const text = seed.toLowerCase();
  if (locale === 'ru') return CYRILLIC.test(text) && !ARABIC.test(text) && !HAN.test(text);
  if (locale === 'ar') return ARABIC.test(text) && !CYRILLIC.test(text) && !HAN.test(text);
  if (locale === 'zh') return HAN.test(text) && !CYRILLIC.test(text) && !ARABIC.test(text);
  // Every remaining supported locale is Latin-script.
  const latin = locale as 'en' | 'fr' | 'de' | 'es';
  if (!LATIN_LETTER.test(text) || CYRILLIC.test(text) || ARABIC.test(text) || HAN.test(text)) {
    return false;
  }
  const native = NATIVE_ACCENTS[latin];
  if ((text.match(ACCENTED_LATIN) ?? []).some((char) => !native.includes(char))) return false;
  const own = FUNCTION_WORDS[latin];
  for (const word of text.split(/[\s-]+/)) {
    if (own.has(word)) continue;
    for (const [other, words] of Object.entries(FUNCTION_WORDS)) {
      if (other !== latin && words.has(word)) return false;
    }
  }
  return true;
}
