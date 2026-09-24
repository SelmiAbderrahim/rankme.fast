import { inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { parseTrafficSnapshotPayload, trafficSnapshots, } from '../../db/schema/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { TrafficSnapshotCompareQuery } from './traffic-snapshots.schema.js';
import { TRAFFIC_SNAPSHOT_NOT_FOUND_KEY } from './traffic-snapshots.service.js';
const TRAFFIC_COMPARE_MAX_COUNTRIES = 10;
/**
 * Stored-only comparison. The first read establishes whether every requested
 * id exists at all; owner and team-site filtering is then applied in memory.
 * Any unknown, foreign, or inaccessible id produces the same localized 404 as
 * the detail endpoint, and no partial comparison is returned.
 */
export async function compareTrafficSnapshots(accountId: string, query: TrafficSnapshotCompareQuery, db: Db, allowedSiteIds: readonly string[] | null = null) {
    const stored = await db
        .select()
        .from(trafficSnapshots)
        .where(inArray(trafficSnapshots.runId, query.ids));
    const existingIds = new Set(stored.map((row) => row.runId));
    if (query.ids.some((id) => !existingIds.has(id))) {
        throw HttpError.notFound({ code: 'TRAFFIC_SNAPSHOT_NOT_FOUND', messageKey: TRAFFIC_SNAPSHOT_NOT_FOUND_KEY });
    }
    const allowed = allowedSiteIds === null ? null : new Set(allowedSiteIds);
    const ownedById = new Map(stored
        .filter((row) => row.accountId === accountId &&
        (query.siteId === undefined || row.siteId === query.siteId) &&
        (allowed === null || (row.siteId !== null && allowed.has(row.siteId))))
        .map((row) => [row.runId, row] as const));
    const orderedRows = query.ids
        .map((id) => ownedById.get(id))
        .filter((row) => row !== undefined);
    // Never return a partial comparison: doing so would reveal which requested
    // ids were authorized. A foreign or denied row has the same 404 contract as
    // an unknown resource.
    if (orderedRows.length !== query.ids.length) {
        throw HttpError.notFound({ code: 'TRAFFIC_SNAPSHOT_NOT_FOUND', messageKey: TRAFFIC_SNAPSHOT_NOT_FOUND_KEY });
    }
    const snapshots = orderedRows.map((row) => ({
        id: row.runId,
        siteId: row.siteId,
        targetDomain: row.targetDomain,
        capturedAt: row.capturedAt.toISOString(),
        payload: parseTrafficSnapshotPayload(row.payload),
    }));
    const totalShares = new Map<string, number>();
    for (const snapshot of snapshots) {
        const countryVisits = snapshot.payload.topCountries.reduce((sum, country) => sum + country.visits.value, 0);
        const denominator = Math.max(1, snapshot.payload.monthlyOrganicVisits.value, countryVisits);
        for (const country of snapshot.payload.topCountries) {
            totalShares.set(country.countryCode, (totalShares.get(country.countryCode) ?? 0) +
                country.visits.value / denominator);
        }
    }
    const countryCodes = [...totalShares.entries()]
        .sort(([leftCode, leftShare], [rightCode, rightShare]) => rightShare - leftShare || leftCode.localeCompare(rightCode))
        .slice(0, TRAFFIC_COMPARE_MAX_COUNTRIES)
        .map(([countryCode]) => countryCode);
    return {
        snapshots,
        axes: { countryCodes },
    };
}
