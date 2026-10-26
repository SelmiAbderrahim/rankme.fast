const DAY_MS = 86_400_000;
export const AUDIT_FRESH_DAYS = 30;
export const SEARCH_CONSOLE_EXPECTED_LAG_DAYS = 3;
export const SEARCH_CONSOLE_GRACE_DAYS = 2;
export const SEARCH_CONSOLE_FRESH_DAYS = SEARCH_CONSOLE_EXPECTED_LAG_DAYS + SEARCH_CONSOLE_GRACE_DAYS;
export const RANK_CHECK_FRESH_DAYS = { weekly: 9, daily: 3 } as const;
/** Manually retained backlink observations are never stale solely because of age. */
export const BACKLINKS_FRESH_DAYS: number | null = null;
export type RankCheckCadence = keyof typeof RANK_CHECK_FRESH_DAYS;
export type FreshnessSource = 'audit' | 'search_console' | 'rank_checks' | 'backlinks';
export type FreshnessState = 'value' | 'stale';
export interface FreshnessOptions {
    cadence?: RankCheckCadence;
}

export function freshDaysFor(source: FreshnessSource, options: FreshnessOptions = {}): number | null {
    switch (source) {
        case 'audit': return AUDIT_FRESH_DAYS;
        case 'search_console': return SEARCH_CONSOLE_FRESH_DAYS;
        case 'rank_checks': return RANK_CHECK_FRESH_DAYS[options.cadence ?? 'weekly'];
        case 'backlinks': return BACKLINKS_FRESH_DAYS;
    }
}

export function freshUntilFor(source: FreshnessSource, asOf: Date, options: FreshnessOptions = {}): Date | null {
    const days = freshDaysFor(source, options);
    return days === null ? null : new Date(asOf.getTime() + days * DAY_MS);
}

export function freshnessStateFor(source: FreshnessSource, asOf: Date, now: Date, options: FreshnessOptions = {}): FreshnessState {
    const until = freshUntilFor(source, asOf, options);
    return until !== null && now.getTime() > until.getTime() ? 'stale' : 'value';
}
