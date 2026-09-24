/**
 * Deterministic normalized-input hash for audience research idempotency.
 * Two calls with the same account/site/normalized-input/
 * template-version MUST produce the same sha256 hex; any change (topic set,
 * competitor set, SiteMarket, template version) MUST produce a different hex.
 */
import { createHash } from 'node:crypto';
import type { SiteMarket } from '../../shared/observations/types.js';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
export interface DeterministicInputHashInput {
    accountId: string;
    siteId: string;
    siteMarket: SiteMarket;
    competitorDomains: readonly string[];
    seedTopics: readonly string[];
    queryTemplateVersion: number;
}
function normalizeString(v: string): string {
    return v.trim().toLowerCase();
}
function normalizeSiteMarket(m: SiteMarket): string {
    const entries: Array<[
        string,
        string
    ]> = [
        ['country', normalizeString(m.country)],
        ['region', m.region === null ? '' : normalizeString(m.region)],
        ['city', m.city === null ? '' : normalizeString(m.city)],
        ['language', normalizeString(m.language)],
        ['device', normalizeString(m.device)],
    ];
    return entries
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`)
        .join('|');
}
export function computeDeterministicInputHash(input: DeterministicInputHashInput): string {
    const seeds = [...input.seedTopics].map(normalizeString).sort();
    const competitors = [...input.competitorDomains].map(normalizeString).sort();
    const payload = [
        `account=${input.accountId}`,
        `site=${input.siteId}`,
        `siteMarket=${normalizeSiteMarket(input.siteMarket)}`,
        `seedTopics=${seeds.join(',')}`,
        `competitorDomains=${competitors.join(',')}`,
        `templateVersion=${input.queryTemplateVersion}`,
    ].join('\n');
    return createHash('sha256').update(payload).digest('hex');
}
/**
 * Locale-aware v2 identity. V1 stays exported for the English legacy probe;
 * every newly-created run uses this versioned shape.
 */
export function computeDeterministicInputHashV2(input: DeterministicInputHashInput & {
    outputLocale: SupportedLocale;
}): string {
    const v1 = computeDeterministicInputHash(input);
    const payload = [
        'identityVersion=2',
        `legacyInputHash=${v1}`,
        `outputLocale=${input.outputLocale}`,
    ].join('\n');
    return createHash('sha256').update(payload).digest('hex');
}
