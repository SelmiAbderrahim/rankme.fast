import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DICTIONARIES, SUPPORTED_LOCALES, translate, type DictionaryShape } from './index.js';

const originals = { ...DICTIONARIES };
beforeEach(() => {
  for (const locale of SUPPORTED_LOCALES) {
    DICTIONARIES[locale] = {
      ...originals[locale],
      cardinal: {
        item: 'base {{count}}', item_zero: 'zero {{count}}', item_one: 'one {{count}}',
        item_two: 'two {{count}}', item_few: 'few {{count}}', item_many: 'many {{count}}', item_other: 'other {{count}}',
        fallback: 'base {{count}}', fallback_one: 'one {{count}}', fallback_other: 'other {{count}}',
        plain: 'plain {{count}}',
      },
    } as DictionaryShape;
  }
});
afterEach(() => Object.assign(DICTIONARIES, originals));

describe('cardinal translation selection', () => {
  it.each([
    ['en', 1, 'one'], ['en', 2, 'other'], ['ar', 0, 'zero'], ['ar', 1, 'one'],
    ['ar', 2, 'two'], ['ar', 3, 'few'], ['ar', 27, 'many'], ['ar', 100, 'other'],
    ['ru', 1, 'one'], ['ru', 2, 'few'], ['ru', 5, 'many'], ['ru', 1.5, 'other'],
    ['fr', 1, 'one'], ['de', 2, 'other'], ['es', 2, 'other'], ['zh', 1, 'other'],
  ])('selects %s count %s as %s', (locale, count, category) => {
    expect(translate(String(locale), 'cardinal.item', { count: Number(count) })).toBe(`${category} ${count}`);
  });

  it('prefers an explicit zero form even where zero has another cardinal category', () => {
    expect(translate('en', 'cardinal.item', { count: 0 })).toBe('zero 0');
    expect(translate('fr', 'cardinal.item', { count: 0 })).toBe('zero 0');
  });

  it('falls back to the ordinary cardinal category when an explicit zero form is absent', () => {
    expect(translate('en', 'cardinal.fallback', { count: 0 })).toBe('other 0');
    expect(translate('fr', 'cardinal.fallback', { count: 0 })).toBe('one 0');
  });

  it('keeps base copy when a category is absent or count is not a finite number', () => {
    expect(translate('ar', 'cardinal.fallback', { count: 2 })).toBe('base 2');
    expect(translate('ar', 'cardinal.fallback', { count: 0 })).toBe('base 0');
    expect(translate('en', 'cardinal.plain', { count: 1 })).toBe('plain 1');
    expect(translate('en', 'cardinal.item')).toBe('base {{count}}');
    for (const count of ['1', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(translate('en', 'cardinal.item', { count })).toBe(`base ${count}`);
    }
    expect(translate('unknown', 'cardinal.item', { count: 1 })).toBe('one 1');
    expect(translate('en', 'absent.key', { count: 1 })).toBe('absent.key');
  });
});
