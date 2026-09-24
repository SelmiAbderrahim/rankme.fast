import { logger } from '../../config/logger.js';
import { createReadThrough, createSingleFlight, createVendorCacheRepo, } from '../../shared/vendor-cache/index.js';
import type { ProviderMarket } from '../../shared/providers/index.js';
import { VendorUnavailableError } from '../../shared/providers/errors.js';
import type { VendorCapability } from '../../db/schema/index.js';
import { marketCatalogPayloadSchema, type MarketCatalogSurface, } from './market-catalog.schemas.js';
import type { MarketCatalogDeps } from './market-catalog.holder.js';
export const MARKET_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const catalogFlights = createSingleFlight();
function catalogAddress(surface: MarketCatalogSurface): {
    capability: VendorCapability;
    operation: string;
} {
    if (surface === 'seo')
        return { capability: 'keyword', operation: 'market-catalog' };
    if (surface === 'brand-radar') {
        return { capability: 'content-analysis', operation: 'market-catalog' };
    }
    return { capability: 'app-data', operation: `${surface}-market-catalog` };
}
function requireCatalogMethod<T extends (...args: never[]) => Promise<ProviderMarket[]>>(method: T | undefined, operation: string): T {
    if (method)
        return method;
    throw new VendorUnavailableError('configured provider does not expose a market catalog', {
        provider: 'configured',
        operation,
    });
}
function normalizeMarkets(markets: ProviderMarket[]): ProviderMarket[] {
    const normalized = new Map<string, ProviderMarket>();
    for (const market of marketCatalogPayloadSchema.parse(markets)) {
        const languageCodes = [...new Set(market.languageCodes)].sort();
        normalized.set(`${market.countryCode}:${market.locationCode ?? 'all'}`, {
            ...market,
            languageCodes,
        });
    }
    return [...normalized.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode) ||
        (a.locationCode ?? 0) - (b.locationCode ?? 0));
}
async function fetchMarkets(surface: MarketCatalogSurface, deps: MarketCatalogDeps): Promise<ProviderMarket[]> {
    if (surface === 'seo') {
        return normalizeMarkets(await requireCatalogMethod(deps.keywordProvider.listMarkets, 'keyword-market-catalog')());
    }
    if (surface === 'brand-radar') {
        return normalizeMarkets(await requireCatalogMethod(deps.contentAnalysisProvider.listMarkets, 'content-analysis-market-catalog')());
    }
    const store = surface === 'app-google-play' ? 'google_play' : 'app_store';
    const listMarkets = deps.appDataProvider.listMarkets;
    if (!listMarkets) {
        throw new VendorUnavailableError('configured provider does not expose a market catalog', {
            provider: 'configured',
            operation: `${surface}-market-catalog`,
        });
    }
    return normalizeMarkets(await listMarkets(store));
}
export async function getMarketCatalog(surface: MarketCatalogSurface, deps: MarketCatalogDeps) {
    const address = catalogAddress(surface);
    const readThrough = createReadThrough({
        repo: createVendorCacheRepo(deps.db),
        singleFlight: catalogFlights,
        // Without a logger a swallowed archive failure is completely silent — that
        // is how an unmapped capability stopped custom-plan sales unnoticed.
        logger,
    });
    const result = await readThrough({
        ...address,
        params: { surface },
        payloadSchema: marketCatalogPayloadSchema,
        ttlMs: MARKET_CATALOG_TTL_MS,
        now: (deps.now ?? (() => new Date()))(),
        ...(deps.now ? { clock: deps.now } : {}),
        fetch: () => fetchMarkets(surface, deps),
    });
    return {
        surface,
        markets: result.value,
        fetchedAt: result.fetchedAt.toISOString(),
        cached: result.cached,
    };
}
