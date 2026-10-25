import { describe, expect, it } from 'vitest';
import { countryFromDomain, inferSiteMarket, parsePageLanguageEvidence } from './site-market.js';

const catalog = [
    { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
    { countryCode: 'SA', locationCode: 2682, languageCodes: ['ar', 'en'] },
    { countryCode: 'DE', locationCode: 2276, languageCodes: ['de', 'en'] },
];

describe('site market inference', () => {
    it('uses a locatable country TLD before page and account language', () => {
        expect(inferSiteMarket({ domain: 'shop.example.sa', catalog, evidence: { htmlLang: 'de-DE', hreflangs: [] }, accountLocale: 'en' }))
            .toMatchObject({ locationCode: 2682, languageCode: 'en', basis: 'cctld' });
    });

    it('uses first-party language evidence before interface language for a generic TLD', () => {
        expect(inferSiteMarket({ domain: 'brand.example.com', catalog, evidence: { htmlLang: 'de-DE', hreflangs: [] }, accountLocale: 'en' }))
            .toMatchObject({ locationCode: 2276, languageCode: 'de', basis: 'page' });
    });

    it('uses a supported account language and marks an unsupported guess', () => {
        expect(inferSiteMarket({ domain: 'brand.example.com', catalog, accountLocale: 'ar' }))
            .toMatchObject({ locationCode: 2682, languageCode: 'ar', basis: 'locale' });
        expect(inferSiteMarket({ domain: 'brand.example.com', catalog: [], accountLocale: 'ar' }))
            .toMatchObject({ locationCode: 2840, languageCode: 'en', basis: 'fallback' });
    });

    it('does not mistake generic country TLDs for an audience country', () => {
        expect(countryFromDomain('brand.ai')).toBeNull();
        expect(countryFromDomain('brand.co.uk')).toBe('GB');
    });

    it('reads only bounded head language metadata', () => {
        expect(parsePageLanguageEvidence('<html lang="ar-SA"><head><link rel="alternate" hreflang="en-SA" href="/"></head>'))
            .toEqual({ htmlLang: 'ar-SA', hreflangs: ['en-SA'] });
        expect(parsePageLanguageEvidence('<body lang="ru"><script>window.lang="ru"</script>'))
            .toEqual({ htmlLang: null, hreflangs: [] });
    });
});
