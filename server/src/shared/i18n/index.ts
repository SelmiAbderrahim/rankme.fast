import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale } from './locales.js';
import type { SupportedLocale } from './locales.js';
import { en, type DictionaryShape } from './dictionaries/en.js';
import { ar } from './dictionaries/ar.js';
import { fr } from './dictionaries/fr.js';
import { de } from './dictionaries/de.js';
import { es } from './dictionaries/es.js';
import { ru } from './dictionaries/ru.js';
import { zh } from './dictionaries/zh.js';
export { SUPPORTED_LOCALES, DEFAULT_LOCALE, isSupportedLocale, LANGUAGE_COOKIE, LANGUAGE_HEADER, RTL_LOCALES } from './locales.js';
export type { SupportedLocale } from './locales.js';
export type { DictionaryShape } from './dictionaries/en.js';
export type { TranslationKey } from './errors.js';
export { hasTranslationKey, toSupportedLocale } from './errors.js';
export const DICTIONARIES: Record<SupportedLocale, DictionaryShape> = {
    en,
    ar,
    fr,
    de,
    es,
    ru,
    zh,
};
export type TranslationVars = Record<string, string | number>;
export { localizeSemanticCopy, semanticCopy, type LocalizedSemanticCopy, type SemanticCopy, } from './deterministic-copy.js';
// Hyphen allowed so kebab-case rule ids (e.g. `robots-blocked`) can key copy
// directly under a namespace like `auditRules.<rule-id>.title`.
const KEY_SEGMENT = /^[a-zA-Z0-9_-]+$/;
function resolveKey(dict: DictionaryShape, key: string): string | undefined {
    const segments = key.split('.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cursor: any = dict;
    for (const segment of segments) {
        if (!KEY_SEGMENT.test(segment))
            return undefined;
        if (cursor == null || typeof cursor !== 'object')
            return undefined;
        cursor = cursor[segment];
    }
    return typeof cursor === 'string' ? cursor : undefined;
}
function interpolate(template: string, vars?: TranslationVars): string {
    if (!vars)
        return template;
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
        const value = vars[name];
        return value === undefined || value === null ? '' : String(value);
    });
}
export function translate(locale: string, key: string, vars?: TranslationVars): string {
    const resolvedLocale: SupportedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
    const primary = resolveKey(DICTIONARIES[resolvedLocale], key);
    if (primary !== undefined)
        return interpolate(primary, vars);
    const fallback = resolveKey(DICTIONARIES[DEFAULT_LOCALE], key);
    /* c8 ignore next -- fallback-success is unreachable: key parity guarantees every locale contains every en key, so `primary` is already defined whenever `fallback` would be. Retained as defence-in-depth. */
    if (fallback !== undefined)
        return interpolate(fallback, vars);
    return key;
}
interface QualityTag {
    tag: string;
    q: number;
}
function parseAcceptLanguage(header: string): QualityTag[] {
    return header
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
        const [rawTag, ...params] = entry.split(';');
        /* c8 ignore next -- `rawTag` is always defined: `entry` is non-empty (filtered above) and `String.split` returns at least one element. The `?? ''` only satisfies noUncheckedIndexedAccess. */
        const tag = (rawTag ?? '').trim().toLowerCase();
        let q = 1;
        for (const param of params) {
            const [name, value] = param.split('=').map((s) => s.trim());
            if (name === 'q' && value !== undefined) {
                const parsed = Number.parseFloat(value);
                if (Number.isFinite(parsed))
                    q = parsed;
            }
        }
        return { tag, q };
    })
        .filter(({ tag }) => tag.length > 0)
        .sort((a, b) => b.q - a.q);
}
function matchLocale(tag: string): SupportedLocale | undefined {
    if (!tag)
        return undefined;
    const lower = tag.toLowerCase();
    if (isSupportedLocale(lower))
        return lower;
    const primary = lower.split('-')[0];
    if (primary && isSupportedLocale(primary))
        return primary;
    return undefined;
}
export interface ResolveLanguageInput {
    acceptLanguage?: string | null;
    override?: string | null;
    cookieValue?: string | null;
    defaultLocale?: SupportedLocale;
}
export function resolveLanguage(input: ResolveLanguageInput = {}): SupportedLocale {
    const fallback = input.defaultLocale ?? DEFAULT_LOCALE;
    const overrideMatch = matchLocale((input.override ?? '').trim());
    if (overrideMatch)
        return overrideMatch;
    const cookieMatch = matchLocale((input.cookieValue ?? '').trim());
    if (cookieMatch)
        return cookieMatch;
    const header = (input.acceptLanguage ?? '').trim();
    if (header) {
        for (const { tag } of parseAcceptLanguage(header)) {
            const matched = matchLocale(tag);
            if (matched)
                return matched;
        }
    }
    return fallback;
}
export function verifyKeyParity(dicts: Record<string, unknown> = DICTIONARIES): {
    ok: true;
} | {
    ok: false;
    issues: string[];
} {
    const issues: string[] = [];
    const collectKeys = (obj: unknown, prefix = ''): Record<string, string> => {
        const out: Record<string, string> = {};
        if (obj == null || typeof obj !== 'object')
            return out;
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            const path = prefix ? `${prefix}.${k}` : k;
            /* c8 ignore start -- (1) capture group 1 always participates when the regex matches so m[1] is never undefined; (2) well-formed dicts only contain strings and nested objects so the else-if false path is unreachable in practice */
            if (typeof v === 'string') {
                const placeholders = Array.from(v.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g))
                    .map((m) => m[1] ?? '')
                    .filter(Boolean)
                    .sort()
                    .join(',');
                out[path] = placeholders;
            }
            else if (v && typeof v === 'object') {
                /* c8 ignore stop */
                Object.assign(out, collectKeys(v, path));
            }
        }
        return out;
    };
    const baseline = collectKeys(dicts[DEFAULT_LOCALE]);
    const baselineKeys = Object.keys(baseline).sort();
    for (const locale of SUPPORTED_LOCALES) {
        if (locale === DEFAULT_LOCALE)
            continue;
        const compared = collectKeys(dicts[locale]);
        const comparedKeys = Object.keys(compared).sort();
        for (const key of baselineKeys) {
            if (!(key in compared)) {
                issues.push(`missing key in ${locale}: ${key}`);
            }
            else if (compared[key] !== baseline[key]) {
                issues.push(`interpolation mismatch in ${locale} at ${key}: expected {${baseline[key]}} got {${compared[key]}}`);
            }
        }
        for (const key of comparedKeys) {
            if (!(key in baseline)) {
                issues.push(`extra key in ${locale}: ${key}`);
            }
        }
    }
    return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
