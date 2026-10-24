import { describe, expect, it } from 'vitest';
import { addPhrases, cleanPhrase, formatPhraseList, hasPhraseSeparator, lastPhraseSeparatorIndex, normalizePhraseKey, parsePhraseList, parsePhraseListDetailed, removePhraseAt, reviewPhraseList, splitPhraseList } from './phraseList';

describe('phrase list parsing', () => {
  it.each([
    ['a, b; c\r\nd\te', ['a', 'b', 'c', 'd', 'e']],
    [' a ,, b ,\n\n', ['a', 'b']],
    ['"best crm, free", crm tools', ['best crm, free', 'crm tools']],
    ['"the ""best"" crm", x', ['the "best" crm', 'x']],
    ['“crm, free”, y', ['crm, free', 'y']],
    ['"best crm, free', ['"best crm', 'free']],
    ['27" monitor, laptop', ['27" monitor', 'laptop']],
    ["'seo audit'", ['seo audit']],
    ['- seo audit\n* rank tracker\n• backlinks\n– links', ['seo audit', 'rank tracker', 'backlinks', 'links']],
    ['1. seo audit\n2) rank tracker\n(3) backlinks', ['seo audit', 'rank tracker', 'backlinks']],
    ['3. sınıf matematik', ['3. sınıf matematik']],
    ['1.5 inch monitor\n2.5 inch drive', ['1.5 inch monitor', '2.5 inch drive']],
    ['e-commerce seo, salt and pepper', ['e-commerce seo', 'salt and pepper']],
    ['بحث، ترتيب؛ روابط', ['بحث', 'ترتيب', 'روابط']],
    ['搜索，排名、外链；内容', ['搜索', '排名', '外链', '内容']],
    ['seo\u200b audit', ['seo audit']],
    ["•\n''\na", ['a']],
    ['', []],
    [' \n\t ,; ', []],
  ] as const)('parses multilingual and quoted input %j', (raw, phrases) => {
    expect(parsePhraseList(raw)).toEqual(phrases);
  });

  it('normalizes comparison keys while preserving the first spelling', () => {
    expect(cleanPhrase(' \u200b SEO   Audit ')).toBe('SEO Audit');
    expect(normalizePhraseKey(' ＳＥＯ  Audit ')).toBe('seo audit');
    expect(parsePhraseListDetailed('SEO Audit\nseo  audit\nＳＥＯ audit\nrank')).toEqual({ phrases: ['SEO Audit', 'rank'], duplicates: ['seo audit', 'ＳＥＯ audit'], ignoredColumns: false, skippedHeader: null });
    expect(splitPhraseList('a, B, b, A')).toEqual(['a', 'B', 'b', 'A']);
  });

  it.each([
    ['Keyword\tVolume\tDifficulty\nbest crm\t1,200\t45\ncrm tools\t880\t31%', ['best crm', 'crm tools'], true, 'Keyword'],
    ['best crm\t1200\ncrm tools\t880', ['best crm', 'crm tools'], true, null],
    ['best crm\t1200\t45', ['best crm'], true, null],
    ['a\tb\nc\td', ['a', 'c'], true, null],
    ['a\tb\tc', ['a', 'b', 'c'], false, null],
    ['best crm\ncrm tools', ['best crm', 'crm tools'], false, null],
    ['a\t\nb\t1', ['a', 'b'], true, null],
    ['\tVolume\nbest crm\t12', ['best crm'], true, null],
    ['Keyword\tNote\nbest crm\tcheap', ['Keyword', 'best crm'], true, null],
  ] as const)('reports spreadsheet handling for %j', (raw, phrases, ignoredColumns, skippedHeader) => {
    expect(parsePhraseListDetailed(raw)).toMatchObject({ phrases, ignoredColumns, skippedHeader });
  });

  it('round-trips separators, wrapping quotes and removals without changing phrases', () => {
    const phrases = ['a', 'b, c', 'say "hi"', '“quoted” start'];
    const raw = formatPhraseList(phrases);
    expect(parsePhraseList(raw)).toEqual(phrases);
    expect(parsePhraseList(removePhraseAt(raw, 1))).toEqual(['a', 'say "hi"', '“quoted” start']);
    expect(hasPhraseSeparator('a b')).toBe(false);
    expect(hasPhraseSeparator('a\rb')).toBe(true);
  });

  it.each([['abc', -1], ['a,b', 1], ['a, b;', 4], ['"a, b', -1], ['"a, b", c', 6], ['x "a, b', 4], ['"a\nb', 2], ['  "a, b', -1]] as const)('locates the last completed phrase in %j', (raw, index) => {
    expect(lastPhraseSeparatorIndex(raw)).toBe(index);
  });

  it('reviews repeated, existing and overlong items in input order', () => {
    const review = reviewPhraseList('a\nA\nold\nwaytoolongphrase\nb\nc\nd\nb', { maxLength: 10, maxItems: 5, existingKeys: new Set(['old']) });
    expect(review.items.map(({ phrase, verdict }) => [phrase, verdict])).toEqual([['a', 'ready'], ['A', 'repeated'], ['old', 'existing'], ['waytoolongphrase', 'tooLong'], ['b', 'ready'], ['c', 'ready']]);
    expect(review.ready).toEqual(['a', 'b', 'c']);
    expect(review.counts).toEqual({ ready: 3, repeated: 1, existing: 1, tooLong: 1 });
    expect(review.overPasteLimit).toBe(1);
    expect(reviewPhraseList('a, b', { maxLength: 10, maxItems: 100 }).ready).toEqual(['a', 'b']);
  });

  it('bounds the reviewed batch and reports the rest of a large paste', () => {
    const review = reviewPhraseList(Array.from({ length: 1000 }, (_, i) => `keyword ${i}`).join('\n'), { maxLength: 300, maxItems: 100 });
    expect(review.ready).toHaveLength(100);
    expect(review.overPasteLimit).toBe(900);
  });

  it('reports duplicates and input caps while preserving unchanged chip arrays', () => {
    const existing = ['Seo Audit'];
    const result = addPhrases(existing, ['seo  audit', 'new', 'NEW', 'New ', 'seo audit', ' ', 'toolongphrase', 'third'], { max: 2, maxLength: 10 });
    expect(result).toEqual({ chips: ['Seo Audit', 'new'], added: ['new'], duplicates: ['seo audit', 'NEW'], tooLong: ['toolongphrase'], overLimit: ['third'] });
    expect(addPhrases(existing, [' ', 'seo audit'], { max: 1, maxLength: 10 }).chips).toBe(existing);
  });
});
