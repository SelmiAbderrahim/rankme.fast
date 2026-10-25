import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { gscSearchAnalytics } from '../../db/schema/gsc.js';
import { ISO_TO_DATAFORSEO_LOCATION } from '../../shared/observations/observations.js';
import { countryFromAlpha3 } from './country-alpha3.js';
import {
    FALLBACK_SITE_MARKET,
    countryFromDomain,
    countryLanguage,
    type CatalogMarket,
    type SiteMarket,
    type StoredSiteMarket,
} from './site-market.js';

export const RESOLVED_SITE_MARKET_SOURCES = [
    'owner', 'search_console', 'cctld', 'site_language', 'assumed',
] as const;
export type ResolvedSiteMarketSource = (typeof RESOLVED_SITE_MARKET_SOURCES)[number];
export interface ResolvedSiteMarket extends SiteMarket {
    source: ResolvedSiteMarketSource;
    countryCode: string | null;
}

export interface ResolvableSite {
    domain: string;
    defaultMarket?: StoredSiteMarket | null;
}

export interface GscMarketSignal {
    countryCode: string;
    queryLanguage: string | null;
}

const COUNTRY_BY_LOCATION = new Map<number, string>(
    Object.entries(ISO_TO_DATAFORSEO_LOCATION).map(([country, code]) => [code, country]),
);
export const countryForLocation = (code: number): string | null => COUNTRY_BY_LOCATION.get(code) ?? null;

function rowForCountry(catalog: readonly CatalogMarket[], country: string) {
    return catalog.find((row) => row.countryCode === country && row.locationCode !== null && row.languageCodes.length > 0) ?? null;
}

function languageForRow(row: CatalogMarket, candidates: ReadonlyArray<string | null | undefined>): string {
    return [...candidates, countryLanguage(row.countryCode)].find((item): item is string =>
        !!item && row.languageCodes.includes(item)) ?? row.languageCodes[0]!;
}

function resolved(market: SiteMarket, source: ResolvedSiteMarketSource): ResolvedSiteMarket {
    return {
        locationCode: market.locationCode,
        languageCode: market.languageCode.toLowerCase(),
        device: market.device,
        source,
        countryCode: countryForLocation(market.locationCode),
    };
}

/** Resolve a default from stored inputs only; reading never changes a site. */
export function resolveSiteMarketFrom(input: {
    site: ResolvableSite;
    catalog: readonly CatalogMarket[];
    gsc?: GscMarketSignal | null;
}): ResolvedSiteMarket {
    const stored = input.site.defaultMarket ?? null;
    const device = stored?.device ?? FALLBACK_SITE_MARKET.device;
    if (stored?.source === 'owner') return resolved(stored, 'owner');

    if (input.gsc) {
        const row = rowForCountry(input.catalog, input.gsc.countryCode);
        if (row?.locationCode !== null && row?.locationCode !== undefined) {
            return resolved({ locationCode: row.locationCode, languageCode: languageForRow(row, [input.gsc.queryLanguage]), device }, 'search_console');
        }
    }

    const tldCountry = countryFromDomain(input.site.domain);
    const tldRow = tldCountry ? rowForCountry(input.catalog, tldCountry) : null;
    if (tldRow?.locationCode !== null && tldRow?.locationCode !== undefined) {
        const sameCountryLanguage = stored?.locationCode === tldRow.locationCode ? stored.languageCode : null;
        return resolved({ locationCode: tldRow.locationCode, languageCode: languageForRow(tldRow, [sameCountryLanguage]), device }, 'cctld');
    }

    if (stored && (stored.basis === 'page' || (!stored.basis &&
        (stored.locationCode !== FALLBACK_SITE_MARKET.locationCode ||
            stored.languageCode.toLowerCase() !== FALLBACK_SITE_MARKET.languageCode)))) {
        return resolved(stored, 'site_language');
    }
    return resolved(stored ?? FALLBACK_SITE_MARKET, 'assumed');
}

type KeywordScript = 'arabic' | 'cyrillic' | 'han' | 'kana' | 'hangul' | 'latin' | 'other';
const SCRIPTS: ReadonlyArray<[KeywordScript, RegExp]> = [
    ['arabic', /\p{Script=Arabic}/gu],
    ['cyrillic', /\p{Script=Cyrillic}/gu],
    ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
    ['hangul', /\p{Script=Hangul}/gu],
    ['han', /\p{Script=Han}/gu],
    ['latin', /\p{Script=Latin}/gu],
];
const LATIN_LANGUAGES = new Set([
    'cs', 'da', 'de', 'en', 'es', 'fi', 'fr', 'hu', 'id', 'it', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'sv', 'tr', 'vi',
]);

export function dominantMarketScript(value: string): KeywordScript {
    let best: KeywordScript = 'other';
    let count = 0;
    for (const [script, pattern] of SCRIPTS) {
        const current = value.match(pattern)?.length ?? 0;
        if (current > count) {
            best = script;
            count = current;
        }
    }
    return best;
}

function languageForScript(script: KeywordScript, country: string): string | null {
    switch (script) {
        case 'arabic': return 'ar';
        case 'cyrillic': return country === 'UA' ? 'uk' : 'ru';
        case 'kana': return 'ja';
        case 'hangul': return 'ko';
        case 'han': return 'zh';
        case 'latin': {
            const main = countryLanguage(country);
            return main && LATIN_LANGUAGES.has(main) ? main : 'en';
        }
        default: return null;
    }
}

export const GSC_MARKET_WINDOWS = [28, 90] as const;
const SAMPLE_ROWS = 100;

export interface GscSignalSite {
    accountId: string;
    siteId: string;
    gscPropertyUrl: string | null;
    gscBindingGenerationId: string | null;
}

async function latestRows(db: Pick<Db, 'select'>, site: GscSignalSite, generation: string, dimension: string, days: number) {
    const scope = and(
        eq(gscSearchAnalytics.accountId, site.accountId),
        eq(gscSearchAnalytics.siteId, site.siteId),
        eq(gscSearchAnalytics.bindingGenerationId, generation),
        eq(gscSearchAnalytics.dimensionSet, dimension),
        eq(gscSearchAnalytics.windowDays, days),
    );
    const latest = await db.select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics).where(scope).orderBy(desc(gscSearchAnalytics.snapshotDate)).limit(1);
    if (!latest[0]) return [];
    return db.select({ dimensionKey: gscSearchAnalytics.dimensionKey, impressions: gscSearchAnalytics.impressions })
        .from(gscSearchAnalytics)
        .where(and(scope, eq(gscSearchAnalytics.snapshotDate, latest[0].snapshotDate)))
        .orderBy(desc(gscSearchAnalytics.impressions), gscSearchAnalytics.dimensionKey)
        .limit(SAMPLE_ROWS);
}

/** Find an audience signal in the site's current stored Search Console snapshot. */
export async function readGscMarketSignal(db: Pick<Db, 'select'>, site: GscSignalSite): Promise<GscMarketSignal | null> {
    if (!site.gscPropertyUrl) return null;
    const generation = site.gscBindingGenerationId ?? 'legacy';
    for (const days of GSC_MARKET_WINDOWS) {
        const countries = await latestRows(db, site, generation, 'country', days);
        const top = countries.find((row) => row.impressions > 0 && countryFromAlpha3(row.dimensionKey));
        if (!top) continue;
        const countryCode = countryFromAlpha3(top.dimensionKey)!;
        const queries = await latestRows(db, site, generation, 'query', days);
        const weights = new Map<KeywordScript, number>();
        for (const row of queries) {
            const script = dominantMarketScript(row.dimensionKey);
            weights.set(script, (weights.get(script) ?? 0) + row.impressions);
        }
        let best: KeywordScript = 'other';
        let bestWeight = 0;
        for (const [script, weight] of weights) {
            if (script !== 'other' && weight > bestWeight) {
                best = script;
                bestWeight = weight;
            }
        }
        return { countryCode, queryLanguage: languageForScript(best, countryCode) };
    }
    return null;
}
