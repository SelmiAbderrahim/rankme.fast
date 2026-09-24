import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import type { EncryptedSecret } from '../../shared/crypto/index.js';
/**
 * Team membership + pending invites.
 *
 * Relational, per-account ordered data → Drizzle/Postgres (see
 * `.claude/rules/drizzle-postgres-scope.md`). One row per member OR pending
 * invite. Seat count for an account = COUNT(rows where teamId = accountId
 * AND revokedAt IS NULL). `acceptedAt IS NULL` marks a pending invite;
 * accepting sets `acceptedAt` + binds `userId`.
 *
 * `teamId` uses the owner's account id (matches the pattern used across
 * subscriptions / usage_counters — text, not FK, since Better Auth user ids
 * live in the Postgres `user` table with string ids).
 *
 * `inviteToken` stores the SHA-256 hex hash of the token we email the
 * invitee — never the raw token — so a leaked DB dump cannot be replayed.
 * The raw random token is shown once in the email link.
 */
/**
 * Team roles, most privileged first (`rankme-enterprise-orgs` 02).
 *
 * `owner` — the account itself: everything, including the owner-only
 * surfaces (billing, data rights, Google connections, API keys, MCP
 * permissions, account profile, alert channels).
 * `admin` — full product work inside the workspace PLUS team management
 * (invite / remove). Never reaches the owner-only surfaces.
 * `member` — full product work inside the workspace, no team management.
 *
 * This is the TEAM axis. It is orthogonal to the PLATFORM role on
 * `req.user.role` (Member/Admin/SuperAdmin) which gates the admin and
 * superadmin panels — never conflate the two.
 */
export const TEAM_MEMBER_ROLES = ['owner', 'admin', 'member'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];
export const TEAM_SITE_ACCESS_MODES = ['all', 'selected'] as const;
export type TeamSiteAccessMode = (typeof TEAM_SITE_ACCESS_MODES)[number];
export const teamMembers = pgTable('team_members', {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: text('team_id').notNull(),
    userId: text('user_id'),
    email: text('email').notNull(),
    role: text('role', { enum: TEAM_MEMBER_ROLES }).notNull().default('member'),
    siteAccessMode: text('site_access_mode', { enum: TEAM_SITE_ACCESS_MODES })
        .notNull()
        .default('all'),
    inviteTokenHash: text('invite_token_hash').notNull().unique(),
    rejectTokenHash: text('reject_token_hash').unique(),
    invitedBy: text('invited_by').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    // A single live membership (pending OR accepted) per (team, email).
    // Revoked rows drop out so the same email can be invited after leaving,
    // while an already-accepted teammate cannot receive a duplicate invite.
    uniqueIndex('team_members_live_membership_uidx')
        .on(table.teamId, table.email)
        .where(sql `${table.revokedAt} is null`),
    index('team_members_team_id_idx').on(table.teamId),
    index('team_members_user_id_idx').on(table.userId),
    check('team_members_role_check', sql `${table.role} in ('owner', 'admin', 'member')`),
    check('team_members_site_access_mode_check', sql `${table.siteAccessMode} in ('all', 'selected')`),
]);
/** Explicit grants exist only when the parent membership uses `selected`. */
export const teamMemberSiteGrants = pgTable('team_member_site_grants', {
    teamMemberId: uuid('team_member_id').notNull(),
    siteId: text('site_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    foreignKey({
        columns: [table.teamMemberId],
        foreignColumns: [teamMembers.id],
        name: 'team_member_site_grants_member_fk',
    }).onDelete('cascade'),
    uniqueIndex('team_member_site_grants_member_site_uidx').on(table.teamMemberId, table.siteId),
    index('team_member_site_grants_site_id_idx').on(table.siteId),
]);
export const TEAM_PROVISIONING_STATUSES = ['pending', 'claimed', 'deleting'] as const;
export type TeamProvisioningStatus = (typeof TEAM_PROVISIONING_STATUSES)[number];
/** Provenance guard for identities created solely to receive invitations. */
export const teamProvisionedAccounts = pgTable('team_provisioned_accounts', {
    userId: text('user_id')
        .primaryKey()
        .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    status: text('status', { enum: TEAM_PROVISIONING_STATUSES })
        .notNull()
        .default('pending'),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    temporaryPasswordEncrypted: jsonb('temporary_password_encrypted')
        .$type<EncryptedSecret>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    check('team_provisioned_accounts_status_check', sql `${table.status} in ('pending', 'claimed', 'deleting')`),
]);
export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type NewTeamMemberRow = typeof teamMembers.$inferInsert;
export type TeamMemberSiteGrantRow = typeof teamMemberSiteGrants.$inferSelect;
export type TeamProvisionedAccountRow = typeof teamProvisionedAccounts.$inferSelect;
