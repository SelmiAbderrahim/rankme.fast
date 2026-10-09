import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { user as authUser } from '../../db/schema/auth.js';
import { teamMembers } from '../../db/schema/team-members.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';

/** Display identity of a workspace member — never more than name + email. */
export interface WorkspaceActor {
    /** Better Auth display name; `null` when the account has none. */
    name: string | null;
    email: string;
}

/**
 * Resolve user ids to display identities, but ONLY for people who belong to
 * the given workspace: the owner (`accountId` is the owner's user id) and
 * accepted, non-revoked members. Anyone else — a removed member, an id from
 * another account — is absent from the result, so a caller can never use this
 * to look up an arbitrary account. Callers fall back to a generic label.
 */
export async function resolveWorkspaceActors(
    db: ApplicationDb,
    accountId: string,
    userIds: readonly string[],
): Promise<Map<string, WorkspaceActor>> {
    const wanted = [...new Set(userIds)];
    const result = new Map<string, WorkspaceActor>();
    if (wanted.length === 0)
        return result;
    const memberRows = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, accountId), isNotNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt), inArray(teamMembers.userId, wanted)));
    const allowed = new Set(memberRows.map((row) => row.userId).filter((id): id is string => id !== null));
    if (wanted.includes(accountId))
        allowed.add(accountId);
    if (allowed.size === 0)
        return result;
    const rows = await db
        .select({ id: authUser.id, name: authUser.name, email: authUser.email })
        .from(authUser)
        .where(inArray(authUser.id, [...allowed]));
    for (const row of rows) {
        result.set(row.id, { name: row.name.trim() === '' ? null : row.name.trim(), email: row.email });
    }
    return result;
}
