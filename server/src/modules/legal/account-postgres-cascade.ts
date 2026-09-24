import { and, eq, getTableColumns, getTableName, isNull, ne, or, sql, type AnyColumn, type SQL, } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema/index.js';
import { actionEvents, contentRecommendationEvents, landscapeOpportunityAcceptances, landscapePageMatchReviews, teamMembers, verification, } from '../../db/schema/index.js';
import { deletedAccountPseudonym } from '../../shared/account-deletion/postgres.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';
export const ACCOUNT_RETAINED_POSTGRES_TABLE_NAMES = [
    'account_deletion_provider_refs',
    'account_deletion_tombstones',
] as const;
/** Every current table with direct account/user ownership that is erased. */
export const ACCOUNT_ERASED_POSTGRES_TABLE_NAMES = [
    'account',
    'action_events',
    'ai_competitor_mentions',
    'ai_mention_snapshots',
    'ai_profile_run_events',
    'ai_prompt_suggestion_runs',
    'ai_tracked_prompts',
    'ai_usage_events',
    'alert_deliveries',
    'alert_rules',
    'app_rank_snapshots',
    'app_chart_snapshots',
    'app_listing_snapshots',
    'app_keywords',
    'api_keys',
    'audience_research_events',
    'audience_research_signal_decision_events',
    'backlink_deep_snapshots',
    'backlink_row_snapshots',
    'backlink_snapshots',
    'brand_radar_events',
    'competitor_content_events',
    'competitor_intersections',
    'competitor_profiles',
    'competitors',
    'content_analysis_events',
    'content_inventory_events',
    'content_monitor_events',
    'content_recommendation_events',
    'content_recommendation_outcomes',
    'ga4_metrics',
    'geogrid_scans',
    'geogrid_snapshots',
    'gsc_search_analytics',
    'gsc_search_appearance',
    'gsc_sitemaps',
    'gsc_sync_runs',
    'keyword_cluster_decision_events',
    'keyword_research_history',
    'keywords',
    'landscape_opportunity_acceptances',
    'landscape_page_match_reviews',
    'link_gap_snapshots',
    'local_listing_snapshots',
    'local_pack_rank_snapshots',
    'local_reviews_snapshots',
    'page_performance_keywords',
    'page_performance_snapshots',
    'rank_drop_confirmations',
    'rate_limit_hits',
    'scheduled_report_deliveries',
    'scheduled_report_runs',
    'scheduled_reports',
    'serp_observations',
    'session',
    'site_pulse_settings',
    'site_pulse_subscriptions',
    'team_members',
    'team_provisioned_accounts',
    'traffic_snapshots',
    'two_factor',
    'user',
    'vendor_cache',
    'vendor_responses',
    'weekly_pulse_delivery_events',
    'weekly_pulse_runs',
] as const;
interface RuntimeTable {
    name: string;
    table: AnyPgTable;
    columns: Record<string, AnyColumn>;
}
function accountOwnedTables(): RuntimeTable[] {
    const found = new Map<string, RuntimeTable>();
    for (const value of Object.values(schema)) {
        if (!value || typeof value !== 'object')
            continue;
        try {
            const table = value as AnyPgTable;
            const columns = getTableColumns(table) as Record<string, AnyColumn>;
            const name = getTableName(table);
            if (columns.accountId?.name === 'account_id' ||
                columns.userId?.name === 'user_id' ||
                columns.teamId?.name === 'team_id' ||
                columns.actorUserId?.name === 'actor_user_id' ||
                name === 'user') {
                found.set(name, { name, table, columns });
            }
        }
        catch {
            // Constants, enums, relations, and type-only exports are not tables.
        }
    }
    return [...found.values()].sort((left, right) => left.name.localeCompare(right.name));
}
/** Schema ratchet helper used by tests. */
export function registeredAccountOwnedPostgresTableNames(): string[] {
    return accountOwnedTables().map((entry) => entry.name);
}
function requiredColumn(entry: RuntimeTable, name: string): AnyColumn {
    const column = entry.columns[name];
    if (!column)
        throw new Error(`account purge column ${name} is missing from ${entry.name}`);
    return column;
}
function deletionPredicate(entry: RuntimeTable, accountId: string): SQL {
    if (entry.name === 'user')
        return eq(requiredColumn(entry, 'id'), accountId);
    if (entry.name === 'account')
        return eq(requiredColumn(entry, 'userId'), accountId);
    if (entry.name === 'team_members') {
        return or(eq(requiredColumn(entry, 'teamId'), accountId), eq(requiredColumn(entry, 'userId'), accountId))!;
    }
    const predicates: SQL[] = [];
    const accountColumn = entry.columns.accountId;
    const userColumn = entry.columns.userId;
    if (accountColumn)
        predicates.push(eq(accountColumn, accountId));
    if (userColumn)
        predicates.push(eq(userColumn, accountId));
    if (predicates.length === 0) {
        throw new Error(`account purge has no ownership predicate for ${entry.name}`);
    }
    return predicates.length === 1 ? predicates[0]! : or(...predicates)!;
}
function requiredRegisteredTable(byName: ReadonlyMap<string, RuntimeTable>, name: string): RuntimeTable {
    const entry = byName.get(name);
    if (!entry)
        throw new Error(`account purge table is not registered: ${name}`);
    return entry;
}
/**
 * Erases all product/identity rows. Other-account rows that merely name this user as an actor are
 * preserved with their actor/inviter pseudonymized.
 */
export async function purgeAccountPostgresData(db: ApplicationDb, input: {
    accountId: string;
    email: string;
}): Promise<number> {
    const pseudonym = deletedAccountPseudonym(input.accountId);
    const normalizedEmail = input.email.trim().toLowerCase();
    return db.transaction(async (tx) => {
        await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${input.accountId}))`);
        let changed = 0;
        const crossAccountActions = await tx
            .update(actionEvents)
            .set({ actorUserId: pseudonym })
            .where(and(eq(actionEvents.actorUserId, input.accountId), ne(actionEvents.accountId, input.accountId)))
            .returning({ id: actionEvents.id });
        changed += crossAccountActions.length;
        const crossAccountLandscapeAcceptances = await tx
            .update(landscapeOpportunityAcceptances)
            .set({ acceptedByUserId: pseudonym })
            .where(and(eq(landscapeOpportunityAcceptances.acceptedByUserId, input.accountId), ne(landscapeOpportunityAcceptances.accountId, input.accountId)))
            .returning({ id: landscapeOpportunityAcceptances.id });
        changed += crossAccountLandscapeAcceptances.length;
        const crossAccountLandscapeReviews = await tx
            .update(landscapePageMatchReviews)
            .set({ reviewedByUserId: pseudonym })
            .where(and(eq(landscapePageMatchReviews.reviewedByUserId, input.accountId), ne(landscapePageMatchReviews.accountId, input.accountId)))
            .returning({ id: landscapePageMatchReviews.id });
        changed += crossAccountLandscapeReviews.length;
        const crossAccountRecommendations = await tx
            .update(contentRecommendationEvents)
            .set({ actorUserId: pseudonym })
            .where(and(eq(contentRecommendationEvents.actorUserId, input.accountId), ne(contentRecommendationEvents.accountId, input.accountId)))
            .returning({ id: contentRecommendationEvents.id });
        changed += crossAccountRecommendations.length;
        // Pending invites are bearer credentials addressed to an identity by
        // email before a Better Auth user id exists. Erase every case/whitespace
        // variant for the deleted identity, while leaving accepted memberships
        // alone unless their bound `userId` is the account being deleted (the
        // ordinary ownership cascade below handles that relationship).
        const pendingIdentityInvites = await tx
            .delete(teamMembers)
            .where(and(isNull(teamMembers.acceptedAt), sql `lower(btrim(${teamMembers.email})) = ${normalizedEmail}`))
            .returning({ id: teamMembers.id });
        changed += pendingIdentityInvites.length;
        const crossAccountInvites = await tx
            .update(teamMembers)
            .set({ invitedBy: pseudonym })
            .where(and(eq(teamMembers.invitedBy, input.accountId), ne(teamMembers.teamId, input.accountId), or(ne(teamMembers.userId, input.accountId), sql `${teamMembers.userId} is null`)))
            .returning({ id: teamMembers.id });
        changed += crossAccountInvites.length;
        const byName = new Map(accountOwnedTables().map((entry) => [entry.name, entry]));
        for (const name of ACCOUNT_ERASED_POSTGRES_TABLE_NAMES) {
            const entry = requiredRegisteredTable(byName, name);
            const rows = await tx
                .delete(entry.table)
                .where(deletionPredicate(entry, input.accountId))
                .returning();
            changed += rows.length;
        }
        const verifications = await tx
            .delete(verification)
            .where(or(eq(verification.value, input.accountId), sql `lower(btrim(${verification.identifier})) = ${normalizedEmail}`))
            .returning({ id: verification.id });
        changed += verifications.length;
        return changed;
    });
}
export const accountPostgresCascadeTestables = Object.freeze({
    requiredColumn,
    deletionPredicate,
    requiredRegisteredTable,
});
