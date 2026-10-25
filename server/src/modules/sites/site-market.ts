import { ISO_TO_DATAFORSEO_LOCATION } from '../../shared/observations/observations.js';

export const SITE_MARKET_DEVICES = ['desktop', 'mobile'] as const;
export type SiteMarketDevice = (typeof SITE_MARKET_DEVICES)[number];
export const SITE_MARKET_SOURCES = ['inferred', 'owner'] as const;
export type SiteMarketSource = (typeof SITE_MARKET_SOURCES)[number];
export const SITE_MARKET_BASES = ['cctld', 'page', 'locale', 'fallback'] as const;
export type SiteMarketBasis = (typeof SITE_MARKET_BASES)[number];

export interface SiteMarket {
    locationCode: number;
    languageCode: string;
    device: SiteMarketDevice;
}

export interface StoredSiteMarket extends SiteMarket {
    source: SiteMarketSource;
    basis?: SiteMarketBasis | null;
}

export interface CatalogMarket {
    countryCode: string;
    locationCode: number | null;
    languageCodes: readonly string[];
}

export interface PageLanguageEvidence {
    htmlLang: string | null;
    hreflangs: readonly string[];
}

export const FALLBACK_SITE_MARKET: SiteMarket = Object.freeze({
    locationCode: 2840,
    languageCode: 'en',
    device: 'desktop',
});

// Some two-letter domains are used as generic names and provide no audience signal.
const GENERIC_CCTLDS = new Set([
    'ac', 'ai', 'am', 'cc', 'co', 'fm', 'gd', 'gg', 'im', 'io', 'la', 'ly',
    'me', 'nu', 'sh', 'tk', 'to', 'tv', 'vc', 'ws',
]);

const COUNTRY_LANGUAGE: Readonly<Record<string, string>> = Object.freeze({
    AE: 'ar', AR: 'es', AT: 'de', AU: 'en', BE: 'nl', BH: 'ar', BR: 'pt', CA: 'en',
    CH: 'de', CL: 'es', CN: 'zh', CO: 'es', CZ: 'cs', DE: 'de', DK: 'da', DZ: 'ar',
    EG: 'ar', ES: 'es', FI: 'fi', FR: 'fr', GB: 'en', GR: 'el', HK: 'zh', HU: 'hu',
    ID: 'id', IE: 'en', IL: 'he', IN: 'en', IQ: 'ar', IT: 'it', JO: 'ar', JP: 'ja',
    KR: 'ko', KW: 'ar', LB: 'ar', MA: 'ar', MX: 'es', MY: 'ms', NL: 'nl', NO: 'no',
    NZ: 'en', OM: 'ar', PE: 'es', PH: 'en', PK: 'en', PL: 'pl', PT: 'pt', QA: 'ar',
    RO: 'ro', RU: 'ru', SA: 'ar', SE: 'sv', SG: 'en', TH: 'th', TN: 'ar', TR: 'tr',
    TW: 'zh', UA: 'uk', US: 'en', VN: 'vi', ZA: 'en',
});

const LANGUAGE_HOME: Readonly<Record<string, string>> = Object.freeze({
    ar: 'SA', de: 'DE', en: 'US', es: 'ES', fr: 'FR', it: 'IT', ja: 'JP', ko: 'KR',
    nl: 'NL', pl: 'PL', pt: 'BR', ru: 'RU', tr: 'TR', zh: 'TW',
});

export const countryLanguage = (country: string): string | null => COUNTRY_LANGUAGE[country] ?? null;

export function countryFromDomain(domain: string): string | null {
    const tld = domain.toLowerCase().replace(/\.$/u, '').split('.').pop() ?? '';
    if (!/^[a-z]{2}$/.test(tld) || GENERIC_CCTLDS.has(tld)) return null;
    return tld === 'uk' ? 'GB' : tld.toUpperCase();
}

function languageTag(tag: string | null | undefined): { language: string | null; region: string | null } {
    const match = /^([a-z]{2,3})(?:[-_](?:[a-z]{4}[-_])?([a-z]{2}))?\b/i.exec((tag ?? '').trim());
    return {
        language: match?.[1]?.toLowerCase() ?? null,
        region: match?.[2]?.toUpperCase() ?? null,
    };
}

function locatable(catalog: readonly CatalogMarket[]): Map<string, CatalogMarket & { locationCode: number }> {
    const rows = new Map<string, CatalogMarket & { locationCode: number }>();
    for (const row of catalog) {
        if (row.locationCode !== null && row.languageCodes.length > 0 && !rows.has(row.countryCode)) {
            rows.set(row.countryCode, row as CatalogMarket & { locationCode: number });
        }
    }
    return rows;
}

/** Local fallback only; vendor catalog failures must not prevent adding a site. */
export function offlineSiteMarketCatalog(): CatalogMarket[] {
    return Object.entries(ISO_TO_DATAFORSEO_LOCATION)
        .filter(([country]) => COUNTRY_LANGUAGE[country] !== undefined)
        .map(([country, locationCode]) => ({
            countryCode: country,
            locationCode,
            languageCodes: [COUNTRY_LANGUAGE[country]!],
        }));
}

export interface InferSiteMarketInput {
    domain: string;
    catalog: readonly CatalogMarket[];
    evidence?: PageLanguageEvidence | null;
    accountLocale?: string | null;
}

export function inferSiteMarket(input: InferSiteMarketInput): SiteMarket & { basis: SiteMarketBasis } {
    const rows = locatable(input.catalog);
    const page = languageTag(input.evidence?.htmlLang);
    const alternates = (input.evidence?.hreflangs ?? []).map(languageTag);
    const locale = languageTag(input.accountLocale).language;
    const tld = countryFromDomain(input.domain);
    let country: string | null = null;
    let basis: SiteMarketBasis = 'fallback';

    if (tld && rows.has(tld)) {
        country = tld;
        basis = 'cctld';
    } else if (page.region && rows.has(page.region)) {
        country = page.region;
        basis = 'page';
    } else if (page.language && rows.has(LANGUAGE_HOME[page.language] ?? '')) {
        country = LANGUAGE_HOME[page.language]!;
        basis = 'page';
    } else if (locale && rows.has(LANGUAGE_HOME[locale] ?? '')) {
        country = LANGUAGE_HOME[locale]!;
        basis = 'locale';
    }

    const row = country ? rows.get(country) : undefined;
    if (!row) return { ...FALLBACK_SITE_MARKET, basis: 'fallback' };
    const offered = new Set(row.languageCodes);
    const regional = alternates.find((item) => item.region === row.countryCode && item.language && offered.has(item.language));
    const any = alternates.find((item) => item.language && offered.has(item.language));
    const languageCode = [page.language, regional?.language, any?.language, locale, countryLanguage(row.countryCode)]
        .find((candidate): candidate is string => !!candidate && offered.has(candidate)) ?? row.languageCodes[0]!;
    return { locationCode: row.locationCode, languageCode, device: 'desktop', basis };
}

export function isCatalogSiteMarket(market: SiteMarket, catalog: readonly CatalogMarket[]): boolean {
    return SITE_MARKET_DEVICES.includes(market.device) && catalog.some((row) =>
        row.locationCode === market.locationCode && row.languageCodes.includes(market.languageCode));
}

/** Parse language tags from a bounded document head without executing markup. */
export function parsePageLanguageEvidence(html: string): PageLanguageEvidence {
    const head = html.slice(0, 256 * 1024).split(/<\/head\s*>/i, 1)[0] ?? '';
    const htmlTag = /<html\b[^>]*>/i.exec(head)?.[0] ?? '';
    const htmlLang = /\blang\s*=\s*["']?([a-z]{2,3}(?:[-_][a-z0-9]{2,8})*)/i.exec(htmlTag)?.[1] ?? null;
    const hreflangs: string[] = [];
    for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
        if (!/\brel\s*=\s*["']?alternate/i.test(tag)) continue;
        const value = /\bhreflang\s*=\s*["']?([a-z]{2,3}(?:[-_][a-z0-9]{2,8})*)/i.exec(tag)?.[1];
        if (value && hreflangs.length < 50) hreflangs.push(value);
    }
    return { htmlLang, hreflangs };
}
