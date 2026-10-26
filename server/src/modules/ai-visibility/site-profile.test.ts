import { describe, expect, it } from 'vitest';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
import {
  MAX_CATEGORIES,
  buildSiteProfile,
  isNavigationalSeed,
  type EvidencePage,
} from './site-profile.js';
import { FIXTURE_DOMAIN, LOCALE_FIXTURES } from './suggestions.fixtures.js';

const DOMAIN = FIXTURE_DOMAIN;

function profileOf(input: {
  locale?: SupportedLocale;
  pages?: EvidencePage[];
  keywords?: string[];
  gscQueries?: string[];
  domain?: string;
}) {
  return buildSiteProfile({
    domain: input.domain ?? DOMAIN,
    outputLocale: input.locale ?? 'en',
    pages: input.pages ?? [],
    keywords: input.keywords ?? [],
    gscQueries: input.gscQueries ?? [],
  });
}

const page = (
  title: string | null,
  metaDescription: string | null,
  h1: string[] = [],
  path = '/',
): EvidencePage => ({ url: `https://${DOMAIN}${path}`, title, metaDescription, h1 });

describe('buildSiteProfile', () => {
  it('derives the offering from crawled copy, not from the page-label top queries', () => {
    const fixture = LOCALE_FIXTURES.en;
    const profile = profileOf({
      pages: fixture.pages,
      keywords: fixture.keywords,
      gscQueries: fixture.gscQueries,
    });
    expect(profile.categories.map((category) => category.phrase)).toEqual([
      'podcast show notes',
      'podcast transcripts',
    ]);
    expect(profile.evidenceLevel).toBe('rich');
    expect(profile.pageCount).toBe(3);
  });

  it('never turns navigation, price or brand queries into a category', () => {
    const profile = profileOf({
      keywords: ['episode pricing', 'episodebrief login', 'episode brief tips'],
      gscQueries: ['episode pricing', 'episodebrief login'],
    });
    expect(profile.categories).toEqual([]);
    expect(profile.evidenceLevel).toBe('none');
  });

  it('counts an exact keyword or query as two fields and credits its source', () => {
    const fromKeyword = profileOf({ keywords: ['podcast show notes'] });
    expect(fromKeyword.categories).toEqual([
      { phrase: 'podcast show notes', support: 3, evidenceSource: 'keyword' },
    ]);
    // One category and no crawled page: said to be limited, never rich.
    expect(fromKeyword.evidenceLevel).toBe('limited');
    const fromGsc = profileOf({ gscQueries: ['podcast transcripts'] });
    expect(fromGsc.categories).toEqual([
      { phrase: 'podcast transcripts', support: 2, evidenceSource: 'gsc' },
    ]);
  });

  it('prefers the keyword source on a tie and the strongest source otherwise', () => {
    const profile = profileOf({
      pages: [page('Podcast show notes', 'Podcast show notes made simple.')],
      keywords: ['podcast show notes'],
      gscQueries: ['podcast show notes'],
    });
    expect(profile.categories[0]).toMatchObject({
      phrase: 'podcast show notes',
      evidenceSource: 'title',
    });
    const tied = profileOf({
      keywords: ['podcast show notes'],
      gscQueries: ['podcast show notes'],
    });
    expect(tied.categories[0]).toMatchObject({ evidenceSource: 'keyword' });
  });

  it('ignores a phrase that only one title fragment mentions', () => {
    const profile = profileOf({ pages: [page('Fast podcast hosting guide', null)] });
    expect(profile.categories).toEqual([]);
    expect(profile.pageCount).toBe(1);
  });

  it('skips pages under another language path and pages with no text', () => {
    const profile = profileOf({
      pages: [
        page('Notes de podcast pour chaque épisode', 'Notes de podcast simples.', [], '/fr/notes'),
        page(null, null, []),
        page('Podcast show notes', 'Podcast show notes made simple.', [], '/en/home'),
      ],
    });
    expect(profile.pageCount).toBe(1);
    expect(profile.categories.map((category) => category.phrase)).toEqual(['podcast show notes']);
  });

  it('collects headings and meta descriptions as evidence fields', () => {
    const profile = profileOf({
      pages: [page(null, 'Podcast transcripts with speakers.', ['Podcast transcripts'])],
    });
    expect(profile.categories[0]).toMatchObject({ phrase: 'podcast transcripts', support: 5 });
  });

  it('caps categories, breaking score ties alphabetically', () => {
    const profile = profileOf({
      keywords: [
        'seo audit',
        'site speed',
        'backlink check',
        'page speed',
        'domain authority',
        'rank tracking',
      ],
    });
    expect(MAX_CATEGORIES).toBe(4);
    expect(profile.categories.map((category) => category.phrase)).toEqual([
      'backlink check',
      'domain authority',
      'page speed',
      'rank tracking',
    ]);
  });

  it('drops a phrase contained in a better-ranked one and a wider phrase over a picked one', () => {
    const notes = [
      page('Hosting', 'Podcast show notes, built daily.'),
      page('Editing', 'More podcast show notes, shipped weekly.', [], '/more'),
    ];
    const contained = profileOf({ pages: notes, keywords: ['podcast show notes'], gscQueries: ['show notes'] });
    expect(contained.categories.map((category) => category.phrase)).toEqual(['podcast show notes']);
    const wider = profileOf({ pages: notes, keywords: ['show notes'], gscQueries: ['show notes'] });
    expect(wider.categories.map((category) => category.phrase)).toEqual(['show notes']);
  });

  it('drops a Chinese fragment contained in a better-supported longer phrase', () => {
    const profile = profileOf({ locale: 'zh', keywords: ['播客节目笔记整理', '节目笔记'] });
    expect(profile.categories.map((category) => category.phrase)).toEqual(['播客节目笔记整理']);
  });

  it('uses single words only from crawled copy and only when no multi-word phrase qualifies', () => {
    const copy = [page('Transcripts and summaries', 'Transcripts and summaries for hosts.')];
    const onlySingles = profileOf({ pages: copy });
    expect(onlySingles.categories.map((category) => category.phrase)).toEqual([
      'summaries',
      'transcripts',
    ]);
    // Queries alone never make a single word a category.
    expect(profileOf({ keywords: ['transcripts for hosts', 'transcripts and notes'] }).categories).toEqual([]);
    const mixed = profileOf({ pages: copy, keywords: ['podcast show notes'] });
    expect(mixed.categories.map((category) => category.phrase)).toEqual(['podcast show notes']);
  });

  it('keeps German noun capitals in the display form', () => {
    const profile = profileOf({
      locale: 'de',
      pages: LOCALE_FIXTURES.de.pages,
    });
    expect(profile.categories.map((category) => category.phrase)).toContain('Podcast Transkripte');
  });

  it('collapses near-identical Chinese phrases through the shared Jaccard threshold', () => {
    const profile = profileOf({
      locale: 'zh',
      keywords: ['播客节目笔记整理工具集', '播客节目笔记整理工具箱'],
    });
    expect(profile.categories.map((category) => category.phrase)).toEqual(['播客节目笔记整理工具箱']);
  });

  it.each([
    ['inner stopword', 'podcast and show'],
    ['numeric edge', '2024 podcast'],
    ['generic product noun last', 'podcast tool'],
    ['navigation word', 'podcast pricing'],
    ['brand fragment', 'episodebrief podcast'],
    ['short single word', 'seo'],
    ['task verb', 'create show notes'],
    ['other language', 'épisode podcast'],
    [
      'over-long phrase',
      'abcdefghijklmnop bcdefghijklmnopq cdefghijklmnopqr defghijklmnopqrs',
    ],
  ])('rejects %s', (_label, keyword) => {
    expect(profileOf({ keywords: [keyword] }).categories).toEqual([]);
  });

  it.each([
    ['too short', '播'],
    ['too long', '播客节目笔记整理工具集合大全页面'],
    ['navigation label', '播客价格'],
    ['brand fragment', 'EpisodeBrief播客'],
    ['wrong script', 'подкаст заметки'],
    ['task prefix', '提高播客节目笔记'],
  ])('rejects a %s Chinese phrase', (_label, keyword) => {
    expect(profileOf({ locale: 'zh', keywords: [keyword] }).categories).toEqual([]);
  });

  it('reports rich only with two categories and crawled copy behind them', () => {
    const keywords = ['podcast show notes', 'podcast transcripts'];
    expect(profileOf({ keywords }).evidenceLevel).toBe('limited');
    expect(
      profileOf({ keywords, pages: [page('Podcast show notes', 'Podcast transcripts too.')] })
        .evidenceLevel,
    ).toBe('rich');
  });
});

describe('isNavigationalSeed', () => {
  it('flags brand fragments and price or page-chrome words, in any spacing', () => {
    expect(isNavigationalSeed('episodebrief login', 'en', DOMAIN)).toBe(true);
    expect(isNavigationalSeed('episode brief tips', 'en', DOMAIN)).toBe(true);
    expect(isNavigationalSeed('Episode pricing', 'en', DOMAIN)).toBe(true);
    expect(isNavigationalSeed('tarif épisode', 'fr', DOMAIN)).toBe(true);
    expect(isNavigationalSeed('podcast show notes', 'en', DOMAIN)).toBe(false);
  });

  it('matches Chinese labels as substrings and skips brand matching for short domains', () => {
    expect(isNavigationalSeed('播客价格', 'zh', DOMAIN)).toBe(true);
    expect(isNavigationalSeed('播客节目笔记', 'zh', DOMAIN)).toBe(false);
    expect(isNavigationalSeed('a b', 'en', 'a.co')).toBe(false);
    expect(isNavigationalSeed('?!', 'en', DOMAIN)).toBe(false);
  });
});
