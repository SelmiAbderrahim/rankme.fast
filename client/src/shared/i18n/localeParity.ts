import { collectQualityIssues } from './translation-quality';

export type LocaleResources = Record<string, Record<string, unknown>>;
export type ParityIssueKind = 'missing-key' | 'extra-key' | 'placeholder-mismatch' | 'plural-category-missing' | 'value-is-key' | 'copied-english';
export interface ParityIssue { kind: ParityIssueKind; locale: string; namespace: string; key: string; detail: string }

/** String leaves only; missing or non-string values never manufacture keys. */
export function flatten(tree: unknown, prefix = ''): Map<string, string> {
  const strings = new Map<string, string>();
  if (tree === null || typeof tree !== 'object') return strings;
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') strings.set(path, value);
    else for (const [nested, text] of flatten(value, path)) strings.set(nested, text);
  }
  return strings;
}

export const placeholderNames = (value: string): string[] => Array.from(value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)(?:\s*,[^{}]+)?\s*\}\}/g), (match) => match[1]!).sort();
export const pluralCategories = (locale: string): string[] => new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
const PLURAL = /^(.*)_(zero|one|two|few|many|other)$/;
function pluralGroups(keys: Iterable<string>): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const key of keys) {
    const match = PLURAL.exec(key);
    if (!match) continue;
    const group = groups.get(match[1]!) ?? new Set<string>();
    group.add(match[2]!);
    groups.set(match[1]!, group);
  }
  return groups;
}
function placeholders(value: string, key: string): string {
  // Small CLDR forms can spell the number into the noun, especially Arabic.
  // All other variables and counted forms retain exact placeholder parity.
  return placeholderNames(value).filter((name) => name !== 'count' || !/_(zero|one|two)$/.test(key)).join(',');
}

/** Collect every problem so a failed check names the locale, namespace and key. */
export function checkLocaleParity(resources: LocaleResources, baseLocale = 'en', namespaces?: readonly string[]): ParityIssue[] {
  const baseResources = resources[baseLocale];
  if (!baseResources) throw new Error(`Missing base locale ${baseLocale}`);
  const issues: ParityIssue[] = [];
  for (const namespace of namespaces ?? Object.keys(baseResources)) {
    const baseTree = baseResources[namespace];
    if (baseTree === undefined) throw new Error(`Missing base namespace ${baseLocale}/${namespace}`);
    const base = flatten(baseTree);
    const basePlurals = pluralGroups(base.keys());
    for (const [locale, bundle] of Object.entries(resources)) {
      if (locale === baseLocale) continue;
      const ownTree = bundle[namespace] ?? {};
      const own = flatten(ownTree);
      const add = (kind: ParityIssueKind, key: string, detail: string) => issues.push({ kind, locale, namespace, key, detail });
      for (const key of base.keys()) if (!own.has(key)) add('missing-key', key, `absent from ${locale}`);
      for (const key of own.keys()) if (!base.has(key)) add('extra-key', key, `not in ${baseLocale}`);
      for (const [key, value] of own) {
        const baseline = base.get(key);
        if (baseline !== undefined && placeholders(baseline, key) !== placeholders(value, key)) add('placeholder-mismatch', key, `${baseLocale}: [${placeholders(baseline, key)}] ${locale}: [${placeholders(value, key)}]`);
        const text = value.trim();
        if (text === key || text === `${namespace}.${key}` || text === `${namespace}:${key}`) add('value-is-key', key, `value "${value}" is its own key`);
      }
      const ownPlurals = pluralGroups(own.keys());
      for (const stem of basePlurals.keys()) {
        const present = ownPlurals.get(stem) ?? new Set<string>();
        const missing = pluralCategories(locale).filter((category) => !present.has(category));
        if (missing.length) add('plural-category-missing', stem, `${locale} needs ${missing.join('/')}`);
      }
      for (const problem of collectQualityIssues(locale, namespace, baseTree, ownTree)) add('copied-english', problem.key, `${problem.reason}: "${problem.value}"`);
    }
  }
  return issues;
}

export function documentLocaleIssues(locale: string, html: { lang: string; dir: string }): string[] {
  const issues: string[] = [];
  if (html.lang !== locale) issues.push(`lang is "${html.lang}", expected "${locale}"`);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  if (html.dir !== dir) issues.push(`dir is "${html.dir}", expected "${dir}"`);
  return issues;
}
export const formatParityIssue = (issue: ParityIssue): string => `[${issue.kind}] ${issue.locale}/${issue.namespace}:${issue.key} — ${issue.detail}`;
