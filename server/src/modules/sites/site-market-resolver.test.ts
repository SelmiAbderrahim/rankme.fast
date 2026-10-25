import { describe, expect, it } from 'vitest';
import { resolveSiteMarketFrom } from './site-market-resolver.js';

const catalog = [
    { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
    { countryCode: 'SA', locationCode: 2682, languageCodes: ['ar', 'en'] },
    { countryCode: 'DE', locationCode: 2276, languageCodes: ['de', 'en'] },
];

describe('resolved site market', () => {
    it('keeps an explicit owner choice ahead of stored search data', () => {
        expect(resolveSiteMarketFrom({
            site: { domain: 'brand.sa', defaultMarket: { locationCode: 2840, languageCode: 'ES', device: 'mobile', source: 'owner' } },
            catalog,
            gsc: { countryCode: 'DE', queryLanguage: 'de' },
        })).toEqual({ locationCode: 2840, languageCode: 'es', device: 'mobile', source: 'owner', countryCode: 'US' });
    });

    it('uses stored search audience before the country TLD', () => {
        expect(resolveSiteMarketFrom({
            site: { domain: 'brand.sa', defaultMarket: null }, catalog,
            gsc: { countryCode: 'DE', queryLanguage: 'de' },
        })).toMatchObject({ locationCode: 2276, languageCode: 'de', source: 'search_console' });
    });

    it('marks a plain legacy fallback as assumed', () => {
        expect(resolveSiteMarketFrom({
            site: { domain: 'brand.com', defaultMarket: { locationCode: 2840, languageCode: 'en', device: 'desktop', source: 'inferred' } },
            catalog,
        })).toMatchObject({ source: 'assumed', countryCode: 'US' });
    });
});
