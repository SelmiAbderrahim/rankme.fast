import type { Db } from '../../db/client.js';
import type { ContentAnalysisProvider, KeywordProvider, } from '../../shared/providers/index.js';
import type { AppDataProvider } from '../../shared/providers/app-data.js';
export interface MarketCatalogDeps {
    db: Db;
    keywordProvider: KeywordProvider;
    contentAnalysisProvider: ContentAnalysisProvider;
    appDataProvider: AppDataProvider;
    now?: () => Date;
}
let currentDeps: MarketCatalogDeps | null = null;
export function setMarketCatalogDeps(deps: MarketCatalogDeps | null): void {
    currentDeps = deps;
}
export function getMarketCatalogDeps(): MarketCatalogDeps {
    if (currentDeps)
        return currentDeps;
    throw new Error('market catalog not configured; call setMarketCatalogDeps() at boot');
}
