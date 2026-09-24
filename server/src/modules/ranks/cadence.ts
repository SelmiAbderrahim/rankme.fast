/**
 * Site rank-check cadence lookup — a dependency-light leaf so both
 * keywords.service.ts and sites.service.ts (pause/resume scheduler restore)
 * can share it. Neither the ranks barrel nor the sites barrel is imported
 * here: keywords.service imports the sites barrel, so sites.service must
 * reach this logic without touching keywords.service (barrel-cycle risk).
 */
import { eq } from 'drizzle-orm';
import { domainStates, type RankCadenceKind } from '../../db/schema/keywords.js';
/** Cadence from `domain_states`, defaulting to weekly when no row exists. */
export async function getSiteCadence(db: ApplicationDb, siteId: string): Promise<RankCadenceKind> {
    const rows = await db
        .select({ cadence: domainStates.cadence })
        .from(domainStates)
        .where(eq(domainStates.siteId, siteId))
        .limit(1);
    return rows[0]?.cadence ?? 'weekly';
}
