import { and, eq, inArray, sql } from 'drizzle-orm';
import { actionEvents, aiCompetitorMentions, aiMentionSnapshots, aiProfileRunEvents, aiPromptSuggestionRuns, aiTrackedPrompts, aiUsageEvents, alertDeliveries, alertRules, appChartSnapshots, appKeywords, appListingSnapshots, appRankSnapshots, audienceResearchEvents, audienceResearchSignalDecisionEvents, backlinkDeepSnapshots, backlinkRowSnapshots, backlinkSnapshots, brandRadarEvents, competitorContentEvents, competitorIntersections, competitorProfiles, competitors, contentAnalysisEvents, contentInventoryEvents, contentMonitorEvents, contentRecommendationEvents, contentRecommendationOutcomes, domainStates, ga4Metrics, geogridScans, geogridSnapshots, gscSearchAnalytics, gscSearchAppearance, gscSitemaps, gscSyncRuns, keywordClusterDecisionEvents, keywords, landscapeOpportunityAcceptances, landscapePageMatchReviews, linkGapSnapshots, localListingSnapshots, localPackRankSnapshots, localReviewsSnapshots, pagePerformanceKeywords, pagePerformanceSnapshots, rankDropConfirmations, scheduledReportDeliveries, scheduledReports, serpObservations, siteDeletionTombstones, sitePulseSettings, sitePulseSubscriptions, teamMemberSiteGrants, trafficSnapshots, vendorCache, vendorResponses, weeklyPulseRuns, } from '../../db/schema/index.js';
import type { MongoSiteResourceInventory } from './site-mongo-cascade.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';
/**
 * Test-ratcheted inventory of every current table that directly owns a
 * `site_id`. The order below is also the delete order: children precede the
 * parent rows they reference.
 */
export const SITE_SCOPED_POSTGRES_TABLE_NAMES = [
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
    'audience_research_signal_decision_events',
    'backlink_deep_snapshots',
    'backlink_row_snapshots',
    'backlink_snapshots',
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
    'geogrid_snapshots',
    'geogrid_scans',
    'gsc_search_analytics',
    'gsc_search_appearance',
    'gsc_sitemaps',
    'gsc_sync_runs',
    'keyword_cluster_decision_events',
    'landscape_opportunity_acceptances',
    'landscape_page_match_reviews',
    'link_gap_snapshots',
    'local_listing_snapshots',
    'local_pack_rank_snapshots',
    'local_reviews_snapshots',
    'page_performance_keywords',
    'page_performance_snapshots',
    'rank_drop_confirmations',
    'scheduled_report_deliveries',
    'scheduled_report_runs',
    'scheduled_reports',
    'serp_observations',
    'site_pulse_subscriptions',
    'site_pulse_settings',
    'team_member_site_grants',
    'traffic_snapshots',
    'vendor_cache',
    'vendor_responses',
    'weekly_pulse_runs',
    'keywords',
    'domain_states',
] as const;
/** Rows linked through a site-owned Mongo workflow id rather than site_id. */
export const SITE_INDIRECT_POSTGRES_TABLE_NAMES = [
    'audience_research_events',
    'brand_radar_events',
] as const;
/**
 * Commits the Postgres side of the deletion barrier before cleanup starts.
 * Every site-scoped INSERT/UPDATE trigger takes this same advisory xact lock;
 * therefore a writer either commits before this function (and is purged by
 * the later transaction) or observes the tombstone and is rejected.
 */
export async function installSiteDeletionBarrier(db: ApplicationDb, siteId: string, deletionStartedAt: Date): Promise<void> {
    await db.transaction(async (tx) => {
        await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${siteId}))`);
        await tx
            .insert(siteDeletionTombstones)
            .values({ siteId, deletionStartedAt })
            .onConflictDoNothing({ target: siteDeletionTombstones.siteId });
    });
}
/** Deletes every current direct site row in one all-or-nothing transaction. */
export async function purgeSitePostgresData(db: ApplicationDb, accountId: string, siteId: string, mongo?: MongoSiteResourceInventory): Promise<void> {
    await db.transaction(async (tx) => {
        // Serializes two retrying deletes and documents the same ordering domain
        // used by the write-rejection triggers.
        await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${siteId}))`);
        const audienceRunIds = [...(mongo?.idsByModel.get('AudienceResearchRun') ?? [])];
        if (audienceRunIds.length > 0) {
            await tx
                .delete(audienceResearchEvents)
                .where(inArray(audienceResearchEvents.runId, audienceRunIds));
        }
        const brandScanIds = [...(mongo?.idsByModel.get('BrandRadarScan') ?? [])];
        if (brandScanIds.length > 0) {
            await tx.delete(brandRadarEvents).where(inArray(brandRadarEvents.scanId, brandScanIds));
        }
        await tx.delete(actionEvents).where(eq(actionEvents.siteId, siteId));
        await tx.delete(aiCompetitorMentions).where(eq(aiCompetitorMentions.siteId, siteId));
        await tx.delete(aiMentionSnapshots).where(eq(aiMentionSnapshots.siteId, siteId));
        await tx.delete(aiProfileRunEvents).where(eq(aiProfileRunEvents.siteId, siteId));
        await tx
            .delete(aiPromptSuggestionRuns)
            .where(eq(aiPromptSuggestionRuns.siteId, siteId));
        await tx.delete(aiTrackedPrompts).where(eq(aiTrackedPrompts.siteId, siteId));
        await tx.delete(aiUsageEvents).where(eq(aiUsageEvents.siteId, siteId));
        await tx.delete(alertDeliveries).where(eq(alertDeliveries.siteId, siteId));
        await tx.delete(alertRules).where(eq(alertRules.siteId, siteId));
        await tx
            .delete(appRankSnapshots)
            .where(and(eq(appRankSnapshots.accountId, accountId), eq(appRankSnapshots.siteId, siteId)));
        await tx
            .delete(appChartSnapshots)
            .where(and(eq(appChartSnapshots.accountId, accountId), eq(appChartSnapshots.siteId, siteId)));
        await tx
            .delete(appListingSnapshots)
            .where(and(eq(appListingSnapshots.accountId, accountId), eq(appListingSnapshots.siteId, siteId)));
        await tx
            .delete(appKeywords)
            .where(and(eq(appKeywords.accountId, accountId), eq(appKeywords.siteId, siteId)));
        await tx
            .delete(audienceResearchSignalDecisionEvents)
            .where(eq(audienceResearchSignalDecisionEvents.siteId, siteId));
        await tx.delete(backlinkDeepSnapshots).where(eq(backlinkDeepSnapshots.siteId, siteId));
        await tx.delete(backlinkRowSnapshots).where(eq(backlinkRowSnapshots.siteId, siteId));
        await tx.delete(backlinkSnapshots).where(eq(backlinkSnapshots.siteId, siteId));
        await tx.delete(competitorContentEvents).where(eq(competitorContentEvents.siteId, siteId));
        await tx.delete(competitorIntersections).where(eq(competitorIntersections.siteId, siteId));
        await tx.delete(competitorProfiles).where(eq(competitorProfiles.siteId, siteId));
        await tx.delete(competitors).where(eq(competitors.siteId, siteId));
        await tx.delete(contentAnalysisEvents).where(eq(contentAnalysisEvents.siteId, siteId));
        await tx.delete(contentInventoryEvents).where(eq(contentInventoryEvents.siteId, siteId));
        await tx.delete(contentMonitorEvents).where(eq(contentMonitorEvents.siteId, siteId));
        await tx
            .delete(contentRecommendationEvents)
            .where(eq(contentRecommendationEvents.siteId, siteId));
        await tx
            .delete(contentRecommendationOutcomes)
            .where(eq(contentRecommendationOutcomes.siteId, siteId));
        await tx.delete(ga4Metrics).where(eq(ga4Metrics.siteId, siteId));
        await tx.delete(geogridSnapshots).where(eq(geogridSnapshots.siteId, siteId));
        await tx.delete(geogridScans).where(eq(geogridScans.siteId, siteId));
        await tx.delete(gscSearchAnalytics).where(and(eq(gscSearchAnalytics.accountId, accountId), eq(gscSearchAnalytics.siteId, siteId)));
        await tx.delete(gscSearchAppearance).where(eq(gscSearchAppearance.siteId, siteId));
        await tx.delete(gscSitemaps).where(and(eq(gscSitemaps.accountId, accountId), eq(gscSitemaps.siteId, siteId)));
        await tx.delete(gscSyncRuns).where(and(eq(gscSyncRuns.accountId, accountId), eq(gscSyncRuns.siteId, siteId)));
        await tx
            .delete(keywordClusterDecisionEvents)
            .where(eq(keywordClusterDecisionEvents.siteId, siteId));
        await tx
            .delete(landscapeOpportunityAcceptances)
            .where(eq(landscapeOpportunityAcceptances.siteId, siteId));
        await tx
            .delete(landscapePageMatchReviews)
            .where(eq(landscapePageMatchReviews.siteId, siteId));
        await tx.delete(linkGapSnapshots).where(eq(linkGapSnapshots.siteId, siteId));
        await tx.delete(localListingSnapshots).where(eq(localListingSnapshots.siteId, siteId));
        await tx.delete(localPackRankSnapshots).where(eq(localPackRankSnapshots.siteId, siteId));
        await tx.delete(localReviewsSnapshots).where(eq(localReviewsSnapshots.siteId, siteId));
        await tx
            .delete(pagePerformanceKeywords)
            .where(and(eq(pagePerformanceKeywords.accountId, accountId), eq(pagePerformanceKeywords.siteId, siteId)));
        await tx
            .delete(pagePerformanceSnapshots)
            .where(and(eq(pagePerformanceSnapshots.accountId, accountId), eq(pagePerformanceSnapshots.siteId, siteId)));
        await tx.delete(rankDropConfirmations).where(eq(rankDropConfirmations.siteId, siteId));
        await tx
            .delete(scheduledReportDeliveries)
            .where(eq(scheduledReportDeliveries.siteId, siteId));
        await tx.delete(scheduledReports).where(eq(scheduledReports.siteId, siteId));
        await tx.delete(serpObservations).where(eq(serpObservations.siteId, siteId));
        await tx
            .delete(sitePulseSubscriptions)
            .where(eq(sitePulseSubscriptions.siteId, siteId));
        await tx.delete(sitePulseSettings).where(eq(sitePulseSettings.siteId, siteId));
        await tx
            .delete(teamMemberSiteGrants)
            .where(eq(teamMemberSiteGrants.siteId, siteId));
        await tx.delete(trafficSnapshots).where(eq(trafficSnapshots.siteId, siteId));
        await tx.delete(vendorCache).where(eq(vendorCache.siteId, siteId));
        await tx.delete(vendorResponses).where(eq(vendorResponses.siteId, siteId));
        // Child pulse citations/deliveries/projections cascade from the run.
        await tx.delete(weeklyPulseRuns).where(eq(weeklyPulseRuns.siteId, siteId));
        // Rankings and remaining keyword children cascade from keywords.
        await tx.delete(keywords).where(eq(keywords.siteId, siteId));
        await tx.delete(domainStates).where(eq(domainStates.siteId, siteId));
    });
}
