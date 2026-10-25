import { Types } from 'mongoose';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ProviderMarket } from '../../shared/providers/index.js';
import { getMarketCatalog, getMarketCatalogDeps } from '../market-catalog/index.js';
import { Site, countryForLocation, countryLanguage, resolveSiteMarket } from '../sites/index.js';

export interface KeywordMarketInput {
    accountId: string;
    siteId: string;
    engine: string;
    locationCode?: number;
    languageCode?: string;
    device?: 'desktop' | 'mobile';
}

export interface KeywordMarketChoice {
    locationCode: number;
    languageCode: string;
    device: 'desktop' | 'mobile';
}

async function serpCatalog(): Promise<ProviderMarket[] | null> {
    try {
        return (await getMarketCatalog('serp', getMarketCatalogDeps())).markets;
    }
    catch {
        return null;
    }
}

async function countryDefaultLanguage(code: number, siteLanguage: string): Promise<string> {
    const row = (await serpCatalog())?.find((entry) => entry.locationCode === code);
    const primary = countryLanguage(countryForLocation(code) ?? '');
    if (!row) return primary ?? siteLanguage;
    return row.languageCodes.find((language) => language === primary) ?? row.languageCodes[0]!;
}

const siteNotFound = () => HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });

/** Apply a site's resolved default only to market fields the caller omitted. */
export async function resolveKeywordMarket(input: KeywordMarketInput): Promise<KeywordMarketChoice> {
    if (!Types.ObjectId.isValid(input.siteId)) throw siteNotFound();
    const site = await Site.findOne({ _id: input.siteId, accountId: input.accountId, deletionStartedAt: null })
        .select('_id accountId domain defaultMarket gscPropertyUrl gscBindingGenerationId');
    if (!site) throw siteNotFound();

    let { locationCode, languageCode, device } = input;
    if (locationCode === undefined || languageCode === undefined || device === undefined) {
        const market = await resolveSiteMarket(site);
        device ??= market.device;
        if (locationCode === undefined) {
            locationCode = market.locationCode;
            languageCode ??= market.languageCode;
        }
        if (languageCode === undefined) {
            languageCode = locationCode === market.locationCode
                ? market.languageCode
                : await countryDefaultLanguage(locationCode, market.languageCode);
        }
    }

    languageCode = languageCode.toLowerCase();
    if (input.engine === 'google' || input.engine === 'bing') {
        const row = (await serpCatalog())?.find((entry) => entry.locationCode === locationCode);
        if (row && !row.languageCodes.includes(languageCode)) {
            throw HttpError.badRequest({
                code: 'RANKS_ERRORS_MARKET_UNSUPPORTED',
                messageKey: 'ranks.errors.marketUnsupported',
            });
        }
    }
    return { locationCode, languageCode, device };
}
