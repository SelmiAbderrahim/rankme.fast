import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { localListingSnapshots, localPackRankSnapshots, localReviewsSnapshots, type LocalListingSnapshotRow, type LocalPackRankSnapshotRow, type LocalReviewsSnapshotRow, } from '../../db/schema/index.js';
import type { BusinessListingRow, QaSummary, ReviewsSummary } from '../../shared/providers/index.js';
/** UTC calendar day as `YYYY-MM-DD` for the daily-unique snapshot columns. */
export function snapshotDayOf(date: Date): string {
    return date.toISOString().slice(0, 10);
}
export interface PersistLocalSeoSnapshotInput {
    accountId: string;
    siteId: string;
    now: Date;
    listings: BusinessListingRow[];
    reviews: ReviewsSummary;
    qa: QaSummary;
}
/**
 * Persist the combined refresh result inside ONE transaction — the
 * all-or-nothing consistency invariant (service layer decides whether to
 * call this at all; once called, every row lands or none do). Same-day
 * uniqueness is enforced via `onConflictDoUpdate` on the tables' unique
 * indexes so a repeat refresh within the same UTC day overwrites rather than
 * appends.
 */
export async function persistLocalSeoSnapshot(db: Db, input: PersistLocalSeoSnapshotInput): Promise<void> {
    const snapshotDate = snapshotDayOf(input.now);
    await db.transaction(async (tx) => {
        if (input.listings.length > 0) {
            await tx
                .insert(localListingSnapshots)
                .values(input.listings.map((listing) => ({
                accountId: input.accountId,
                siteId: input.siteId,
                snapshotDate,
                source: listing.source,
                name: listing.name,
                address: listing.address,
                phone: listing.phone,
                consistent: listing.consistent,
                fetchedAt: input.now,
            })))
                .onConflictDoUpdate({
                target: [
                    localListingSnapshots.siteId,
                    localListingSnapshots.snapshotDate,
                    localListingSnapshots.source,
                ],
                set: {
                    name: sql `excluded.name`,
                    address: sql `excluded.address`,
                    phone: sql `excluded.phone`,
                    consistent: sql `excluded.consistent`,
                    fetchedAt: input.now,
                },
            });
        }
        await tx
            .insert(localReviewsSnapshots)
            .values({
            accountId: input.accountId,
            siteId: input.siteId,
            snapshotDate,
            averageRating: input.reviews.averageRating,
            reviewCount: input.reviews.reviewCount,
            unansweredQuestionCount: input.qa.unansweredCount,
            fetchedAt: input.now,
        })
            .onConflictDoUpdate({
            target: [localReviewsSnapshots.siteId, localReviewsSnapshots.snapshotDate],
            set: {
                averageRating: input.reviews.averageRating,
                reviewCount: input.reviews.reviewCount,
                unansweredQuestionCount: input.qa.unansweredCount,
                fetchedAt: input.now,
            },
        });
    });
}
export interface InsertLocalPackRankSnapshotInput {
    accountId: string;
    siteId: string;
    keywordId: string;
    position: number | null;
    totalPackSize: number;
    capturedAt: Date;
}
export async function insertLocalPackRankSnapshot(db: Db, input: InsertLocalPackRankSnapshotInput): Promise<void> {
    await db.insert(localPackRankSnapshots).values({
        accountId: input.accountId,
        siteId: input.siteId,
        keywordId: input.keywordId,
        position: input.position,
        totalPackSize: input.totalPackSize,
        capturedAt: input.capturedAt,
    });
}
/** All listing rows for the site's MOST RECENT snapshot date (every source). */
export async function readLatestListingSnapshot(db: Db, input: {
    siteId: string;
}): Promise<LocalListingSnapshotRow[]> {
    const latest = await db
        .select({ snapshotDate: localListingSnapshots.snapshotDate })
        .from(localListingSnapshots)
        .where(eq(localListingSnapshots.siteId, input.siteId))
        .orderBy(desc(localListingSnapshots.snapshotDate))
        .limit(1);
    const latestDate = latest[0]?.snapshotDate;
    if (!latestDate)
        return [];
    return db
        .select()
        .from(localListingSnapshots)
        .where(and(eq(localListingSnapshots.siteId, input.siteId), eq(localListingSnapshots.snapshotDate, latestDate)))
        .orderBy(localListingSnapshots.source);
}
export async function readLatestReviewsSnapshot(db: Db, input: {
    siteId: string;
}): Promise<LocalReviewsSnapshotRow | null> {
    const rows = await db
        .select()
        .from(localReviewsSnapshots)
        .where(eq(localReviewsSnapshots.siteId, input.siteId))
        .orderBy(desc(localReviewsSnapshots.snapshotDate))
        .limit(1);
    return rows[0] ?? null;
}
/** Latest local-pack rank row per tracked keyword for the site. */
export async function readLatestLocalPackSnapshots(db: Db, input: {
    siteId: string;
}): Promise<LocalPackRankSnapshotRow[]> {
    const rows = await db
        .select({
        id: localPackRankSnapshots.id,
        accountId: localPackRankSnapshots.accountId,
        siteId: localPackRankSnapshots.siteId,
        keywordId: localPackRankSnapshots.keywordId,
        position: localPackRankSnapshots.position,
        totalPackSize: localPackRankSnapshots.totalPackSize,
        capturedAt: localPackRankSnapshots.capturedAt,
        rn: sql<number> `row_number() over (partition by ${localPackRankSnapshots.keywordId} order by ${localPackRankSnapshots.capturedAt} desc)`.as('rn'),
    })
        .from(localPackRankSnapshots)
        .where(eq(localPackRankSnapshots.siteId, input.siteId));
    return rows.filter((row) => Number(row.rn) === 1).map(({ rn: _rn, ...row }) => row);
}
