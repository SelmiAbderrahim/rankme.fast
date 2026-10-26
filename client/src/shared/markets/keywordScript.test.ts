import { describe, expect, it } from 'vitest';
import { dominantScript, scriptMismatch } from './keywordScript';

describe('keyword script advice', () => {
  it.each([
    ['تطبيق مكافآت', 'arabic'], ['поисковые запросы', 'cyrillic'], ['搜索排名', 'han'],
    ['ひらがなカタカナ', 'kana'], ['검색 순위', 'hangul'], ['keyword research', 'latin'],
    ['123 ١٢٣ …', 'other'], ['', 'other'], ['اa', 'arabic'],
  ] as const)('finds the dominant letter script in %s', (text, script) => {
    expect(dominantScript(text)).toBe(script);
  });

  it('suggests an offered language without blocking a deliberate choice', () => {
    expect(scriptMismatch('تطبيق مكافآت', 'en', ['en', 'ar'])).toEqual({ script: 'arabic', suggested: 'ar', offered: true });
    expect(scriptMismatch('تطبيق مكافآت', 'ar', ['ar'])).toBeNull();
    expect(scriptMismatch('تطبيق مكافآت', 'fa')).toBeNull();
    expect(scriptMismatch('北京', 'en', ['ja', 'en'])).toEqual({ script: 'han', suggested: 'ja', offered: true });
    expect(scriptMismatch('北京', 'en')).toEqual({ script: 'han', suggested: 'zh', offered: false });
    expect(scriptMismatch('hello', 'ar', ['en'])).toBeNull();
    expect(scriptMismatch('123', 'en')).toBeNull();
  });
});
