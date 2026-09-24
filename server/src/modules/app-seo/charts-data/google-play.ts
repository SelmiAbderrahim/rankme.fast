import type { AppChartCatalog } from './types.js';
/**
 * Provenance (checked 2026-08-11): DataForSEO App Data Google `app_list`
 * task docs (`docs.dataforseo.com/v3/app_data-google-app_list-task_post/`)
 * and public Google categories CSV dated 2025-06-25.
 * These are vendor-accepted identifiers, intentionally committed so the
 * product never spends on a live category-discovery request.
 */
export const GOOGLE_PLAY_CHART_CATALOG = {
    store: 'google_play',
    charts: [
        { id: 'topselling_free', nameKey: 'charts.google.topFree' },
        { id: 'topselling_paid', nameKey: 'charts.google.topPaid' },
        { id: 'topselling_new_free', nameKey: 'charts.google.newFree' },
        { id: 'topselling_new_paid', nameKey: 'charts.google.newPaid' },
        { id: 'topgrossing', nameKey: 'charts.google.topGrossing' },
        { id: 'movers_shakers', nameKey: 'charts.google.moversShakers' },
    ],
    categories: [
        { id: 'business', nameKey: 'categories.business' },
        { id: 'education', nameKey: 'categories.education' },
        { id: 'entertainment', nameKey: 'categories.entertainment' },
        { id: 'finance', nameKey: 'categories.finance' },
        { id: 'food_and_drink', nameKey: 'categories.foodDrink' },
        { id: 'game', nameKey: 'categories.games' },
        { id: 'health_and_fitness', nameKey: 'categories.healthFitness' },
        { id: 'lifestyle', nameKey: 'categories.lifestyle' },
        { id: 'productivity', nameKey: 'categories.productivity' },
        { id: 'shopping', nameKey: 'categories.shopping' },
        { id: 'social', nameKey: 'categories.social' },
        { id: 'sports', nameKey: 'categories.sports' },
        { id: 'tools', nameKey: 'categories.tools' },
        { id: 'travel_and_local', nameKey: 'categories.travel' },
    ],
} as const satisfies AppChartCatalog;
