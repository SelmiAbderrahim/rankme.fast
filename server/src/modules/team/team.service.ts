import { randomBytes, createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { HttpError } from '../../shared/utils/http-error.js';
import { logger } from '../../config/logger.js';
import { user as authUser } from '../../db/schema/auth.js';
import { teamMembers, teamMemberSiteGrants, teamProvisionedAccounts, type TeamMemberRole, } from '../../db/schema/team-members.js';
import { normalizedAppUrl } from '../../shared/utils/client-url.js';
import { isUniqueViolation } from '../../shared/utils/db-errors.js';
// Keep the mailer on its leaf module: the communication barrel also exports
// Express routing and is not safe to initialize from this identity-heavy
// module's Better Auth cycle.
import { deliverTeamInviteEmail } from '../communication/communication.service.js';
import { resolveRecipientLocale } from '../communication/recipient-locale.js';
import type { EmailSendResult } from '../communication/index.js';
import { createAuth, decryptInvitationPassword, deleteProvisionedIdentity, encryptInvitationPassword, provisionInvitationIdentity, verifyAndClaimInvitationIdentity, type AuthDatabase, } from '../auth/index.js';
import { User } from '../users/index.js';
import { Site } from '../sites/sites.model.js';
import { DEFAULT_LOCALE, type SupportedLocale } from '../../shared/i18n/index.js';
import { getTeamDb } from './team.holder.js';
import type { TeamSiteAccessInput } from './team.schema.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';
export interface TeamSiteAccess {
    mode: 'all' | 'selected';
    siteIds: string[];
}
export interface PublicMember {
    id: string;
    email: string;
    role: TeamMemberRole;
    userId: string | null;
    status: 'accepted' | 'pending';
    invitedAt: string;
    acceptedAt: string | null;
    expiresAt: string;
    siteAccess: TeamSiteAccess;
}
export interface TeamOverview {
    members: PublicMember[];
    /** Pagination facts for the roster table. `total` counts rows matching the
     * search, NOT the page. */
    meta: {
        total: number;
        page: number;
        pageSize: number;
    };
}
export interface ListTeamQuery {
    query?: string;
    page: number;
    pageSize: number;
}
/** One entry in the workspace switcher (`rankme-enterprise-orgs` 02). */
export interface WorkspaceSummary {
    accountId: string;
    /** The owning account's email — the only human-readable name a workspace
     * has, since there is no organizations table. */
    label: string;
    role: TeamMemberRole;
    isOwn: boolean;
    siteAccess: TeamSiteAccess;
}
/** Roster page size when the caller does not ask for one. */
export const DEFAULT_TEAM_PAGE_SIZE = 25;
function requiredValue<T>(value: T | null | undefined, error: Error): T {
    if (value === null || value === undefined)
        throw error;
    return value;
}
function hasSelectedSiteAccess(row: {
    readonly siteAccessMode: string;
}): boolean {
    return row.siteAccessMode === 'selected';
}
function displayLabel(row: {
    readonly displayName?: string | null;
    readonly domain: string;
}): string {
    return row.displayName || row.domain;
}
function ownerLabel(row: {
    readonly email: string;
} | null | undefined, id: string): string {
    return row?.email ?? id;
}
function mappedLabel(labels: ReadonlyMap<string, string>, id: string): string {
    return labels.get(id) ?? id;
}
function siteIdsForAccess(mode: 'all' | 'selected', siteIds: readonly string[] | undefined): string[] {
    return mode === 'selected' ? [...(siteIds ?? [])].sort() : [];
}
function canExpireInvitation<T extends Pick<typeof teamMembers.$inferSelect, 'acceptedAt' | 'revokedAt' | 'expiresAt'>>(invite: T | null, now: Date): invite is T {
    return Boolean(invite && !invite.acceptedAt && !invite.revokedAt && invite.expiresAt.getTime() <= now.getTime());
}
/** Escape the SQL LIKE metacharacters so a search for `a_b` or `100%` matches
 * literally instead of turning into a wildcard. Pairs with `escape '\\'`. */
function escapeLikePattern(input: string): string {
    return input.replace(/[\\%_]/gu, (match) => `\\${match}`);
}
const INVITE_TOKEN_BYTES = 32;
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
function localizedTeamUrl(locale: SupportedLocale, path: string): string {
    const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
    return `${normalizedAppUrl()}${prefix}${path}`;
}
function generateInviteToken(): {
    token: string;
    hash: string;
} {
    const token = randomBytes(INVITE_TOKEN_BYTES).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');
    return { token, hash };
}
function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
/**
 * Ensures the owner row for a team exists. The account owner IS the team —
 * we materialize a self-referential `owner` row on first team activity so
 * seat counting is a single COUNT() over `team_members` regardless of
 * whether anyone has been invited yet.
 */
async function ensureOwnerRow(db: ApplicationDb, accountId: string, email: string): Promise<void> {
    await db
        .insert(teamMembers)
        .values({
        teamId: accountId,
        userId: accountId,
        email,
        role: 'owner',
        inviteTokenHash: `owner:${accountId}`,
        invitedBy: accountId,
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
        .onConflictDoNothing({ target: teamMembers.inviteTokenHash });
}
function toPublicMember(row: typeof teamMembers.$inferSelect, siteIds: string[] = []): PublicMember {
    return {
        id: row.id,
        email: row.email,
        role: row.role,
        // Pre-bound pending credentials intentionally keep the principal private;
        // exposing it would turn invite into an account-enumeration endpoint.
        userId: row.acceptedAt ? row.userId : null,
        status: row.acceptedAt ? 'accepted' : 'pending',
        invitedAt: row.invitedAt.toISOString(),
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt.toISOString(),
        siteAccess: {
            mode: row.siteAccessMode,
            siteIds: siteIdsForAccess(row.siteAccessMode, siteIds),
        },
    };
}
async function grantsByMemberIds(db: ApplicationDb, memberIds: string[]): Promise<Map<string, string[]>> {
    if (memberIds.length === 0)
        return new Map();
    const rows = await db
        .select({ memberId: teamMemberSiteGrants.teamMemberId, siteId: teamMemberSiteGrants.siteId })
        .from(teamMemberSiteGrants)
        .where(inArray(teamMemberSiteGrants.teamMemberId, memberIds));
    const result = new Map<string, string[]>();
    for (const row of rows) {
        const current = result.get(row.memberId) ?? [];
        current.push(row.siteId);
        result.set(row.memberId, current);
    }
    return result;
}
async function publicMemberForRow(db: ApplicationDb, row: typeof teamMembers.$inferSelect): Promise<PublicMember> {
    const grants = row.siteAccessMode === 'selected'
        ? await grantsByMemberIds(db, [row.id])
        : new Map<string, string[]>();
    return toPublicMember(row, grants.get(row.id));
}
/** COUNT(*) over `team_members` under an arbitrary predicate. Shared by the
 * seat counter and the roster total so the unreachable `?? 0` guard exists in
 * exactly one place. */
async function countTeamRows(db: ApplicationDb, where: SQL | undefined): Promise<number> {
    const rows = await db
        .select({ count: sql<number> `count(*)::int` })
        .from(teamMembers)
        .where(where);
    /* c8 ignore next -- COUNT() always yields one row; the `?? 0` fallback is a TS-appeasing guard. */
    return rows[0]?.count ?? 0;
}
async function getOwnerEmail(accountId: string): Promise<string> {
    const doc = await User.findById(accountId, { email: 1 }).lean();
    if (!doc)
        throw HttpError.unauthorized({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    return doc.email;
}
export async function listTeam(accountId: string, query: ListTeamQuery = { page: 1, pageSize: DEFAULT_TEAM_PAGE_SIZE }): Promise<TeamOverview> {
    const db = getTeamDb();
    const ownerEmail = await getOwnerEmail(accountId);
    await ensureOwnerRow(db, accountId, ownerEmail);
    const search = query.query?.trim().toLowerCase() ?? '';
    const scope = and(eq(teamMembers.teamId, accountId), isNull(teamMembers.revokedAt));
    // Case-insensitive substring match on the address. Escaped so a customer
    // searching for `a_b` or `100%` gets a literal match rather than wildcards.
    const filter = search === ''
        ? scope
        : and(scope, sql `${teamMembers.email} ilike ${`%${escapeLikePattern(search)}%`} escape '\\'`);
    const rows = await db
        .select()
        .from(teamMembers)
        .where(filter)
        // Owner pinned first — it is the account itself and never scrolls away —
        // then newest invite first, which is what an owner just acted on.
        .orderBy(sql `(${teamMembers.role} = 'owner') desc`, desc(teamMembers.invitedAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
    const total = await countTeamRows(db, filter);
    const grantMap = await grantsByMemberIds(db, rows.filter(hasSelectedSiteAccess).map((row) => row.id));
    return {
        members: rows.map((row) => toPublicMember(row, grantMap.get(row.id))),
        meta: { total, page: query.page, pageSize: query.pageSize },
    };
}
/**
 * Every workspace this human can open (`rankme-enterprise-orgs` 02).
 *
 * ALWAYS actor-scoped: it answers "who am I", so it deliberately ignores any
 * `x-workspace-id` header — otherwise switching into a workspace would
 * rewrite the switcher's own contents. Own workspace first, then each
 * accepted, non-revoked membership. Bounded by memberships, so no pagination.
 */
export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    const db = getTeamDb();
    const ownEmail = await getOwnerEmail(userId);
    const memberships = await db
        .select({
        id: teamMembers.id,
        teamId: teamMembers.teamId,
        role: teamMembers.role,
        siteAccessMode: teamMembers.siteAccessMode,
    })
        .from(teamMembers)
        .where(and(eq(teamMembers.userId, userId), isNotNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)))
        .orderBy(teamMembers.invitedAt);
    const foreign = memberships.filter((row) => row.teamId !== userId);
    const grants = await grantsByMemberIds(db, foreign.filter(hasSelectedSiteAccess).map((row) => row.id));
    const labels = await Promise.all(foreign.map(async (row) => {
        const doc = await User.findById(row.teamId, { email: 1 }).lean();
        // A workspace whose owner vanished is unopenable; label it by id rather
        // than dropping it silently, so the switcher does not look truncated.
        return ownerLabel(doc, row.teamId);
    }));
    return [
        {
            accountId: userId,
            label: ownEmail,
            role: 'owner' as const,
            isOwn: true,
            siteAccess: { mode: 'all' as const, siteIds: [] },
        },
        ...foreign.map((row, index) => ({
            accountId: row.teamId,
            label: labels[index]!,
            role: row.role,
            isOwn: false,
            siteAccess: {
                mode: row.siteAccessMode,
                siteIds: siteIdsForAccess(row.siteAccessMode, grants.get(row.id)),
            },
        })),
    ];
}
export interface InviteMemberInput {
    email: string;
    inviterName: string;
    locale: SupportedLocale;
    role?: Exclude<TeamMemberRole, 'owner'>;
    siteAccess?: TeamSiteAccessInput;
    actorUserId?: string;
    actorRole?: TeamMemberRole;
    actorSiteAccess?: TeamSiteAccess;
}
export interface InviteResult {
    member: PublicMember;
    /** Internal-only test seam. HTTP controllers never serialize action tokens. */
    inviteToken: string;
    rejectToken: string;
    emailDelivered: boolean;
    outcomeUnknown?: boolean;
}
export interface InviteMemberDeps {
    /** Synchronization seam for deletion-barrier race regressions. */
    afterIdentityLookup?: (userId: string | null, tx: ApplicationDb) => Promise<void>;
    validateSiteAccess?: (accountId: string, siteAccess: TeamSiteAccessInput) => Promise<Array<{
        id: string;
        label: string;
    }>>;
    provisionIdentity?: (...args: Parameters<typeof provisionInvitationIdentity>) => Promise<Awaited<ReturnType<typeof provisionInvitationIdentity>> | undefined>;
    afterDelivery?: (memberId: string, db: ApplicationDb) => Promise<void>;
}
export interface PendingInvitation extends PublicMember {
    teamId: string;
    teamName: string;
    inviterName: string;
    sites: Array<{
        id: string;
        label: string;
    }>;
    requiresPasswordChange: boolean;
}
export interface InvitationPreview {
    invitation: Omit<PendingInvitation, 'email' | 'userId' | 'status' | 'acceptedAt' | 'invitedAt' | 'requiresPasswordChange'>;
    action: 'accept' | 'reject';
    requiresAuthentication: boolean;
}
async function validateWorkspaceSites(accountId: string, access: TeamSiteAccessInput): Promise<Array<{
    id: string;
    label: string;
}>> {
    if (access.mode === 'all')
        return [];
    const docs = await Site.find({
        _id: { $in: access.siteIds },
        accountId,
        deletionStartedAt: null,
    }, { displayName: 1, domain: 1 }).lean();
    if (docs.length !== access.siteIds.length) {
        throw HttpError.notFound({ code: 'TEAM_ERRORS_SITE_NOT_FOUND', messageKey: 'team.errors.siteNotFound' });
    }
    const labels = new Map(docs.map((site) => [String(site._id), displayLabel(site)]));
    return access.siteIds.map((id) => ({ id, label: mappedLabel(labels, id) }));
}
function assertDelegatedAccess(role: Exclude<TeamMemberRole, 'owner'>, access: TeamSiteAccessInput, actorRole: TeamMemberRole, actorAccess: TeamSiteAccess): void {
    if (actorRole === 'owner')
        return;
    if (actorRole !== 'admin' || role !== 'member') {
        throw HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' });
    }
    if (access.mode === 'all') {
        if (actorAccess.mode !== 'all')
            throw HttpError.notFound({ code: 'TEAM_ERRORS_SITE_NOT_FOUND', messageKey: 'team.errors.siteNotFound' });
        return;
    }
    if (actorAccess.mode === 'all')
        return;
    const allowed = new Set(actorAccess.siteIds);
    if (access.siteIds.some((siteId) => !allowed.has(siteId))) {
        throw HttpError.notFound({ code: 'TEAM_ERRORS_SITE_NOT_FOUND', messageKey: 'team.errors.siteNotFound' });
    }
}
async function assertCanManageTarget(db: ApplicationDb, target: typeof teamMembers.$inferSelect, actorRole: TeamMemberRole, actorAccess: TeamSiteAccess): Promise<void> {
    if (actorRole === 'owner')
        return;
    if (actorRole !== 'admin' || target.role !== 'member') {
        throw HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' });
    }
    if (actorAccess.mode === 'all')
        return;
    if (target.siteAccessMode === 'all') {
        throw HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' });
    }
    const targetSiteIds = await siteIdsForMember(db, target.id);
    const allowed = new Set(actorAccess.siteIds);
    if (targetSiteIds.some((siteId) => !allowed.has(siteId))) {
        throw HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' });
    }
}
async function siteIdsForMember(db: ApplicationDb, memberId: string): Promise<string[]> {
    const grants = await grantsByMemberIds(db, [memberId]);
    return grants.get(memberId) ?? [];
}
async function provisionalState(db: ApplicationDb, userId: string | null): Promise<(typeof teamProvisionedAccounts.$inferSelect) | null> {
    if (!userId)
        return null;
    const rows = await db
        .select()
        .from(teamProvisionedAccounts)
        .where(eq(teamProvisionedAccounts.userId, userId))
        .limit(1);
    return rows[0] ?? null;
}
/**
 * Invitation decisions are intentionally reachable before ordinary email
 * verification so system-provisioned recipients can claim their account.
 * That exception is provenance-bound: a regular unverified signup must not
 * be able to squat on somebody else's address and consume its invitation.
 */
async function invitationActorEmail(db: ApplicationDb, userId: string): Promise<string> {
    const identities = await db.select({
        email: authUser.email,
        emailVerified: authUser.emailVerified,
    }).from(authUser).where(eq(authUser.id, userId)).limit(1);
    const identity = identities[0];
    if (!identity)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    if (!identity.emailVerified) {
        const provisioning = await provisionalState(db, userId);
        if (provisioning?.status !== 'pending') {
            throw HttpError.forbidden({ code: 'ERRORS_EMAIL_NOT_VERIFIED', messageKey: 'errors.emailNotVerified' }, { code: 'EMAIL_NOT_VERIFIED' });
        }
    }
    return identity.email.trim().toLowerCase();
}
async function cleanupProvisionedIfOrphaned(db: ApplicationDb, userId: string | null): Promise<void> {
    if (!userId)
        return;
    const shouldDelete = await db.transaction(async (tx) => {
        const initial = await tx.select().from(teamProvisionedAccounts)
            .where(eq(teamProvisionedAccounts.userId, userId)).limit(1);
        const email = initial[0]?.email;
        if (!email)
            return false;
        await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${`team-invite:${email}`}))`);
        const rows = await tx.select().from(teamProvisionedAccounts)
            .where(eq(teamProvisionedAccounts.userId, userId)).for('update').limit(1);
        const provisioning = rows[0];
        if (!provisioning || provisioning.status !== 'pending')
            return false;
        const live = await countTeamRows(tx as unknown as ApplicationDb, and(eq(teamMembers.userId, userId), isNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt), gt(teamMembers.expiresAt, new Date())));
        if (live > 0)
            return false;
        const claimed = await tx
            .update(teamProvisionedAccounts)
            .set({ status: 'deleting', updatedAt: new Date() })
            .where(and(eq(teamProvisionedAccounts.userId, userId), eq(teamProvisionedAccounts.status, 'pending')))
            .returning({ userId: teamProvisionedAccounts.userId });
        return Boolean(claimed[0]);
    });
    if (!shouldDelete)
        return;
    await deleteProvisionedIdentity(userId);
}
export async function inviteMember(accountId: string, input: InviteMemberInput, deps: InviteMemberDeps = {}): Promise<InviteResult> {
    const db = getTeamDb();
    const ownerEmail = await getOwnerEmail(accountId);
    const inviteEmail = input.email.trim().toLowerCase();
    const inviteeProfile = await User.findOne({ email: inviteEmail })
        .select('language')
        .lean();
    const deliveryLocale = inviteeProfile
        ? resolveRecipientLocale({ recipientLocale: inviteeProfile.language })
        : resolveRecipientLocale({ requestLocale: input.locale });
    const role = input.role ?? 'member';
    const siteAccess = input.siteAccess ?? { mode: 'all' as const };
    const actorRole = input.actorRole ?? 'owner';
    const actorAccess = input.actorSiteAccess ?? { mode: 'all', siteIds: [] };
    assertDelegatedAccess(role, siteAccess, actorRole, actorAccess);
    const siteSummaries = await (deps.validateSiteAccess ?? validateWorkspaceSites)(accountId, siteAccess);
    await ensureOwnerRow(db, accountId, ownerEmail);
    if (inviteEmail === ownerEmail.trim().toLowerCase()) {
        throw HttpError.conflict({ code: 'TEAM_ERRORS_ALREADY_MEMBER', messageKey: 'team.errors.alreadyMember' });
    }
    const { token, hash } = generateInviteToken();
    const { token: rejectToken, hash: rejectHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    let invitedUserId: string | null = null;
    let temporaryPassword: string | undefined;
    let createdIdentity = false;
    let issuedProvisionalCredential = false;
    // Serialize the duplicate check→insert window per invited address with a
    // Postgres advisory lock. Released on tx commit/rollback.
    let row: typeof teamMembers.$inferSelect;
    try {
        row = await db.transaction(async (tx) => {
            await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${`team-invite:${inviteEmail}`}))`);
            const existing = await tx.select({ acceptedAt: teamMembers.acceptedAt })
                .from(teamMembers)
                .where(and(eq(teamMembers.teamId, accountId), eq(teamMembers.email, inviteEmail), isNull(teamMembers.revokedAt)))
                .limit(1);
            if (existing[0]?.acceptedAt)
                throw HttpError.conflict({ code: 'TEAM_ERRORS_ALREADY_MEMBER', messageKey: 'team.errors.alreadyMember' });
            if (existing[0])
                throw HttpError.conflict({ code: 'TEAM_ERRORS_ALREADY_INVITED', messageKey: 'team.errors.alreadyInvited' });
            // Identity discovery/provisioning is protected by the same per-email
            // lock as orphan cleanup. Otherwise two workspaces can both observe a
            // missing address and the losing invite can be mailed without a usable
            // credential. A still-unclaimed identity reuses the same AES-GCM
            // protected credential, so parallel invitation emails cannot invalidate
            // one another.
            let identities = await tx
                .select({ id: authUser.id })
                .from(authUser)
                .where(sql `lower(btrim(${authUser.email})) = ${inviteEmail}`)
                .limit(1);
            invitedUserId = identities[0]?.id ?? null;
            if (!invitedUserId) {
                let provisioned: Awaited<ReturnType<typeof provisionInvitationIdentity>> | undefined;
                try {
                    provisioned = await (deps.provisionIdentity ?? provisionInvitationIdentity)(inviteEmail, undefined, createAuth(tx as unknown as AuthDatabase, { sendVerificationOnSignUp: false }), (createdUserId) => {
                        invitedUserId = createdUserId;
                        createdIdentity = true;
                    });
                }
                catch (error) {
                    // A normal signup does not participate in this advisory lock. If it
                    // won the unique-email race, bind the invitation to that identity;
                    // otherwise preserve the original provisioning failure.
                    identities = await tx
                        .select({ id: authUser.id })
                        .from(authUser)
                        .where(sql `lower(btrim(${authUser.email})) = ${inviteEmail}`)
                        .limit(1);
                    invitedUserId = identities[0]?.id ?? null;
                    if (!invitedUserId)
                        throw error;
                }
                if (provisioned) {
                    invitedUserId = provisioned.userId;
                    temporaryPassword = provisioned.temporaryPassword;
                    issuedProvisionalCredential = true;
                    await tx.insert(teamProvisionedAccounts).values({
                        userId: invitedUserId,
                        email: inviteEmail,
                        temporaryPasswordEncrypted: encryptInvitationPassword(invitedUserId, inviteEmail, temporaryPassword),
                    });
                }
            }
            const boundUserId = requiredValue(invitedUserId, new Error('Invitation identity was not resolved'));
            const provisioning = await tx.select().from(teamProvisionedAccounts)
                .where(eq(teamProvisionedAccounts.userId, boundUserId))
                .limit(1);
            if (provisioning[0]?.status === 'deleting') {
                throw HttpError.conflict({ code: 'TEAM_ERRORS_INVITE_BEING_CLEANED', messageKey: 'team.errors.inviteBeingCleaned' });
            }
            if (!createdIdentity &&
                provisioning[0]?.status === 'pending' &&
                provisioning[0].mustChangePassword) {
                if (!provisioning[0].temporaryPasswordEncrypted) {
                    throw new Error('Provisioned invitation credential is unavailable');
                }
                temporaryPassword = decryptInvitationPassword(boundUserId, inviteEmail, provisioning[0].temporaryPasswordEncrypted);
                issuedProvisionalCredential = true;
            }
            // A pending invite is still pending until `acceptedAt` is set, but when
            // Better Auth already knows the invitee we bind the bearer credential to
            // that principal immediately. Account deletion can then erase/reject it
            // through the same permanent `user_id` tombstone guard as every accepted
            // membership. The global trigger handoff makes lookup -> insert safe when
            // deletion installs its tombstone between these two statements.
            await deps.afterIdentityLookup?.(boundUserId, tx as unknown as ApplicationDb);
            const rows = await tx
                .insert(teamMembers)
                .values({
                teamId: accountId,
                userId: boundUserId,
                email: inviteEmail,
                role,
                siteAccessMode: siteAccess.mode,
                inviteTokenHash: hash,
                rejectTokenHash: rejectHash,
                invitedBy: input.actorUserId ?? accountId,
                expiresAt,
            })
                .returning();
            if (siteAccess.mode === 'selected') {
                await tx.insert(teamMemberSiteGrants).values(siteAccess.siteIds.map((siteId) => ({ teamMemberId: rows[0]!.id, siteId })));
            }
            // drizzle's insert().returning() always yields the inserted row.
            return rows[0]!;
        });
    }
    catch (err) {
        // The provenance insert lived in the rolled-back transaction, so a newly
        // created Better Auth identity must be removed directly here.
        if (createdIdentity && invitedUserId)
            await deleteProvisionedIdentity(invitedUserId);
        if (isUniqueViolation(err)) {
            throw HttpError.conflict({ code: 'TEAM_ERRORS_ALREADY_INVITED', messageKey: 'team.errors.alreadyInvited' });
        }
        throw err;
    }
    const invitePath = `/team/accept/${token}`;
    const inviteUrl = localizedTeamUrl(deliveryLocale, invitePath);
    const rejectUrl = localizedTeamUrl(deliveryLocale, `/team/reject/${rejectToken}`);
    const signInUrl = `${localizedTeamUrl(deliveryLocale, '/login')}?${new URLSearchParams({
        returnTo: deliveryLocale === DEFAULT_LOCALE ? invitePath : `/${deliveryLocale}${invitePath}`,
    }).toString()}`;
    let delivery: EmailSendResult;
    try {
        delivery = await deliverTeamInviteEmail({
            email: inviteEmail,
            inviterName: input.inviterName,
            teamName: ownerEmail,
            acceptUrl: inviteUrl,
            rejectUrl,
            signInUrl,
            role,
            sites: siteAccess.mode === 'all'
                ? undefined
                : siteSummaries.map((site) => site.label).join(', '),
            temporaryPassword,
            locale: deliveryLocale,
            idempotencyKey: `team-invite/${row.id}/${hash.slice(0, 16)}`,
        });
    }
    catch {
        delivery = { delivered: false, outcomeUnknown: true };
        logger.warn({ teamId: accountId }, 'team invite delivery outcome is unknown; invitation remains pending');
    }
    await deps.afterDelivery?.(row.id, db);
    if (issuedProvisionalCredential &&
        !delivery.delivered &&
        !delivery.outcomeUnknown) {
        const revoked = await db
            .update(teamMembers)
            .set({ revokedAt: new Date() })
            .where(and(eq(teamMembers.id, row.id), isNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)))
            .returning({ id: teamMembers.id });
        if (revoked[0]) {
            await db.delete(teamMemberSiteGrants).where(eq(teamMemberSiteGrants.teamMemberId, row.id));
            await cleanupProvisionedIfOrphaned(db, invitedUserId);
            logger.warn({ teamId: accountId }, 'team invite delivery was definitively rejected; provisional state rolled back');
            throw new HttpError(502, { code: 'TEAM_ERRORS_INVITE_DELIVERY_FAILED', messageKey: 'team.errors.inviteDeliveryFailed' });
        }
    }
    return {
        member: toPublicMember(row, siteAccess.mode === 'selected' ? siteAccess.siteIds : []),
        inviteToken: token,
        rejectToken,
        emailDelivered: delivery.delivered,
        ...(delivery.outcomeUnknown ? { outcomeUnknown: true } : {}),
    };
}
/**
 * Re-send a pending invite with a FRESH token (`rankme-enterprise-orgs` 02).
 *
 * The rotation is the point: the row's `inviteTokenHash` is replaced, so the
 * previously emailed link stops matching and dies the instant this commits.
 * That is what makes resend safe to expose — a leaked or stale link cannot be
 * redeemed after the owner re-sends.
 *
 * Expired pending invites are explicitly allowed: renewing them is the main
 * reason this endpoint exists. Accepted and revoked rows are refused — there
 * is no credential to reissue.
 */
export async function resendInvite(workspaceAccountId: string, memberId: string, input: {
    inviterName: string;
    locale: SupportedLocale;
    actorRole: TeamMemberRole;
    actorSiteAccess: TeamSiteAccess;
}, deps: {
    deliverInvite?: typeof deliverTeamInviteEmail;
    beforeRotationUpdate?: (memberId: string, tx: ApplicationDb) => Promise<void>;
} = {}): Promise<InviteResult> {
    const db = getTeamDb();
    const { token, hash } = generateInviteToken();
    const { token: rejectToken, hash: rejectHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    let previousAcceptHash = '';
    let previousRejectHash: string | null = null;
    let previousExpiresAt = expiresAt;
    let previousInvitedAt = expiresAt;
    const updated = await db.transaction(async (tx) => {
        const rows = await tx
            .select()
            .from(teamMembers)
            .where(eq(teamMembers.id, memberId))
            .for('update')
            .limit(1);
        const row = rows[0];
        // Another workspace's row is indistinguishable from a missing one.
        if (!row || row.revokedAt || row.teamId !== workspaceAccountId) {
            throw HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' });
        }
        if (row.acceptedAt) {
            throw HttpError.badRequest({ code: 'TEAM_ERRORS_INVITE_USED', messageKey: 'team.errors.inviteUsed' });
        }
        await assertCanManageTarget(tx as unknown as ApplicationDb, row, input.actorRole, input.actorSiteAccess);
        previousAcceptHash = row.inviteTokenHash;
        previousRejectHash = row.rejectTokenHash;
        previousExpiresAt = row.expiresAt;
        previousInvitedAt = row.invitedAt;
        await deps.beforeRotationUpdate?.(row.id, tx as unknown as ApplicationDb);
        const updatedRows = await tx
            .update(teamMembers)
            .set({
            inviteTokenHash: hash,
            rejectTokenHash: rejectHash,
            expiresAt,
            invitedAt: new Date(),
        })
            .where(and(eq(teamMembers.id, memberId), 
        // Losing a race with an accept or a revoke must not resurrect the row
        // under a new token.
        isNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)))
            .returning();
        return requiredValue(updatedRows[0], HttpError.badRequest({ code: 'TEAM_ERRORS_INVITE_USED', messageKey: 'team.errors.inviteUsed' }));
    });
    const ownerEmail = await getOwnerEmail(workspaceAccountId);
    const inviteeProfile = updated.userId
        ? await User.findById(updated.userId).select('language').lean()
        : null;
    const deliveryLocale = inviteeProfile
        ? resolveRecipientLocale({ recipientLocale: inviteeProfile.language })
        : resolveRecipientLocale({ requestLocale: input.locale });
    const invitePath = `/team/accept/${token}`;
    const inviteUrl = localizedTeamUrl(deliveryLocale, invitePath);
    const rejectUrl = localizedTeamUrl(deliveryLocale, `/team/reject/${rejectToken}`);
    const signInUrl = `${localizedTeamUrl(deliveryLocale, '/login')}?${new URLSearchParams({
        returnTo: deliveryLocale === DEFAULT_LOCALE ? invitePath : `/${deliveryLocale}${invitePath}`,
    }).toString()}`;
    const grants = await siteIdsForMember(db, updated.id);
    const siteSummaries = updated.siteAccessMode === 'selected'
        ? await validateWorkspaceSites(workspaceAccountId, {
            mode: 'selected',
            siteIds: grants,
        })
        : [];
    const provisioning = await provisionalState(db, updated.userId);
    const temporaryPassword = provisioning?.status === 'pending' &&
        provisioning.mustChangePassword &&
        provisioning.temporaryPasswordEncrypted
        ? decryptInvitationPassword(provisioning.userId, provisioning.email, provisioning.temporaryPasswordEncrypted)
        : undefined;
    let delivery: EmailSendResult;
    try {
        delivery = await (deps.deliverInvite ?? deliverTeamInviteEmail)({
            email: updated.email,
            inviterName: input.inviterName,
            teamName: ownerEmail,
            acceptUrl: inviteUrl,
            rejectUrl,
            signInUrl,
            role: updated.role,
            sites: updated.siteAccessMode === 'selected'
                ? siteSummaries.map((site) => site.label).join(', ')
                : undefined,
            temporaryPassword,
            locale: deliveryLocale,
            idempotencyKey: `team-invite/${updated.id}/${hash.slice(0, 16)}`,
        });
    }
    catch {
        delivery = { delivered: false, outcomeUnknown: true };
        logger.warn({ teamId: workspaceAccountId }, 'team invite resend outcome is unknown; rotated invitation remains pending');
    }
    if (!delivery.delivered && !delivery.outcomeUnknown) {
        await db.update(teamMembers).set({
            inviteTokenHash: previousAcceptHash,
            rejectTokenHash: previousRejectHash,
            expiresAt: previousExpiresAt,
            invitedAt: previousInvitedAt,
        }).where(and(eq(teamMembers.id, updated.id), eq(teamMembers.inviteTokenHash, hash), isNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)));
        throw new HttpError(502, { code: 'TEAM_ERRORS_INVITE_DELIVERY_FAILED', messageKey: 'team.errors.inviteDeliveryFailed' });
    }
    return {
        member: toPublicMember(updated, grants),
        inviteToken: token,
        rejectToken,
        emailDelivered: delivery.delivered,
        ...(delivery.outcomeUnknown ? { outcomeUnknown: true } : {}),
    };
}
type InvitationLookup = {
    kind: 'token';
    hash: string;
} | {
    kind: 'id';
    id: string;
};
function invitationLookupCondition(lookup: InvitationLookup): SQL {
    return lookup.kind === 'token'
        ? eq(teamMembers.inviteTokenHash, lookup.hash)
        : eq(teamMembers.id, lookup.id);
}
async function acceptInvitation(acceptingUserId: string, lookup: InvitationLookup): Promise<PublicMember> {
    const db = getTeamDb();
    const email = await invitationActorEmail(db, acceptingUserId);
    const transition = await db.transaction(async (tx) => {
        const rows = await tx.select().from(teamMembers)
            .where(invitationLookupCondition(lookup)).for('update').limit(1);
        const invite = rows[0];
        if (!invite || invite.revokedAt) {
            throw HttpError.notFound({ code: 'TEAM_ERRORS_INVITE_NOT_FOUND', messageKey: 'team.errors.inviteNotFound' });
        }
        if (invite.acceptedAt)
            throw HttpError.badRequest({ code: 'TEAM_ERRORS_INVITE_USED', messageKey: 'team.errors.inviteUsed' });
        if (invite.expiresAt.getTime() <= Date.now()) {
            throw lookup.kind === 'token'
                ? HttpError.badRequest({ code: 'TEAM_ERRORS_INVITE_EXPIRED', messageKey: 'team.errors.inviteExpired' })
                : HttpError.notFound({ code: 'TEAM_ERRORS_INVITE_NOT_FOUND', messageKey: 'team.errors.inviteNotFound' });
        }
        if (invite.email !== email || (invite.userId && invite.userId !== acceptingUserId)) {
            throw HttpError.notFound({ code: 'TEAM_ERRORS_INVITE_NOT_FOUND', messageKey: 'team.errors.inviteNotFound' });
        }
        const provisioningRows = await tx.select().from(teamProvisionedAccounts)
            .where(eq(teamProvisionedAccounts.userId, acceptingUserId)).for('update').limit(1);
        const provisioning = provisioningRows[0];
        if (provisioning?.status === 'pending' && provisioning.mustChangePassword) {
            throw HttpError.badRequest({ code: 'TEAM_ERRORS_PASSWORD_CHANGE_REQUIRED', messageKey: 'team.errors.passwordChangeRequired' });
        }
        const updated = await tx.update(teamMembers)
            .set({ acceptedAt: new Date(), userId: acceptingUserId })
            .where(and(eq(teamMembers.id, invite.id), isNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)))
            .returning();
        const accepted = requiredValue(updated[0], HttpError.badRequest({ code: 'TEAM_ERRORS_INVITE_USED', messageKey: 'team.errors.inviteUsed' }));
        if (provisioning?.status === 'pending') {
            await tx.update(teamProvisionedAccounts)
                .set({
                status: 'claimed',
                mustChangePassword: false,
                temporaryPasswordEncrypted: null,
                updatedAt: new Date(),
            })
                .where(and(eq(teamProvisionedAccounts.userId, acceptingUserId), eq(teamProvisionedAccounts.status, 'pending')));
        }
        return { row: accepted, projectClaim: provisioning?.status === 'pending' };
    });
    if (transition.projectClaim) {
        // The relational terminal transition wins first. If this projection ever
        // fails, `reconcileTeamInvitations` repairs claimed identities while the
        // auth-level provisional flag keeps product access fail-closed.
        await verifyAndClaimInvitationIdentity(acceptingUserId);
    }
    return publicMemberForRow(db, transition.row);
}
export async function acceptInvite(acceptingUserId: string, token: string): Promise<PublicMember> {
    return acceptInvitation(acceptingUserId, { kind: 'token', hash: hashToken(token) });
}
export async function acceptInvitationById(acceptingUserId: string, invitationId: string): Promise<PublicMember> {
    return acceptInvitation(acceptingUserId, { kind: 'id', id: invitationId });
}
async function rejectInvitation(lookup: {
    kind: 'token';
    hash: string;
} | {
    kind: 'id';
    id: string;
    userId: string;
    email: string;
}): Promise<void> {
    const db = getTeamDb();
    const userId = await db.transaction(async (tx) => {
        const condition = lookup.kind === 'token'
            ? eq(teamMembers.rejectTokenHash, lookup.hash)
            : eq(teamMembers.id, lookup.id);
        const rows = await tx.select().from(teamMembers)
            .where(condition).for('update').limit(1);
        const invite = rows[0];
        if (!invite || invite.revokedAt || invite.acceptedAt ||
            invite.expiresAt.getTime() <= Date.now() ||
            (lookup.kind === 'id' && (invite.email !== lookup.email ||
                (invite.userId !== null && invite.userId !== lookup.userId)))) {
            throw HttpError.notFound({ code: 'TEAM_ERRORS_INVITE_NOT_FOUND', messageKey: 'team.errors.inviteNotFound' });
        }
        const updated = await tx.update(teamMembers)
            .set({ rejectedAt: new Date(), revokedAt: new Date() })
            .where(and(eq(teamMembers.id, invite.id), isNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)))
            .returning({ id: teamMembers.id });
        requiredValue(updated[0], HttpError.badRequest({ code: 'TEAM_ERRORS_INVITE_USED', messageKey: 'team.errors.inviteUsed' }));
        await tx.delete(teamMemberSiteGrants)
            .where(eq(teamMemberSiteGrants.teamMemberId, invite.id));
        return invite.userId;
    });
    await cleanupProvisionedIfOrphaned(db, userId);
}
export async function rejectInvitationById(userId: string, invitationId: string): Promise<void> {
    const email = await invitationActorEmail(getTeamDb(), userId);
    await rejectInvitation({ kind: 'id', id: invitationId, userId, email });
}
export async function rejectInvitationByToken(token: string): Promise<void> {
    await rejectInvitation({ kind: 'token', hash: hashToken(token) });
}
async function invitationDetails(db: ApplicationDb, invite: typeof teamMembers.$inferSelect): Promise<PendingInvitation> {
    const siteIds = invite.siteAccessMode === 'selected'
        ? await siteIdsForMember(db, invite.id)
        : [];
    const [teamOwner, inviter, provisioning] = await Promise.all([
        User.findById(invite.teamId, { email: 1 }).lean(),
        User.findById(invite.invitedBy, { email: 1, profile: 1 }).lean(),
        provisionalState(db, invite.userId),
    ]);
    const sites = siteIds.length === 0
        ? []
        : await Site.find({ _id: { $in: siteIds }, accountId: invite.teamId }, {
            displayName: 1,
            domain: 1,
        }).lean();
    const siteLabels = new Map(sites.map((site) => [String(site._id), displayLabel(site)]));
    const first = inviter?.profile?.firstName ?? '';
    const last = inviter?.profile?.lastName ?? '';
    return {
        ...toPublicMember(invite, siteIds),
        teamId: invite.teamId,
        teamName: teamOwner?.email ?? invite.teamId,
        inviterName: `${first} ${last}`.trim() || inviter?.email || invite.invitedBy,
        sites: siteIds.map((id) => ({ id, label: mappedLabel(siteLabels, id) })),
        requiresPasswordChange: provisioning?.status === 'pending' && provisioning.mustChangePassword,
    };
}
export async function listPendingInvitations(userId: string): Promise<PendingInvitation[]> {
    const db = getTeamDb();
    const email = await invitationActorEmail(db, userId);
    const rows = await db.select().from(teamMembers)
        .where(and(or(eq(teamMembers.userId, userId), eq(teamMembers.email, email)), isNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt), gt(teamMembers.expiresAt, new Date())))
        .orderBy(desc(teamMembers.invitedAt));
    return Promise.all(rows.map((row) => invitationDetails(db, row)));
}
export async function previewInvitation(token: string): Promise<InvitationPreview> {
    const db = getTeamDb();
    const hash = hashToken(token);
    const rows = await db.select().from(teamMembers)
        .where(or(eq(teamMembers.inviteTokenHash, hash), eq(teamMembers.rejectTokenHash, hash)))
        .limit(1);
    const invite = rows[0];
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt <= new Date()) {
        throw HttpError.notFound({ code: 'TEAM_ERRORS_INVITE_NOT_FOUND', messageKey: 'team.errors.inviteNotFound' });
    }
    const details = await invitationDetails(db, invite);
    return {
        invitation: {
            id: details.id,
            role: details.role,
            expiresAt: details.expiresAt,
            siteAccess: details.siteAccess,
            teamId: details.teamId,
            teamName: details.teamName,
            inviterName: details.inviterName,
            sites: details.sites,
        },
        action: invite.rejectTokenHash === hash ? 'reject' : 'accept',
        requiresAuthentication: invite.rejectTokenHash !== hash,
    };
}
/** Opportunistic/scheduled expiry cleanup. Bounded batches keep worker impact predictable. */
export async function cleanupExpiredInvitations(limit = 100, deps: {
    beforeCandidateLock?: (memberId: string, db: ApplicationDb) => Promise<void>;
    afterCandidateLock?: (memberId: string, tx: ApplicationDb) => Promise<void>;
} = {}): Promise<number> {
    const db = getTeamDb();
    const expired = await db.select().from(teamMembers)
        .where(and(isNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt), sql `${teamMembers.expiresAt} <= now()`))
        .limit(Math.max(1, Math.min(500, limit)));
    let changedCount = 0;
    for (const candidate of expired) {
        await deps.beforeCandidateLock?.(candidate.id, db);
        const transitioned = await db.transaction(async (tx) => {
            const rows = await tx.select().from(teamMembers)
                .where(eq(teamMembers.id, candidate.id)).for('update').limit(1);
            const invite = rows[0] ?? null;
            if (!canExpireInvitation(invite, new Date())) {
                return { changed: false as const, userId: null };
            }
            await deps.afterCandidateLock?.(invite.id, tx as unknown as ApplicationDb);
            const changed = await tx.update(teamMembers).set({ revokedAt: new Date() })
                .where(and(eq(teamMembers.id, invite.id), isNull(teamMembers.revokedAt)))
                .returning({ id: teamMembers.id });
            if (!changed[0])
                return { changed: false as const, userId: null };
            await tx.delete(teamMemberSiteGrants)
                .where(eq(teamMemberSiteGrants.teamMemberId, invite.id));
            return { changed: true as const, userId: invite.userId };
        });
        if (!transitioned.changed)
            continue;
        changedCount += 1;
        await cleanupProvisionedIfOrphaned(db, transitioned.userId);
    }
    return changedCount;
}
export interface InvitationReconciliationResult {
    expiredRevoked: number;
    provisionalDeletesRetried: number;
    provisionalDeletesFailed: number;
    claimProjectionsRetried: number;
    claimProjectionsFailed: number;
}
/** Worker-safe bounded repair for expired invitations and cross-store deletes. */
export async function reconcileTeamInvitations(limit = 100): Promise<InvitationReconciliationResult> {
    const db = getTeamDb();
    const expiredRevoked = await cleanupExpiredInvitations(limit);
    const deleting = await db.select({ userId: teamProvisionedAccounts.userId })
        .from(teamProvisionedAccounts)
        .where(eq(teamProvisionedAccounts.status, 'deleting'))
        .limit(Math.max(1, Math.min(500, limit)));
    let provisionalDeletesRetried = 0;
    let provisionalDeletesFailed = 0;
    for (const row of deleting) {
        try {
            await deleteProvisionedIdentity(row.userId);
            provisionalDeletesRetried += 1;
        }
        catch {
            provisionalDeletesFailed += 1;
            logger.warn({ component: 'team-invitation-reconciliation' }, 'provisional invitation identity cleanup remains pending');
        }
    }
    const claimed = await db.select({ userId: teamProvisionedAccounts.userId })
        .from(teamProvisionedAccounts)
        .where(eq(teamProvisionedAccounts.status, 'claimed'))
        .limit(Math.max(1, Math.min(500, limit)));
    let claimProjectionsRetried = 0;
    let claimProjectionsFailed = 0;
    for (const row of claimed) {
        try {
            await verifyAndClaimInvitationIdentity(row.userId);
            claimProjectionsRetried += 1;
        }
        catch {
            claimProjectionsFailed += 1;
            logger.warn({ component: 'team-invitation-reconciliation' }, 'claimed invitation identity projection remains pending');
        }
    }
    return {
        expiredRevoked,
        provisionalDeletesRetried,
        provisionalDeletesFailed,
        claimProjectionsRetried,
        claimProjectionsFailed,
    };
}
/**
 * Who is asking to remove a row (`rankme-enterprise-orgs` 02).
 *
 * Three fields because removal has two independent legitimate shapes and the
 * workspace account alone cannot tell them apart:
 *  - `workspaceAccountId` — the team being managed. Under workspace context
 *    EVERY accepted role resolves to the owner's account, so this on its own
 *    would let a plain member remove their peers.
 *  - `teamRole` — therefore required: only owner/admin may manage others.
 *  - `actorUserId` — the human. A member leaving targets their OWN row, which
 *    stays permitted at every role.
 */
export interface RemoveMemberActor {
    workspaceAccountId: string;
    actorUserId: string;
    teamRole: TeamMemberRole;
    teamSiteAccess: TeamSiteAccess;
}
/**
 * Remove a member OR revoke a pending invite. Owners may manage every
 * non-owner row; admins may manage members only when the target's site grants
 * are a subset of their own. Any member may remove THEMSELVES ("leave"). The
 * owner row can never be removed.
 */
export async function removeMember(actor: RemoveMemberActor, memberId: string): Promise<void> {
    const db = getTeamDb();
    const removed = await db.transaction(async (tx) => {
        const rows = await tx.select().from(teamMembers)
            .where(eq(teamMembers.id, memberId)).for('update').limit(1);
        const row = rows[0];
        if (!row || row.revokedAt) {
            throw HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' });
        }
        const isSelfLeave = row.userId === actor.actorUserId && row.role !== 'owner';
        const isWorkspaceTarget = row.teamId === actor.workspaceAccountId;
        if (!isWorkspaceTarget && !isSelfLeave) {
            // Cross-account, or a plain member reaching for a peer: 404, never 403.
            throw HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' });
        }
        if (row.role === 'owner') {
            throw HttpError.badRequest({ code: 'TEAM_ERRORS_CANNOT_REMOVE_OWNER', messageKey: 'team.errors.cannotRemoveOwner' });
        }
        if (!isSelfLeave) {
            await assertCanManageTarget(tx as unknown as ApplicationDb, row, actor.teamRole, actor.teamSiteAccess);
        }
        const changed = await tx
            .update(teamMembers)
            .set({ revokedAt: new Date() })
            .where(and(eq(teamMembers.id, memberId), isNull(teamMembers.revokedAt)))
            .returning({ userId: teamMembers.userId, acceptedAt: teamMembers.acceptedAt });
        const changedRow = requiredValue(changed[0], HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' }));
        await tx.delete(teamMemberSiteGrants)
            .where(eq(teamMemberSiteGrants.teamMemberId, memberId));
        return changedRow;
    });
    if (!removed.acceptedAt)
        await cleanupProvisionedIfOrphaned(db, removed.userId);
}
/**
 * Move a row between `member` and `admin` (`rankme-enterprise-orgs` 02).
 *
 * Owner-only — the route carries `requireWorkspaceOwner`, so this receives the
 * workspace account and only has to prove the row belongs to it. A PENDING
 * invite may be re-roled: nothing is bound until acceptance, and the new role
 * simply lands when the invitee redeems the token.
 *
 * Re-applying the role the row already has is a 200 no-op, so a double-click
 * or a retried request is not an error.
 */
export async function changeMemberRole(workspaceAccountId: string, memberId: string, role: Exclude<TeamMemberRole, 'owner'>): Promise<PublicMember> {
    const db = getTeamDb();
    const rows = await db.select().from(teamMembers).where(eq(teamMembers.id, memberId)).limit(1);
    const row = rows[0];
    // Belonging to another workspace is indistinguishable from not existing.
    if (!row || row.revokedAt || row.teamId !== workspaceAccountId) {
        throw HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' });
    }
    if (row.role === 'owner') {
        throw HttpError.badRequest({ code: 'TEAM_ERRORS_CANNOT_CHANGE_OWNER_ROLE', messageKey: 'team.errors.cannotChangeOwnerRole' });
    }
    if (row.role === role)
        return publicMemberForRow(db, row);
    const updated = await db
        .update(teamMembers)
        .set({ role })
        .where(and(eq(teamMembers.id, memberId), isNull(teamMembers.revokedAt)))
        .returning();
    // Lost a race with a concurrent removal — the row is gone as far as the
    // caller is concerned.
    const next = requiredValue(updated[0], HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' }));
    return publicMemberForRow(db, next);
}
export async function updateMemberAccess(workspaceAccountId: string, memberId: string, input: {
    role: Exclude<TeamMemberRole, 'owner'>;
    siteAccess: TeamSiteAccessInput;
}): Promise<PublicMember> {
    const db = getTeamDb();
    const siteSummaries = await validateWorkspaceSites(workspaceAccountId, input.siteAccess);
    void siteSummaries;
    const updated = await db.transaction(async (tx) => {
        const rows = await tx.select().from(teamMembers)
            .where(eq(teamMembers.id, memberId)).for('update').limit(1);
        const row = rows[0];
        if (!row || row.revokedAt || row.teamId !== workspaceAccountId) {
            throw HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' });
        }
        if (row.role === 'owner')
            throw HttpError.badRequest({ code: 'TEAM_ERRORS_CANNOT_CHANGE_OWNER_ROLE', messageKey: 'team.errors.cannotChangeOwnerRole' });
        const nextRows = await tx.update(teamMembers)
            .set({ role: input.role, siteAccessMode: input.siteAccess.mode })
            .where(and(eq(teamMembers.id, memberId), isNull(teamMembers.revokedAt)))
            .returning();
        await tx.delete(teamMemberSiteGrants)
            .where(eq(teamMemberSiteGrants.teamMemberId, memberId));
        if (input.siteAccess.mode === 'selected') {
            await tx.insert(teamMemberSiteGrants).values(input.siteAccess.siteIds.map((siteId) => ({ teamMemberId: memberId, siteId })));
        }
        return requiredValue(nextRows[0], HttpError.notFound({ code: 'TEAM_ERRORS_MEMBER_NOT_FOUND', messageKey: 'team.errors.memberNotFound' }));
    });
    return toPublicMember(updated, input.siteAccess.mode === 'selected' ? input.siteAccess.siteIds : []);
}
/** Narrow deterministic seams for invariant and race-boundary tests. */
export const teamServiceTestables = Object.freeze({
    requiredValue,
    hasSelectedSiteAccess,
    displayLabel,
    ownerLabel,
    mappedLabel,
    siteIdsForAccess,
    canExpireInvitation,
    escapeLikePattern,
    hashToken,
    toPublicMember,
    assertDelegatedAccess,
    assertCanManageTarget,
    invitationLookupCondition,
    provisionalState,
    cleanupProvisionedIfOrphaned,
});
