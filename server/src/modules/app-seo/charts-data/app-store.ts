import type { AppChartCatalog } from './types.js';
/**
 * Provenance (checked 2026-08-11): DataForSEO App Data Apple `app_list`
 * task docs (`docs.dataforseo.com/v3/app_data-apple-app_list-task_post/`)
 * and public Apple categories CSV dated 2025-06-25.
 * The identifiers are reviewed code; no runtime categories endpoint exists.
 */
export const APP_STORE_CHART_CATALOG = {
    store: 'app_store',
    charts: [
        { id: 'top_free_ios', nameKey: 'charts.apple.topFree' },
        { id: 'top_paid_ios', nameKey: 'charts.apple.topPaid' },
        { id: 'top_grossing_ios', nameKey: 'charts.apple.topGrossing' },
        { id: 'new_ios', nameKey: 'charts.apple.new' },
        { id: 'new_free_ios', nameKey: 'charts.apple.newFree' },
        { id: 'new_paid_ios', nameKey: 'charts.apple.newPaid' },
    ],
    categories: [
        { id: 'business', nameKey: 'categories.business' },
        { id: 'education', nameKey: 'categories.education' },
        { id: 'entertainment', nameKey: 'categories.entertainment' },
        { id: 'finance', nameKey: 'categories.finance' },
        { id: 'food_and_drink', nameKey: 'categories.foodDrink' },
        { id: 'games', nameKey: 'categories.games' },
        { id: 'health_and_fitness', nameKey: 'categories.healthFitness' },
        { id: 'lifestyle', nameKey: 'categories.lifestyle' },
        { id: 'productivity', nameKey: 'categories.productivity' },
        { id: 'shopping', nameKey: 'categories.shopping' },
        { id: 'social_networking', nameKey: 'categories.social' },
        { id: 'sports', nameKey: 'categories.sports' },
        { id: 'travel', nameKey: 'categories.travel' },
        { id: 'utilities', nameKey: 'categories.utilities' },
    ],
} as const satisfies AppChartCatalog;
