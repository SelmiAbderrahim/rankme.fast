import { describe, expect, it } from 'vitest';
import {
  brandLabelOf,
  classifySeed,
  extractTitleTopic,
  pathLanguageOf,
  seedFitsLocale,
  startsWithEnglishTaskVerb,
} from './prompt-seed-quality.js';

describe('brandLabelOf', () => {
  it('returns the first domain label without www', () => {
    expect(brandLabelOf('www.EpisodeBrief.com')).toBe('episodebrief');
    expect(brandLabelOf('rankme.fast')).toBe('rankme');
  });

  it('returns null for labels too short to match safely', () => {
    expect(brandLabelOf('abc.io')).toBeNull();
  });
});

describe('extractTitleTopic', () => {
  const brand = 'episodebrief';

  it.each([
    // The exact fragments that used to produce unnatural prompts.
    'Help and answers',
    'Answers, grouped by where you are',
    'How EpisodeBrief works',
    'From episode to publish-ready, one pass at a time',
    'Sample output',
    'Episode pricing',
    // Other rejection rules.
    'EpisodeBrief',
    'Episode Brief app for teams',
    'Home',
    'Why we built this?',
    'Podcasts.',
    'our favourite podcast tools',
    'a very long title that keeps going well past any sensible topic',
    'one two three four five six seven',
    'abc',
  ])('rejects %j', (title) => {
    expect(extractTitleTopic(title, brand)).toBeNull();
  });

  it('keeps short topic phrases, lower-cased, with a leading article stripped', () => {
    expect(extractTitleTopic('The Podcast Show Notes Generator', brand)).toBe(
      'podcast show notes generator',
    );
    expect(extractTitleTopic('node.js hosting guide', null)).toBe('node.js hosting guide');
  });

  it('tries every separator-delimited segment and skips the brand half', () => {
    expect(extractTitleTopic('EpisodeBrief — Turn podcast episodes into show notes', brand)).toBe(
      'turn podcast episodes into show notes',
    );
    expect(extractTitleTopic('Pricing - Podcast transcription service', brand)).toBe(
      'podcast transcription service',
    );
  });

  it('accepts unspaced CJK topics by length only', () => {
    expect(extractTitleTopic('播客节目笔记生成器', null)).toBe('播客节目笔记生成器');
  });
});

describe('classifySeed', () => {
  it('rejects empty, fragment-like, and glued-sentence seeds', () => {
    expect(classifySeed('   ')).toBeNull();
    expect(classifySeed('answers, grouped by where you are')).toBeNull();
    expect(classifySeed('is it good? yes')).toBeNull();
  });

  it('treats natural questions as verbatim prompts', () => {
    expect(classifySeed('how do i write show notes')).toBe('question');
    expect(classifySeed('podcast notes tool for teams?')).toBe('question');
    expect(classifySeed('如何写播客笔记')).toBe('question');
    expect(classifySeed('播客笔记？')).toBe('question');
  });

  it('rejects questions that are too short or too long', () => {
    expect(classifySeed('what is')).toBeNull();
    expect(classifySeed(`how ${'really '.repeat(14)}works`)).toBeNull();
  });

  it('classifies verb-led seeds as tasks within the word bounds', () => {
    expect(classifySeed('turn podcast episodes into show notes')).toBe('task');
    expect(classifySeed('fix')).toBeNull();
    expect(classifySeed('turn one two three four five six seven eight')).toBeNull();
  });

  it('classifies short noun phrases as topics and rejects long ones', () => {
    expect(classifySeed('podcast show notes generator')).toBe('topic');
    // Noun-ambiguous verbs stay topics, never "How do I rank tracker?".
    expect(classifySeed('rank tracker')).toBe('topic');
    expect(classifySeed('播客笔记')).toBe('topic');
    expect(classifySeed('one two three four five six seven')).toBeNull();
  });
});

describe('pathLanguageOf', () => {
  it('reads a leading language segment, with or without a region', () => {
    expect(pathLanguageOf('https://x.com/fr/tarifs')).toBe('fr');
    expect(pathLanguageOf('https://x.com/DE-at/preise')).toBe('de');
    expect(pathLanguageOf('https://x.com/pt_BR')).toBe('pt');
  });

  it('returns null for unprefixed paths, non-language segments, and bad URLs', () => {
    expect(pathLanguageOf('https://x.com/')).toBeNull();
    expect(pathLanguageOf('https://x.com/blog/post')).toBeNull();
    expect(pathLanguageOf('https://x.com/qq/page')).toBeNull();
    expect(pathLanguageOf('not a url')).toBeNull();
  });
});

describe('seedFitsLocale', () => {
  it('keeps English seeds for English and rejects French/German ones', () => {
    expect(seedFitsLocale('episode pricing', 'en')).toBe(true);
    expect(seedFitsLocale('finish one episode without a subscription', 'en')).toBe(true);
    expect(seedFitsLocale('pass épisode', 'en')).toBe(false);
    expect(seedFitsLocale('finalisez un épisode sans abonnement', 'en')).toBe(false);
    expect(seedFitsLocale('hilfe und antworten', 'en')).toBe(false);
    expect(seedFitsLocale('поиск ключевых слов', 'en')).toBe(false);
    expect(seedFitsLocale('12345', 'en')).toBe(false);
  });

  it('allows native accents and function words for fr, de, and es', () => {
    expect(seedFitsLocale('résumé de podcast', 'fr')).toBe(true);
    expect(seedFitsLocale('show notes without effort', 'fr')).toBe(false);
    expect(seedFitsLocale('größe und preis', 'de')).toBe(true);
    expect(seedFitsLocale('résumé für podcast', 'de')).toBe(false);
    expect(seedFitsLocale('diseño de podcast', 'es')).toBe(true);
    expect(seedFitsLocale('podcast ohne abo', 'es')).toBe(false);
  });

  it('requires the own script for ru, ar, and zh', () => {
    expect(seedFitsLocale('поиск podcast', 'ru')).toBe(true);
    expect(seedFitsLocale('podcast notes', 'ru')).toBe(false);
    expect(seedFitsLocale('поиск 关键词', 'ru')).toBe(false);
    expect(seedFitsLocale('ملاحظات البودكاست', 'ar')).toBe(true);
    expect(seedFitsLocale('ملاحظات поиск', 'ar')).toBe(false);
    expect(seedFitsLocale('播客笔记', 'zh')).toBe(true);
    expect(seedFitsLocale('播客 ملاحظات', 'zh')).toBe(false);
  });
});

describe('classifySeed native task verbs', () => {
  it('recognizes Russian, Arabic, and Chinese verb-led seeds as tasks', () => {
    expect(classifySeed('исправить ошибки сканирования')).toBe('task');
    expect(classifySeed('تحسين سرعة الموقع')).toBe('task');
    expect(classifySeed('优化网站速度')).toBe('task');
    expect(classifySeed('finish one episode without a subscription')).toBe('task');
    expect(classifySeed('网站速度')).toBe('topic');
  });
});

describe('native task verbs and the English-verb check', () => {
  it('classifies French and Spanish verb-led seeds as tasks', () => {
    expect(classifySeed('améliorer la vitesse du site')).toBe('task');
    expect(classifySeed('mejorar la velocidad del sitio')).toBe('task');
    // German puts the infinitive last, so a German phrase stays a topic.
    expect(classifySeed('ladezeit verbessern')).toBe('topic');
  });

  it('recognises an English task verb opener only', () => {
    expect(startsWithEnglishTaskVerb('Fix crawl errors')).toBe(true);
    expect(startsWithEnglishTaskVerb('améliorer la vitesse')).toBe(false);
    expect(startsWithEnglishTaskVerb('seo audit')).toBe(false);
    expect(startsWithEnglishTaskVerb('   ')).toBe(false);
  });
});
