import { describe, expect, it } from 'vitest';
import {
  NEAR_DUPLICATE_JACCARD,
  dropNearDuplicates,
  jaccard,
  similarityTokens,
} from './prompt-similarity.js';

describe('similarityTokens', () => {
  it('lower-cases, drops stopwords and folds a plural s in English', () => {
    expect([...similarityTokens('What are the best Podcast Episodes?', 'en')].sort()).toEqual([
      'episode',
      'podcast',
    ]);
  });

  it('keeps short or double-s words intact and does not stem non-s-plural locales', () => {
    expect([...similarityTokens('pass bus glass', 'en')].sort()).toEqual(['bus', 'glass', 'pass']);
    // German plurals are not a trailing s: tokens are left as written.
    expect([...similarityTokens('Podcast Folgens', 'de')]).toEqual(['podcast', 'folgens']);
    // Cyrillic text is never stemmed either.
    expect([...similarityTokens('подкасты', 'ru')]).toEqual(['подкасты']);
  });

  it('cuts Han runs into character bigrams and keeps a lone character', () => {
    expect([...similarityTokens('播客节目笔记', 'zh')]).toEqual(['播客', '客节', '节目', '目笔', '笔记']);
    expect([...similarityTokens('用 播客', 'zh')].sort()).toEqual(['播客', '用']);
  });

  it('falls back to every token when the text is only stopwords, and to an empty set for no tokens', () => {
    expect([...similarityTokens('what is the', 'en')].sort()).toEqual(['is', 'the', 'what']);
    expect(similarityTokens('?!', 'en').size).toBe(0);
  });
});

describe('jaccard', () => {
  it('is shared over union and 0 for two empty sets', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(0.5);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
});

describe('dropNearDuplicates', () => {
  it('documents the 0.8 threshold', () => {
    expect(NEAR_DUPLICATE_JACCARD).toBe(0.8);
  });

  it('keeps the first of a near-identical group and distinct templates over one topic', () => {
    const rows = [
      { prompt: 'What is the best episode pricing?' },
      { prompt: 'Which episode pricing should I use?' },
      { prompt: 'What are the best episode pricing?' },
      { prompt: 'What are the best tools for podcast show notes?' },
      { prompt: 'Is a paid tool worth it for podcast show notes?' },
    ];
    expect(dropNearDuplicates(rows, 'en').map((row) => row.prompt)).toEqual([
      'What is the best episode pricing?',
      'What are the best tools for podcast show notes?',
      'Is a paid tool worth it for podcast show notes?',
    ]);
  });

  it('collapses unspaced Chinese phrasings through bigram overlap', () => {
    const rows = [
      { prompt: '有哪些适合播客节目笔记的好用工具？' },
      { prompt: '有哪些适合播客节目笔记的好用工具吗？' },
      { prompt: '如何开始播客文字稿？' },
    ];
    expect(dropNearDuplicates(rows, 'zh').map((row) => row.prompt)).toEqual([
      '有哪些适合播客节目笔记的好用工具？',
      '如何开始播客文字稿？',
    ]);
  });
});
