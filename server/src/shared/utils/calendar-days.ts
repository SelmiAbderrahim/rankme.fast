const DAY_MS = 86_400_000;

function utcDay(instant: Date): number {
    return Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate());
}

/** Whole UTC date boundaries, independent of elapsed hours or daylight saving time. */
export function utcCalendarDaysBetween(from: Date, to: Date): number {
    return (utcDay(to) - utcDay(from)) / DAY_MS;
}
