import { describe, expect, it } from 'vitest';
import { cleanPhrase, phraseKey } from './phrase-list.js';

describe('keyword phrase normalization', () => {
  it.each([
    ['  best\t crm  ', 'best crm'], ['seo\u200Baudit', 'seoaudit'],
    ['"best crm, free"', 'best crm, free'], ["' seo audit '", 'seo audit'],
    ['“ seo  audit ”', 'seo audit'], ['‘seo’', 'seo'], ['«купить»', 'купить'],
    ['「外链」', '外链'], ['27" monitor', '27" monitor'], ['"', '"'], [' ', ''],
    ['تحسين  محركات البحث', 'تحسين محركات البحث'],
  ])('cleans %j without splitting its content', (input, output) => {
    expect(cleanPhrase(input)).toBe(output);
  });
  it('compares normalized width, case, invisible characters and whitespace', () => {
    expect(phraseKey('ＳＥＯ  Audit')).toBe('seo audit');
    expect(phraseKey('"SEO\uFEFF Audit"')).toBe('seo audit');
    expect(phraseKey('\u00A0seo\u00A0audit\u00A0')).toBe('seo audit');
  });
});
