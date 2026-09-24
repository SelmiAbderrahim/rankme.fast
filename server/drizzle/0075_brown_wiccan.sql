CREATE TABLE "account_deletion_provider_refs" (
	"provider_ref_hash" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_deletion_tombstones" (
	"account_id" text PRIMARY KEY NOT NULL,
	"deletion_started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_deletion_provider_refs_account_idx" ON "account_deletion_provider_refs" USING btree ("account_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_deleted_account_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  column_name text;
  candidate text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    candidate := to_jsonb(NEW) ->> column_name;
    IF candidate IS NULL OR candidate = '' THEN
      CONTINUE;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext(candidate));
    IF EXISTS (
      SELECT 1 FROM account_deletion_tombstones WHERE account_id = candidate
    ) THEN
      RAISE EXCEPTION 'account deletion has started for %', candidate
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_account_deletion_guard BEFORE INSERT OR UPDATE ON account FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('user_id');
--> statement-breakpoint
CREATE TRIGGER action_events_account_deletion_guard BEFORE INSERT OR UPDATE ON action_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id', 'actor_user_id');
--> statement-breakpoint
CREATE TRIGGER ai_competitor_mentions_account_deletion_guard BEFORE INSERT OR UPDATE ON ai_competitor_mentions FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER ai_mention_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON ai_mention_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER ai_profile_run_events_account_deletion_guard BEFORE INSERT OR UPDATE ON ai_profile_run_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER ai_tracked_prompts_account_deletion_guard BEFORE INSERT OR UPDATE ON ai_tracked_prompts FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER ai_usage_events_account_deletion_guard BEFORE INSERT OR UPDATE ON ai_usage_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER alert_deliveries_account_deletion_guard BEFORE INSERT OR UPDATE ON alert_deliveries FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER alert_rules_account_deletion_guard BEFORE INSERT OR UPDATE ON alert_rules FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER api_keys_account_deletion_guard BEFORE INSERT OR UPDATE ON api_keys FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER audience_research_events_account_deletion_guard BEFORE INSERT OR UPDATE ON audience_research_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER audience_research_signal_decision_events_account_deletion_guard BEFORE INSERT OR UPDATE ON audience_research_signal_decision_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER backlink_deep_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON backlink_deep_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER backlink_row_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON backlink_row_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER backlink_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON backlink_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER billing_checkout_intents_account_deletion_guard BEFORE INSERT OR UPDATE ON billing_checkout_intents FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER billing_customers_account_deletion_guard BEFORE INSERT OR UPDATE ON billing_customers FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER billing_refunds_account_deletion_guard BEFORE INSERT OR UPDATE ON billing_refunds FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER brand_radar_events_account_deletion_guard BEFORE INSERT OR UPDATE ON brand_radar_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER competitor_content_events_account_deletion_guard BEFORE INSERT OR UPDATE ON competitor_content_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER competitor_intersections_account_deletion_guard BEFORE INSERT OR UPDATE ON competitor_intersections FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER competitor_profiles_account_deletion_guard BEFORE INSERT OR UPDATE ON competitor_profiles FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER competitors_account_deletion_guard BEFORE INSERT OR UPDATE ON competitors FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER content_analysis_events_account_deletion_guard BEFORE INSERT OR UPDATE ON content_analysis_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER content_inventory_events_account_deletion_guard BEFORE INSERT OR UPDATE ON content_inventory_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER content_monitor_events_account_deletion_guard BEFORE INSERT OR UPDATE ON content_monitor_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER content_recommendation_events_account_deletion_guard BEFORE INSERT OR UPDATE ON content_recommendation_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id', 'actor_user_id');
--> statement-breakpoint
CREATE TRIGGER content_recommendation_outcomes_account_deletion_guard BEFORE INSERT OR UPDATE ON content_recommendation_outcomes FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER credit_ledger_account_deletion_guard BEFORE INSERT OR UPDATE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER ga4_metrics_account_deletion_guard BEFORE INSERT OR UPDATE ON ga4_metrics FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER geogrid_scans_account_deletion_guard BEFORE INSERT OR UPDATE ON geogrid_scans FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER geogrid_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON geogrid_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER gsc_search_analytics_account_deletion_guard BEFORE INSERT OR UPDATE ON gsc_search_analytics FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER gsc_search_appearance_account_deletion_guard BEFORE INSERT OR UPDATE ON gsc_search_appearance FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER gsc_sitemaps_account_deletion_guard BEFORE INSERT OR UPDATE ON gsc_sitemaps FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER invoices_account_deletion_guard BEFORE INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER keyword_cluster_decision_events_account_deletion_guard BEFORE INSERT OR UPDATE ON keyword_cluster_decision_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER keyword_research_history_account_deletion_guard BEFORE INSERT OR UPDATE ON keyword_research_history FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER keywords_account_deletion_guard BEFORE INSERT OR UPDATE ON keywords FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER link_gap_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON link_gap_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER local_listing_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON local_listing_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER local_pack_rank_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON local_pack_rank_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER local_reviews_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON local_reviews_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER rank_drop_confirmations_account_deletion_guard BEFORE INSERT OR UPDATE ON rank_drop_confirmations FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER rate_limit_hits_account_deletion_guard BEFORE INSERT OR UPDATE ON rate_limit_hits FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER scheduled_report_deliveries_account_deletion_guard BEFORE INSERT OR UPDATE ON scheduled_report_deliveries FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER scheduled_reports_account_deletion_guard BEFORE INSERT OR UPDATE ON scheduled_reports FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER serp_observations_account_deletion_guard BEFORE INSERT OR UPDATE ON serp_observations FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER session_account_deletion_guard BEFORE INSERT OR UPDATE ON session FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('user_id');
--> statement-breakpoint
CREATE TRIGGER site_pulse_settings_account_deletion_guard BEFORE INSERT OR UPDATE ON site_pulse_settings FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER site_pulse_subscriptions_account_deletion_guard BEFORE INSERT OR UPDATE ON site_pulse_subscriptions FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id', 'user_id');
--> statement-breakpoint
CREATE TRIGGER subscription_addons_account_deletion_guard BEFORE INSERT OR UPDATE ON subscription_addons FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER subscriptions_account_deletion_guard BEFORE INSERT OR UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER team_members_account_deletion_guard BEFORE INSERT OR UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('team_id', 'user_id', 'invited_by');
--> statement-breakpoint
CREATE TRIGGER traffic_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON traffic_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER two_factor_account_deletion_guard BEFORE INSERT OR UPDATE ON two_factor FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('user_id');
--> statement-breakpoint
CREATE TRIGGER usage_activity_events_account_deletion_guard BEFORE INSERT OR UPDATE ON usage_activity_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER usage_counters_account_deletion_guard BEFORE INSERT OR UPDATE ON usage_counters FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER user_account_deletion_guard BEFORE INSERT OR UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('id');
--> statement-breakpoint
CREATE TRIGGER vendor_responses_account_deletion_guard BEFORE INSERT OR UPDATE ON vendor_responses FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER weekly_pulse_delivery_events_account_deletion_guard BEFORE INSERT OR UPDATE ON weekly_pulse_delivery_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('user_id');
--> statement-breakpoint
CREATE TRIGGER weekly_pulse_runs_account_deletion_guard BEFORE INSERT OR UPDATE ON weekly_pulse_runs FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
