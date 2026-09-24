CREATE TABLE "site_deletion_tombstones" (
	"site_id" text PRIMARY KEY NOT NULL,
	"deletion_started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_deleted_site_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.site_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.site_id));
  IF EXISTS (
    SELECT 1 FROM site_deletion_tombstones WHERE site_id = NEW.site_id
  ) THEN
    RAISE EXCEPTION 'site deletion has started for %', NEW.site_id
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER action_events_site_deletion_guard BEFORE INSERT OR UPDATE ON action_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER ai_competitor_mentions_site_deletion_guard BEFORE INSERT OR UPDATE ON ai_competitor_mentions FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER ai_mention_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON ai_mention_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER ai_profile_run_events_site_deletion_guard BEFORE INSERT OR UPDATE ON ai_profile_run_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER ai_tracked_prompts_site_deletion_guard BEFORE INSERT OR UPDATE ON ai_tracked_prompts FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER ai_usage_events_site_deletion_guard BEFORE INSERT OR UPDATE ON ai_usage_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER alert_deliveries_site_deletion_guard BEFORE INSERT OR UPDATE ON alert_deliveries FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER alert_rules_site_deletion_guard BEFORE INSERT OR UPDATE ON alert_rules FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER audience_research_signal_decision_events_site_deletion_guard BEFORE INSERT OR UPDATE ON audience_research_signal_decision_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER backlink_deep_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON backlink_deep_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER backlink_row_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON backlink_row_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER backlink_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON backlink_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER competitor_content_events_site_deletion_guard BEFORE INSERT OR UPDATE ON competitor_content_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER competitor_intersections_site_deletion_guard BEFORE INSERT OR UPDATE ON competitor_intersections FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER competitor_profiles_site_deletion_guard BEFORE INSERT OR UPDATE ON competitor_profiles FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER competitors_site_deletion_guard BEFORE INSERT OR UPDATE ON competitors FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER content_analysis_events_site_deletion_guard BEFORE INSERT OR UPDATE ON content_analysis_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER content_inventory_events_site_deletion_guard BEFORE INSERT OR UPDATE ON content_inventory_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER content_monitor_events_site_deletion_guard BEFORE INSERT OR UPDATE ON content_monitor_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER content_recommendation_events_site_deletion_guard BEFORE INSERT OR UPDATE ON content_recommendation_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER content_recommendation_outcomes_site_deletion_guard BEFORE INSERT OR UPDATE ON content_recommendation_outcomes FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER ga4_metrics_site_deletion_guard BEFORE INSERT OR UPDATE ON ga4_metrics FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER geogrid_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON geogrid_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER geogrid_scans_site_deletion_guard BEFORE INSERT OR UPDATE ON geogrid_scans FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER gsc_search_analytics_site_deletion_guard BEFORE INSERT OR UPDATE ON gsc_search_analytics FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER gsc_search_appearance_site_deletion_guard BEFORE INSERT OR UPDATE ON gsc_search_appearance FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER gsc_sitemaps_site_deletion_guard BEFORE INSERT OR UPDATE ON gsc_sitemaps FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER keyword_cluster_decision_events_site_deletion_guard BEFORE INSERT OR UPDATE ON keyword_cluster_decision_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER link_gap_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON link_gap_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER local_listing_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON local_listing_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER local_pack_rank_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON local_pack_rank_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER local_reviews_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON local_reviews_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER rank_drop_confirmations_site_deletion_guard BEFORE INSERT OR UPDATE ON rank_drop_confirmations FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER scheduled_report_deliveries_site_deletion_guard BEFORE INSERT OR UPDATE ON scheduled_report_deliveries FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER scheduled_reports_site_deletion_guard BEFORE INSERT OR UPDATE ON scheduled_reports FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER serp_observations_site_deletion_guard BEFORE INSERT OR UPDATE ON serp_observations FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER site_pulse_subscriptions_site_deletion_guard BEFORE INSERT OR UPDATE ON site_pulse_subscriptions FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER site_pulse_settings_site_deletion_guard BEFORE INSERT OR UPDATE ON site_pulse_settings FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER traffic_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON traffic_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER weekly_pulse_runs_site_deletion_guard BEFORE INSERT OR UPDATE ON weekly_pulse_runs FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER keywords_site_deletion_guard BEFORE INSERT OR UPDATE ON keywords FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
--> statement-breakpoint
CREATE TRIGGER domain_states_site_deletion_guard BEFORE INSERT OR UPDATE ON domain_states FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
