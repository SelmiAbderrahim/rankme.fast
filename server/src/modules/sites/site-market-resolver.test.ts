import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gscSearchAnalytics } from '../../db/schema/gsc.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { countryFromAlpha3 } from './country-alpha3.js';
import { countryForLocation, dominantMarketScript, readGscMarketSignal, resolveSiteMarketFrom } from './site-market-resolver.js';

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

    it('resolves a country TLD with a compatible stored language and device', () => {
        expect(resolveSiteMarketFrom({ site: { domain: 'brand.de', defaultMarket: {
            locationCode: 2276, languageCode: 'en', device: 'mobile', source: 'inferred', basis: 'cctld',
        } }, catalog })).toMatchObject({ source: 'cctld', languageCode: 'en', device: 'mobile' });
    });

    it('uses site language when a generic TLD and stored page evidence have no search audience', () => {
        expect(resolveSiteMarketFrom({ site: { domain: 'brand.com', defaultMarket: {
            locationCode: 2276, languageCode: 'de', device: 'desktop', source: 'inferred', basis: 'page',
        } }, catalog })).toMatchObject({ source: 'site_language', countryCode: 'DE' });
        expect(resolveSiteMarketFrom({ site: { domain: 'brand.com', defaultMarket: null }, catalog: [] }))
            .toMatchObject({ source: 'assumed', locationCode: 2840 });
    });

    it('ignores unavailable catalog countries and chooses a supported country language', () => {
        expect(resolveSiteMarketFrom({ site: { domain: 'brand.sa' }, catalog,
            gsc: { countryCode: 'FR', queryLanguage: 'fr' } }))
            .toMatchObject({ source: 'cctld', languageCode: 'ar' });
        expect(resolveSiteMarketFrom({ site: { domain: 'brand.com' }, catalog,
            gsc: { countryCode: 'SA', queryLanguage: 'zz' } }))
            .toMatchObject({ source: 'search_console', languageCode: 'ar' });
        expect(countryForLocation(-1)).toBeNull();
    });

    it('uses the catalog first language when neither query nor national language is offered', () => {
        expect(resolveSiteMarketFrom({ site: { domain: 'brand.com' },
            catalog: [{ countryCode: 'SA', locationCode: 2682, languageCodes: ['fr'] }],
            gsc: { countryCode: 'SA', queryLanguage: 'zz' } }))
            .toMatchObject({ source: 'search_console', languageCode: 'fr' });
    });
});

describe('stored Search Console market signal', () => {
    const site = { accountId: 'market-account', siteId: 'market-site',
        gscPropertyUrl: 'sc-domain:example.com', gscBindingGenerationId: 'current' };
    const row = (dimensionSet: string, dimensionKey: string, impressions: number, options: {
        windowDays?: number; snapshotDate?: string; bindingGenerationId?: string,
    } = {}) => ({ accountId: site.accountId, siteId: site.siteId,
        bindingGenerationId: options.bindingGenerationId ?? 'current',
        snapshotDate: options.snapshotDate ?? '2026-10-20', dimensionSet,
        windowDays: options.windowDays ?? 28, dimensionKey, clicks: 0,
        impressions, ctr: 0, position: 0 });

    beforeAll(startTestPostgres);
    afterAll(stopTestPostgres);
    beforeEach(truncateAllTables);

    it('requires a stored property and recognized positive country impressions', async () => {
        expect(await readGscMarketSignal(getTestDb(), { ...site, gscPropertyUrl: null })).toBeNull();
        expect(await readGscMarketSignal(getTestDb(), site)).toBeNull();
        await getTestDb().insert(gscSearchAnalytics).values([
            row('country', 'DEU', 0), row('country', 'BAD', 20),
        ]);
        expect(await readGscMarketSignal(getTestDb(), site)).toBeNull();
    });

    it('uses the latest current generation and the highest weighted query script', async () => {
        await getTestDb().insert(gscSearchAnalytics).values([
            row('country', 'SAU', 100), row('country', 'DEU', 300, { snapshotDate: '2026-10-19' }),
            row('country', 'DEU', 999, { bindingGenerationId: 'old' }),
            row('query', 'hello', 20), row('query', 'مرحبا', 40), row('query', 'العربية', 30),
        ]);
        expect(await readGscMarketSignal(getTestDb(), site)).toEqual({ countryCode: 'SA', queryLanguage: 'ar' });
    });

    it('falls back to the 90-day window and maps Cyrillic by country', async () => {
        await getTestDb().insert(gscSearchAnalytics).values([
            row('country', 'UKR', 8, { windowDays: 90 }),
            row('query', 'привіт', 5, { windowDays: 90 }),
        ]);
        expect(await readGscMarketSignal(getTestDb(), site)).toEqual({ countryCode: 'UA', queryLanguage: 'uk' });
    });

    it('returns null language when there is no recognized query script', async () => {
        await getTestDb().insert(gscSearchAnalytics).values([
            row('country', 'USA', 8), row('query', '1234', 5),
        ]);
        expect(await readGscMarketSignal(getTestDb(), site)).toEqual({ countryCode: 'US', queryLanguage: null });
    });

    it('reads legacy binding snapshots when a generation id was never stored', async () => {
        await getTestDb().insert(gscSearchAnalytics).values([
            row('country', 'DEU', 8, { bindingGenerationId: 'legacy' }),
            row('query', 'hallo', 5, { bindingGenerationId: 'legacy' }),
        ]);
        expect(await readGscMarketSignal(getTestDb(), { ...site, gscBindingGenerationId: null }))
            .toEqual({ countryCode: 'DE', queryLanguage: 'de' });
    });

    it('maps Japanese, Korean, Chinese, and Latin queries to their audience languages', async () => {
        for (const [country, phrase, expected] of [
            ['JPN', 'かな', 'ja'], ['KOR', '한글', 'ko'], ['CHN', '漢字', 'zh'],
            ['DEU', 'hallo', 'de'], ['RUS', 'привет', 'ru'], ['JPN', 'hello', 'en'],
        ]) {
            await truncateAllTables();
            await getTestDb().insert(gscSearchAnalytics).values([
                row('country', country!, 10), row('query', phrase!, 5),
            ]);
            expect((await readGscMarketSignal(getTestDb(), site))?.queryLanguage).toBe(expected);
        }
    });

    it('recognizes the stored country and each supported writing system', () => {
        expect(countryFromAlpha3(' deu ')).toBe('DE');
        expect(countryFromAlpha3('INVALID')).toBeNull();
        expect([dominantMarketScript('مرحبا'), dominantMarketScript('привет'),
            dominantMarketScript('漢字'), dominantMarketScript('かな'),
            dominantMarketScript('한글'), dominantMarketScript('hello'),
            dominantMarketScript('123')]).toEqual([
            'arabic', 'cyrillic', 'han', 'kana', 'hangul', 'latin', 'other',
        ]);
    });
});
