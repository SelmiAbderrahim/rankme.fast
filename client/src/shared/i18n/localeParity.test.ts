import { expect, it } from 'vitest';
import { checkLocaleParity, documentLocaleIssues, flatten, formatParityIssue, placeholderNames, pluralCategories, type LocaleResources } from './localeParity';
import { RESOURCES } from './resources';

const forms = (noun: string) => Object.fromEntries(['zero', 'one', 'two', 'few', 'many', 'other'].map((form) => [`rows_${form}`, `{{count}} ${noun}`]));
const valid = (): LocaleResources => ({ en: { ns: { title: 'Rank tracking overview', ...forms('rows') } }, fr: { ns: { title: 'Aperçu du suivi des positions', ...forms('lignes') } }, ru: { ns: { title: 'Обзор отслеживания позиций', ...forms('строк') } } });
const kinds = (resources: LocaleResources) => checkLocaleParity(resources).map((issue) => issue.kind);

it('validates all seven shipped resource trees with precise issue reports', () => {
  expect(checkLocaleParity(RESOURCES).map(formatParityIssue)).toEqual([]);
});
it('flattens nested strings and preserves formatter placeholder names', () => {
  expect([...flatten({ title: 'Title', nested: { label: 'Label' }, empty: null, number: 4 })]).toEqual([['title', 'Title'], ['nested.label', 'Label']]);
  expect([...flatten(null)]).toEqual([]);
  expect([...flatten({ label: 'Label' }, 'root')]).toEqual([['root.label', 'Label']]);
  expect(placeholderNames('{{ count, number }} / {{total}} / {{total}}')).toEqual(['count', 'total', 'total']);
});
it('detects missing and extra keys and an absent namespace', () => {
  const resources = valid();
  delete (resources.fr!.ns as Record<string, unknown>).title;
  (resources.ru!.ns as Record<string, unknown>).extra = 'Дополнительно';
  expect(kinds(resources)).toEqual(['missing-key', 'extra-key']);
  delete resources.ru!.ns;
  expect(kinds(resources)).toContain('missing-key');
  expect(() => checkLocaleParity({ fr: {} })).toThrow('Missing base locale');
  expect(() => checkLocaleParity({ en: {}, fr: {} }, 'en', ['missing'])).toThrow('Missing base namespace');
});
it('detects placeholder loss, raw keys and copied English', () => {
  const resources = valid();
  (resources.fr!.ns as Record<string, string>).rows_other = 'des lignes';
  expect(kinds(resources)).toContain('placeholder-mismatch');
  for (const raw of ['title', 'ns.title', 'ns:title']) {
    (resources.fr!.ns as Record<string, string>).title = raw;
    expect(kinds(resources)).toContain('value-is-key');
  }
  (resources.en!.ns as Record<string, string>).title = 'Track your search positions and compare recent changes.';
  (resources.fr!.ns as Record<string, string>).title = 'Track your search positions and compare recent changes.';
  expect(kinds(resources)).toContain('copied-english');
});
it('requires CLDR forms and keeps spelled-out small counts compatible', () => {
  expect(checkLocaleParity({ en: { ns: { rows_one: '{{count}} row', rows_other: '{{count}} rows' } }, ru: { ns: { rows_one: '{{count}} строка', rows_other: '{{count}} строк' } } })).toContainEqual({ kind: 'plural-category-missing', locale: 'ru', namespace: 'ns', key: 'rows', detail: 'ru needs few/many' });
  const resources = valid();
  resources.ar = { ns: { title: 'نظرة عامة على تتبّع الترتيب', ...forms('صفوف'), rows_one: 'صف واحد', rows_two: 'صفّان', rows_zero: 'لا توجد صفوف' } };
  expect(checkLocaleParity(resources)).toEqual([]);
  expect(pluralCategories('ar')).toEqual(expect.arrayContaining(['zero', 'one', 'two', 'few', 'many', 'other']));
  expect(checkLocaleParity(valid(), 'en', ['ns'])).toEqual([]);
});
it('checks document language/direction and formats actionable failures', () => {
  expect(documentLocaleIssues('ar', { lang: 'ar', dir: 'rtl' })).toEqual([]);
  expect(documentLocaleIssues('en', { lang: 'en', dir: 'ltr' })).toEqual([]);
  expect(documentLocaleIssues('ar', { lang: 'en', dir: 'ltr' })).toEqual(['lang is "en", expected "ar"', 'dir is "ltr", expected "rtl"']);
  expect(formatParityIssue({ kind: 'missing-key', locale: 'ar', namespace: 'ns', key: 'label', detail: 'absent' })).toBe('[missing-key] ar/ns:label — absent');
});
