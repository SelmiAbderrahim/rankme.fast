import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { teamMembers, teamMemberSiteGrants, } from '../../db/schema/team-members.js';
type TeamSiteAccessDb = Pick<Db, 'select'>;
/** Worker-safe membership check used before site-specific recipient fanout. */
export async function canTeamUserAccessSite(db: TeamSiteAccessDb, input: {
    teamId: string;
    userId: string;
    siteId: string;
}): Promise<boolean> {
    if (input.teamId === input.userId)
        return true;
    const memberships = await db
        .select({
        id: teamMembers.id,
        siteAccessMode: teamMembers.siteAccessMode,
    })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, input.teamId), eq(teamMembers.userId, input.userId), isNotNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)))
        .limit(1);
    const membership = memberships[0];
    if (!membership)
        return false;
    if (membership.siteAccessMode === 'all')
        return true;
    const grants = await db
        .select({ siteId: teamMemberSiteGrants.siteId })
        .from(teamMemberSiteGrants)
        .where(and(eq(teamMemberSiteGrants.teamMemberId, membership.id), eq(teamMemberSiteGrants.siteId, input.siteId)))
        .limit(1);
    return grants.length === 1;
}
