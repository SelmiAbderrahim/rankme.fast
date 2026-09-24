/**
 * Weekly Pulse — repository helpers used by the HTTP service.
 *
 * Thin wrappers around Drizzle so the service layer stays declarative and
 * every query is centralized. All accesses are account+site scoped; cross-
 * account access at the service layer converts a missing row into 404.
 */
import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { sitePulseSettings, sitePulseSubscriptions, weeklyPulseRuns, type NewSitePulseSettingRow, type NewSitePulseSubscriptionRow, type SitePulseSettingRow, type SitePulseSubscriptionRow, type WeeklyPulseRunRow, } from '../../db/schema/weekly-pulse.js';
export async function findSubscription(db: ApplicationDb, accountId: string, siteId: string, userId: string): Promise<SitePulseSubscriptionRow | null> {
    const rows = await db
        .select()
        .from(sitePulseSubscriptions)
        .where(and(eq(sitePulseSubscriptions.accountId, accountId), eq(sitePulseSubscriptions.siteId, siteId), eq(sitePulseSubscriptions.userId, userId)))
        .limit(1);
    return rows[0] ?? null;
}
export async function listSubscriptions(db: ApplicationDb, accountId: string, siteId: string): Promise<SitePulseSubscriptionRow[]> {
    return db
        .select()
        .from(sitePulseSubscriptions)
        .where(and(eq(sitePulseSubscriptions.accountId, accountId), eq(sitePulseSubscriptions.siteId, siteId)));
}
export async function upsertSubscription(db: ApplicationDb, row: NewSitePulseSubscriptionRow): Promise<SitePulseSubscriptionRow> {
    const existing = await findSubscription(db, row.accountId, row.siteId, row.userId);
    if (existing) {
        const [updated] = await db
            .update(sitePulseSubscriptions)
            .set({
            locale: row.locale,
            disabledAt: row.disabledAt ?? null,
            enabledAt: row.disabledAt === null || row.disabledAt === undefined ? new Date() : existing.enabledAt,
            updatedAt: new Date(),
        })
            .where(eq(sitePulseSubscriptions.id, existing.id))
            .returning();
        return updated!;
    }
    const [inserted] = await db.insert(sitePulseSubscriptions).values(row).returning();
    return inserted!;
}
export async function findSetting(db: ApplicationDb, accountId: string, siteId: string): Promise<SitePulseSettingRow | null> {
    const rows = await db
        .select()
        .from(sitePulseSettings)
        .where(and(eq(sitePulseSettings.accountId, accountId), eq(sitePulseSettings.siteId, siteId)))
        .limit(1);
    return rows[0] ?? null;
}
export async function upsertSetting(db: ApplicationDb, row: NewSitePulseSettingRow): Promise<SitePulseSettingRow> {
    const existing = await findSetting(db, row.accountId, row.siteId);
    if (existing) {
        const [updated] = await db
            .update(sitePulseSettings)
            .set({
            enabled: row.enabled,
            scheduleKey: row.scheduleKey,
            nextRunAt: row.nextRunAt,
            updatedAt: new Date(),
        })
            .where(eq(sitePulseSettings.id, existing.id))
            .returning();
        return updated!;
    }
    const [inserted] = await db.insert(sitePulseSettings).values(row).returning();
    return inserted!;
}
export async function findLatestRun(db: ApplicationDb, accountId: string, siteId: string): Promise<WeeklyPulseRunRow | null> {
    const rows = await db
        .select()
        .from(weeklyPulseRuns)
        .where(and(eq(weeklyPulseRuns.accountId, accountId), eq(weeklyPulseRuns.siteId, siteId)))
        .orderBy(desc(weeklyPulseRuns.createdAt), desc(weeklyPulseRuns.id))
        .limit(1);
    return rows[0] ?? null;
}
export interface HistoryPage {
    runs: WeeklyPulseRunRow[];
    nextCursor: string | null;
}
/**
 * Cursor pagination over the site's pulse history. Cursor is a
 * base64url-encoded `${createdAt.iso}|${id}` — bounded, opaque to callers.
 */
export async function listHistory(db: ApplicationDb, accountId: string, siteId: string, limit: number, cursor?: string): Promise<HistoryPage> {
    const decoded = cursor ? decodeCursor(cursor) : null;
    const rows = await db
        .select()
        .from(weeklyPulseRuns)
        .where(decoded
        ? and(eq(weeklyPulseRuns.accountId, accountId), eq(weeklyPulseRuns.siteId, siteId), cursorPredicate(decoded))
        : and(eq(weeklyPulseRuns.accountId, accountId), eq(weeklyPulseRuns.siteId, siteId)))
        .orderBy(desc(weeklyPulseRuns.createdAt), desc(weeklyPulseRuns.id))
        .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;
    return { runs: page, nextCursor };
}
function cursorPredicate(decoded: {
    createdAt: Date;
    id: string;
}) {
    // For deterministic (createdAt DESC, id DESC) order, "next" means older.
    // We want rows strictly older than the cursor row.
    return and(lt(weeklyPulseRuns.createdAt, decoded.createdAt), 
    // Fallback tie-breaker on ID for equal createdAt.
    gt(weeklyPulseRuns.id, decoded.id));
}
function encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}
/**
 * Decodes an opaque history cursor. Every step is total for a `string` input —
 * `Buffer.from(…, 'base64url')` ignores non-alphabet characters instead of
 * throwing, and `new Date(...)` yields an Invalid Date rather than raising — so
 * a malformed cursor is rejected through the explicit `null` guards below
 * rather than an exception handler. Returning `null` makes `listHistory` fall
 * back to the unfiltered first page.
 */
function decodeCursor(cursor: string): {
    createdAt: Date;
    id: string;
} | null {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [iso, id] = raw.split('|');
    if (!iso || !id)
        return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()))
        return null;
    return { createdAt, id };
}
export async function findRun(db: ApplicationDb, accountId: string, siteId: string, pulseId: string): Promise<WeeklyPulseRunRow | null> {
    const rows = await db
        .select()
        .from(weeklyPulseRuns)
        .where(and(eq(weeklyPulseRuns.accountId, accountId), eq(weeklyPulseRuns.siteId, siteId), eq(weeklyPulseRuns.id, pulseId)))
        .limit(1);
    return rows[0] ?? null;
}
