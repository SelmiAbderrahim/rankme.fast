export type MetricKind = 'count' | 'position' | 'ratio';

/** Missing observations stay null; a measured zero count remains a real value. */
export function metricOrNull(kind: MetricKind, value: number | null | undefined, denominator?: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;
    if ((kind === 'position' || kind === 'ratio') && denominator !== undefined &&
        !(typeof denominator === 'number' && Number.isFinite(denominator) && denominator > 0))
        return null;
    if (kind === 'position' && value <= 0)
        return null;
    return value;
}

/** Convert an observed ratio to percent without inventing a zero for absent data. */
export function percentOrNull(value: number | null | undefined, denominator: number | null | undefined): number | null {
    const ratio = metricOrNull('ratio', value, denominator ?? null);
    return ratio === null ? null : ratio * 100;
}
