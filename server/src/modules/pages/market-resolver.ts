import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keywords } from '../../db/schema/keywords.js';
export const DEFAULT_PAGES_MARKET = Object.freeze({
    locationCode: 2840,
    languageCode: 'en',
    selection: 'default' as const,
});
export interface PagesFallbackMarket {
    locationCode: number;
    languageCode: string;
    selection: 'site_default' | 'tracked_keyword_mode' | 'default';
}
/** The site's stored default market; only location and language matter here. */
export interface PagesSiteMarket {
    locationCode: number;
    languageCode: string;
}
/**
 * The site's own default market wins. Without one, selects the mode of active Google tracked-keyword markets, with stable
 * numeric-location then language tie-breakers. Both tenant keys are mandatory
 * inputs and predicates; alt-engine and inactive rows cannot influence it.
 */
export async function resolvePagesFallbackMarket(db: Db, accountId: string, siteId: string, siteMarket?: PagesSiteMarket | null): Promise<PagesFallbackMarket> {
    if (siteMarket) {
        return {
            locationCode: siteMarket.locationCode,
            languageCode: siteMarket.languageCode.toLowerCase(),
            selection: 'site_default',
        };
    }
    const rows = await db
        .select({
        locationCode: keywords.locationCode,
        languageCode: keywords.languageCode,
        frequency: count(),
    })
        .from(keywords)
        .where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), eq(keywords.active, true), eq(keywords.engine, 'google')))
        .groupBy(keywords.locationCode, keywords.languageCode)
        .orderBy(desc(count()), asc(keywords.locationCode), asc(keywords.languageCode))
        .limit(1);
    const selected = rows[0];
    if (!selected)
        return { ...DEFAULT_PAGES_MARKET };
    return {
        locationCode: selected.locationCode,
        languageCode: selected.languageCode.toLowerCase(),
        selection: 'tracked_keyword_mode',
    };
}
