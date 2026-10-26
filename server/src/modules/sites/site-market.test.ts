import { describe, expect, it } from 'vitest';
import { countryFromDomain, countryLanguage, inferSiteMarket, isCatalogSiteMarket, parsePageLanguageEvidence } from './site-market.js';

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
        expect(countryFromDomain('brand.COM.')).toBeNull();
        expect(countryFromDomain('BRAND.DE.')).toBe('DE');
        expect(countryFromDomain('')).toBeNull();
    });

    it('uses a supported page language or regional alternate when the TLD is generic', () => {
        const multilingual = [
            { countryCode: 'DE', locationCode: 2276, languageCodes: ['en', 'de'] },
            { countryCode: 'US', locationCode: 2840, languageCodes: ['en'] },
        ];
        expect(inferSiteMarket({ domain: 'brand.com', catalog: multilingual,
            evidence: { htmlLang: 'de', hreflangs: [] } }))
            .toMatchObject({ locationCode: 2276, languageCode: 'de', basis: 'page' });
        expect(inferSiteMarket({ domain: 'brand.de', catalog: multilingual,
            evidence: { htmlLang: 'fr', hreflangs: ['en-DE'] } }))
            .toMatchObject({ locationCode: 2276, languageCode: 'en', basis: 'cctld' });
    });

    it('ignores unusable catalog rows and validates complete markets', () => {
        const rows = [{ countryCode: 'DE', locationCode: null, languageCodes: ['de'] },
            { countryCode: 'DE', locationCode: 2276, languageCodes: [] }, ...catalog];
        expect(inferSiteMarket({ domain: 'brand.de', catalog: rows })).toMatchObject({
            locationCode: 2276, languageCode: 'de', basis: 'cctld',
        });
        expect(isCatalogSiteMarket({ locationCode: 2276, languageCode: 'de', device: 'desktop' }, rows)).toBe(true);
        expect(isCatalogSiteMarket({ locationCode: 2276, languageCode: 'zz', device: 'desktop' }, rows)).toBe(false);
    });

    it('falls back from unsupported page and account locales to the TLD catalog language', () => {
        expect(countryLanguage('XX')).toBeNull();
        expect(inferSiteMarket({ domain: 'brand.de',
            catalog: [{ countryCode: 'DE', locationCode: 2276, languageCodes: ['fr'] }],
            evidence: { htmlLang: 'zz-ZZ', hreflangs: ['zz-ZZ'] }, accountLocale: 'zz' }))
            .toMatchObject({ locationCode: 2276, languageCode: 'fr', basis: 'cctld' });
        expect(inferSiteMarket({ domain: 'brand.com', catalog,
            evidence: { htmlLang: 'zz', hreflangs: [] }, accountLocale: 'zz' }))
            .toMatchObject({ basis: 'fallback' });
    });

    it('reads only bounded head language metadata', () => {
        expect(parsePageLanguageEvidence('<html lang="ar-SA"><head><link rel="alternate" hreflang="en-SA" href="/"></head>'))
            .toEqual({ htmlLang: 'ar-SA', hreflangs: ['en-SA'] });
        expect(parsePageLanguageEvidence('<body lang="ru"><script>window.lang="ru"</script>'))
            .toEqual({ htmlLang: null, hreflangs: [] });
        expect(parsePageLanguageEvidence('')).toEqual({ htmlLang: null, hreflangs: [] });
    });

    it('does not read body metadata or links without an alternate relation', () => {
        expect(parsePageLanguageEvidence('<head><link rel="canonical" hreflang="de-DE"></head><html lang="de-DE">'))
            .toEqual({ htmlLang: null, hreflangs: [] });
    });
});
