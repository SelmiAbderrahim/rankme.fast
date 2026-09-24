/**
 * Weekly Pulse — pure schedule + ISO-week helpers.
 *
 * NO IO. NO clock reads (callers pass `now`). NO randomness.
 *
 * `computeSchedule(siteId)` derives a stable weekday/hour/minute cron per site
 * so weekly-pulse traffic staggers across Mon–Sat 09..14 UTC (working-hours
 * envelope; Sunday reserved for ops).
 *
 * `isoWeekUtc(date)` returns `YYYY-Www` in UTC (ISO 8601). This is the
 * uniqueness component of `weekly_pulse_runs.iso_week` — the
 * whole 12-set's replay guarantee depends on it being a pure function of the
 * UTC timestamp.
 */
/**
 * FNV-1a 32-bit hash over the UTF-16 code units of `input`. Deterministic and
 * pure — no crypto dependency, no clock, no randomness. The output is a
 * non-negative unsigned 32-bit integer.
 *
 * We use FNV-1a instead of `crypto.createHash('sha256')` here because the
 * schedule helper must be fully in-memory pure so tests can assert its
 * distribution over 10 000 synthetic ids without touching a native binding.
 * The strength of the hash does not matter — we only need uniform spread
 * across a small integer space, and FNV-1a is the canonical minimal choice.
 */
export function fnv1a32(input: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        // 32-bit FNV prime: 0x01000193.
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}
export interface WeeklyPulseSchedule {
    /** ISO-8601 day-of-week (1 = Monday .. 6 = Saturday). Sunday (7) is
     * excluded — reserved for ops. */
    readonly weekday: 1 | 2 | 3 | 4 | 5 | 6;
    /** UTC hour, 9..14 inclusive. */
    readonly hour: number;
    /** UTC minute, 0..59 inclusive. */
    readonly minute: number;
    /** 5-field crontab string in UTC — `m h d M W` → for a fixed weekday. */
    readonly cron: string;
    /** Pre-computed hash used as `site_pulse_settings.schedule_key`. Stable
     * per siteId. */
    readonly scheduleKey: number;
}
/**
 * Pure deterministic derivation of the site's weekly pulse cadence. Same
 * `siteId` → same schedule forever.
 *
 * *   schedule_key = fnv1a32(siteId) mod 3600
 *   weekday      = 1 + (schedule_key mod 6)     // Mon..Sat
 *   utcHour      = 9 + (schedule_key mod 6)     // 09..14 UTC
 *   utcMinute    = (schedule_key * 7) mod 60
 */
export function computeSchedule(siteId: string): WeeklyPulseSchedule {
    if (siteId.length === 0) {
        throw new Error('computeSchedule: siteId must not be empty');
    }
    const scheduleKey = fnv1a32(siteId) % 3600;
    const weekday = (1 + (scheduleKey % 6)) as WeeklyPulseSchedule['weekday'];
    const hour = 9 + (scheduleKey % 6);
    const minute = (scheduleKey * 7) % 60;
    const cron = `${minute} ${hour} * * ${weekday}`;
    return { weekday, hour, minute, cron, scheduleKey };
}
/**
 * ISO-8601 UTC week key — `YYYY-Www`. Pure function of the UTC timestamp
 * (never reads `Date.now()`). Matches ISO week rules: weeks start on Monday,
 * and week 1 is the week containing the first Thursday of the year.
 */
export function isoWeekUtc(date: Date): string {
    if (Number.isNaN(date.getTime())) {
        throw new Error('isoWeekUtc: invalid Date');
    }
    // Copy so we don't mutate the caller's Date, and drop time-of-day.
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    // ISO day-of-week: Mon=1..Sun=7 (JS getUTCDay: Sun=0..Sat=6 → map).
    const isoDow = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
    // Shift to the Thursday of the current week (ISO week is determined by
    // whichever year contains the Thursday of that week).
    utc.setUTCDate(utc.getUTCDate() + 4 - isoDow);
    const isoYear = utc.getUTCFullYear();
    const jan4 = new Date(Date.UTC(isoYear, 0, 4));
    const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
    const week1Monday = new Date(jan4.getTime());
    week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow + 1);
    const oneDayMs = 24 * 60 * 60 * 1000;
    const weekNumber = Math.floor((utc.getTime() - week1Monday.getTime()) / (7 * oneDayMs)) + 1;
    return `${String(isoYear).padStart(4, '0')}-W${String(weekNumber).padStart(2, '0')}`;
}
/**
 * Next scheduled tick strictly greater than `from` (UTC). Deterministic —
 * only uses `from` and the site's schedule. The scheduler stores this on
 * `site_pulse_settings.next_run_at` after each run + subscription mutation.
 */
export function nextRunAt(schedule: WeeklyPulseSchedule, from: Date): Date {
    if (Number.isNaN(from.getTime())) {
        throw new Error('nextRunAt: invalid from Date');
    }
    const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), schedule.hour, schedule.minute, 0, 0));
    const fromDow = from.getUTCDay() === 0 ? 7 : from.getUTCDay();
    let daysAhead = schedule.weekday - fromDow;
    if (daysAhead < 0 || (daysAhead === 0 && candidate.getTime() <= from.getTime())) {
        daysAhead += 7;
    }
    candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
    return candidate;
}
