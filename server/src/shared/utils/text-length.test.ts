import { describe, expect, it } from 'vitest';
import { countCharacters, countWords, detectLanguage, displayWidth, languageClassOf, measureText, primaryLanguage } from './text-length.js';

describe('language-aware text length', () => {
  it.each([
    ['zh-Hant-TW', 'zh'], [' EN_us ', 'en'], ['ar', 'ar'], ['cmn', 'cmn'],
    [null, null], [undefined, null], ['', null], ['invalid', null],
  ])('extracts the primary language from %j', (tag, expected) => {
    expect(primaryLanguage(tag)).toBe(expected);
  });
  it.each([
    ['zh', 'ideographic'], ['ja', 'ideographic'], ['ko', 'hangul'], ['th', 'thai'],
    ['ar', 'spaced'], [null, 'spaced'], ['invalid', 'spaced'],
  ])('selects a fair measurement class for %j', (language, expected) => {
    expect(languageClassOf(language)).toBe(expected);
  });
  it.each([
    ['你好世界', 'zh'], ['東京かな', 'ja'], ['한국어 SEO', 'ko'], ['ภาษาไทย', 'th'],
    ['English 中文', null], ['123 !', null], ['Hello world', null],
  ])('recognizes the dominant unspaced script in %j', (text, expected) => {
    expect(detectLanguage(text)).toBe(expected);
  });
  it('segments words without counting markup entities, punctuation or emoji', () => {
    expect(countWords('Hello, bright world! &amp; 😀', 'en')).toBe(3);
    expect(countWords('你好 世界', 'zh')).toBe(2);
    expect(countWords('你好 世界')).toBe(2);
    expect(countWords('مرحبا بالعالم', 'ar')).toBe(2);
    expect(countWords('Hello world')).toBe(2);
    expect(countWords('Hello world', 'zz')).toBe(2);
    expect(countWords(' &amp; ')).toBe(0);
    expect(countWords('!!!')).toBe(0);
    expect(countWords('Hello world', 'en')).toBe(2);
  });
  it('counts graphemes and accounts for wide scripts', () => {
    expect(countCharacters('你 好 &amp; 👨‍👩‍👧‍👦')).toBe(3);
    expect(countCharacters('e\u0301')).toBe(1);
    expect(displayWidth('A中かな한😀')).toBe(10);
    expect(displayWidth('')).toBe(0);
  });
  it('uses words for spaced languages and characters for unspaced languages', () => {
    expect(measureText('Hello world')).toEqual({ value: 2, unit: 'words' });
    expect(measureText('你好 世界')).toEqual({ value: 4, unit: 'characters' });
    expect(measureText('한 국', 'ko')).toEqual({ value: 2, unit: 'characters' });
  });
});
