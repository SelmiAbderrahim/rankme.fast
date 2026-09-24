import type { AppStoreKind } from '../../../shared/providers/app-data.js';
export interface AppChartCatalogEntry {
    id: string;
    nameKey: string;
}
export interface AppChartCatalog {
    store: AppStoreKind;
    charts: readonly AppChartCatalogEntry[];
    categories: readonly AppChartCatalogEntry[];
}
