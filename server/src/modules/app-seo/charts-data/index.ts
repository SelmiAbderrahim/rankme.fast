import type { AppStoreKind } from '../../../shared/providers/app-data.js';
import { APP_STORE_CHART_CATALOG } from './app-store.js';
import { GOOGLE_PLAY_CHART_CATALOG } from './google-play.js';
import type { AppChartCatalog } from './types.js';
export const APP_CHART_CATALOGS: Record<AppStoreKind, AppChartCatalog> = {
    google_play: GOOGLE_PLAY_CHART_CATALOG,
    app_store: APP_STORE_CHART_CATALOG,
};
export function isSupportedAppChartSelection(store: AppStoreKind, chartId: string, categoryId: string): boolean {
    const catalog = APP_CHART_CATALOGS[store];
    return catalog.charts.some((chart) => chart.id === chartId) &&
        catalog.categories.some((category) => category.id === categoryId);
}
export { APP_STORE_CHART_CATALOG } from './app-store.js';
export { GOOGLE_PLAY_CHART_CATALOG } from './google-play.js';
export type { AppChartCatalog, AppChartCatalogEntry } from './types.js';
