/**
 * Deterministic pure functions for Keyword Trends readouts. Every function
 * accepts a raw `WeeklyPoint[]` observation series (index values 0..100,
 * ISO 8601 `date` string) and returns a plain object — no vendor coupling,
 * no I/O.
 *
 * Frozen implementation — these numeric contracts (the recommended readout
 * formulas) are authoritative. Callers must NOT re-derive slope thresholds,
 * insufficient-history bounds, or seasonality multipliers.
 */
export interface WeeklyPoint {
    /** ISO 8601 calendar date at week start. Parsed with `new Date(date)` (UTC). */
    date: string;
    /** Google Trends 0..100 index value. NaN and negatives are filtered. */
    value: number;
}
export interface YoyResult {
    deltaFraction: number | null;
    reason?: 'insufficient_history';
}
export interface MomentumResult {
    direction: 'up' | 'down' | 'flat';
    slopePerWeek: number | null;
    reason?: 'insufficient_history';
}
export interface SeasonalityResult {
    months: number[];
    reason?: 'insufficient_history';
}
/**
 * Year-over-year change: mean(last 4 valid weeks) minus mean(same 4 weeks 52
 * weeks earlier), divided by max(1, mean of the earlier window). Requires
 * at least 56 valid weeks (4 recent + 52 gap + 4 prior). Points with NaN or
 * negative values are silently filtered — an invalid observation contributes
 * nothing to the mean.
 */
export function yearOverYear(weekly: readonly WeeklyPoint[]): YoyResult {
    const valid = weekly.filter((p) => Number.isFinite(p.value) && p.value >= 0);
    if (valid.length < 56)
        return { deltaFraction: null, reason: 'insufficient_history' };
    const n = valid.length;
    const recent = valid.slice(n - 4).map((p) => p.value);
    // The `valid.length < 56` guard above already proves `n - 56 >= 0`, so the
    // prior window always starts inside the series — no second guard needed.
    const priorStart = n - 4 - 52;
    const prior = valid.slice(priorStart, priorStart + 4).map((p) => p.value);
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
    const priorMean = mean(prior);
    const denom = Math.max(1, priorMean);
    return { deltaFraction: (mean(recent) - priorMean) / denom };
}
/**
 * 12-week momentum: least-squares slope of the last 12 valid values plotted
 * over x = 0..11. Slope > +0.5 → `up`; slope < −0.5 → `down`; otherwise
 * `flat`. Requires at least 12 valid weeks. The x window is the fixed
 * sequence 0..11, so its variance is the constant 143 — the denominator can
 * never be zero and needs no guard.
 */
export function momentum(weekly: readonly WeeklyPoint[]): MomentumResult {
    const valid = weekly.filter((p) => Number.isFinite(p.value) && p.value >= 0);
    if (valid.length < 12) {
        return { direction: 'flat', slopePerWeek: null, reason: 'insufficient_history' };
    }
    const last12 = valid.slice(-12).map((p) => p.value);
    const xs = last12.map((_, i) => i);
    const xMean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const yMean = last12.reduce((s, y) => s + y, 0) / last12.length;
    const num = xs.reduce((s, x, i) => s + (x - xMean) * (last12[i]! - yMean), 0);
    const den = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
    const slope = num / den;
    const direction: MomentumResult['direction'] = slope > 0.5 ? 'up' : slope < -0.5 ? 'down' : 'flat';
    return { direction, slopePerWeek: slope };
}
/**
 * Peak-months detector: for each month-of-year (1..12) compute the mean of
 * the per-year monthly means across the whole history, then keep months
 * whose mean exceeds 1.15 × the yearly mean. Requires at least 24 distinct
 * `YYYY-MM` months (matches the 2-year floor the client copy talks about).
 * Ascending 1..12.
 */
export function seasonalityMonths(weekly: readonly WeeklyPoint[]): SeasonalityResult {
    const valid = weekly.filter((p) => Number.isFinite(p.value) && p.value >= 0);
    const byMonth = new Map<string, number[]>();
    for (const p of valid) {
        const d = new Date(p.date);
        if (Number.isNaN(d.getTime()))
            continue;
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
        const bucket = byMonth.get(key);
        if (bucket) {
            bucket.push(p.value);
        }
        else {
            byMonth.set(key, [p.value]);
        }
    }
    if (byMonth.size < 24)
        return { months: [], reason: 'insufficient_history' };
    const byMonthOfYear = new Map<number, number[]>();
    for (const [key, values] of byMonth) {
        const month = Number(key.split('-')[1]);
        const monthMean = values.reduce((s, v) => s + v, 0) / values.length;
        const bucket = byMonthOfYear.get(month);
        if (bucket) {
            bucket.push(monthMean);
        }
        else {
            byMonthOfYear.set(month, [monthMean]);
        }
    }
    const monthlyMean = new Map<number, number>();
    for (const [m, arr] of byMonthOfYear) {
        monthlyMean.set(m, arr.reduce((s, v) => s + v, 0) / arr.length);
    }
    const allMeans = [...monthlyMean.values()];
    const yearlyMean = allMeans.reduce((s, v) => s + v, 0) / allMeans.length;
    const months: number[] = [];
    for (const [m, mean] of monthlyMean) {
        if (mean > 1.15 * yearlyMean)
            months.push(m);
    }
    return { months: months.sort((a, b) => a - b) };
}
/**
 * Coverage-note key attached to every /trends response — the UI resolves it
 * against the i18n dictionary to render the "search interest index" disclaimer
 * verbatim. Kept as a KEY (not the resolved string) so translations can drift
 * without touching the server DTO.
 */
export const SEARCH_INTEREST_INDEX_KEY = 'keywordResearch.trends.coverageNote.searchInterestIndex' as const;
/**
 * DTO wrapper the service uses when packaging a `TrendsSeries` (weekly
 * points) or a derived readout. `source: 'estimate'` is invariant.
 */
export interface EstimateEnvelope {
    source: 'estimate';
    observationMeta: {
        searchInterestIndexKey: typeof SEARCH_INTEREST_INDEX_KEY;
    };
}
export function estimateEnvelope(): EstimateEnvelope {
    return {
        source: 'estimate',
        observationMeta: { searchInterestIndexKey: SEARCH_INTEREST_INDEX_KEY },
    };
}
