/** Recursively sort object keys without changing array order. */
function sortReportJson(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(sortReportJson);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, sortReportJson(item)]));
    }
    return value;
}
/** Canonical JSON bytes: stable keys, preserved semantic array order, and one LF. */
export function stableReportJson(value: unknown): string {
    return `${JSON.stringify(sortReportJson(value))}\n`;
}
