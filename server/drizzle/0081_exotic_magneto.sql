CREATE TABLE "ai_prompt_suggestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prompts" jsonb NOT NULL,
	"seeds" jsonb NOT NULL,
	"generator" text NOT NULL,
	"model" text,
	CONSTRAINT "ai_prompt_suggestion_runs_prompts_check" CHECK (jsonb_typeof("ai_prompt_suggestion_runs"."prompts") = 'array' and jsonb_array_length("ai_prompt_suggestion_runs"."prompts") <= 8),
	CONSTRAINT "ai_prompt_suggestion_runs_seeds_size_check" CHECK (jsonb_typeof("ai_prompt_suggestion_runs"."seeds") = 'object' and octet_length("ai_prompt_suggestion_runs"."seeds"::text) between 2 and 32768),
	CONSTRAINT "ai_prompt_suggestion_runs_generator_check" CHECK ("ai_prompt_suggestion_runs"."generator" in ('ai', 'template')),
	CONSTRAINT "ai_prompt_suggestion_runs_model_shape_check" CHECK (("ai_prompt_suggestion_runs"."generator" = 'ai' and "ai_prompt_suggestion_runs"."model" is not null) or ("ai_prompt_suggestion_runs"."generator" = 'template' and "ai_prompt_suggestion_runs"."model" is null))
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_metric_check";--> statement-breakpoint
ALTER TABLE "usage_activity_events" DROP CONSTRAINT "usage_activity_events_metric_check";--> statement-breakpoint
ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_metric_check";--> statement-breakpoint
CREATE INDEX "ai_prompt_suggestion_runs_account_site_generated_idx" ON "ai_prompt_suggestion_runs" USING btree ("account_id","site_id","generated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_metric_check" CHECK ("credit_ledger"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs', 'content_inventory_page_blocks', 'competitor_content_runs', 'content_monitor_checks', 'trend_explorations', 'traffic_snapshots', 'link_intel_checks', 'review_syncs', 'brand_mention_scans', 'keyword_cluster_runs', 'cannibalization_reports', 'alt_engine_checks', 'toxicity_reviews', 'internal_link_runs', 'content_briefs', 'geogrid_scans', 'schema_generations', 'ai_chat_messages', 'ai_visibility_suggestion_runs'));--> statement-breakpoint
ALTER TABLE "usage_activity_events" ADD CONSTRAINT "usage_activity_events_metric_check" CHECK ("usage_activity_events"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs', 'content_inventory_page_blocks', 'competitor_content_runs', 'content_monitor_checks', 'trend_explorations', 'traffic_snapshots', 'link_intel_checks', 'review_syncs', 'brand_mention_scans', 'keyword_cluster_runs', 'cannibalization_reports', 'alt_engine_checks', 'toxicity_reviews', 'internal_link_runs', 'content_briefs', 'geogrid_scans', 'schema_generations', 'ai_chat_messages', 'ai_visibility_suggestion_runs'));--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_metric_check" CHECK ("usage_counters"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs', 'content_inventory_page_blocks', 'competitor_content_runs', 'content_monitor_checks', 'trend_explorations', 'traffic_snapshots', 'link_intel_checks', 'review_syncs', 'brand_mention_scans', 'keyword_cluster_runs', 'cannibalization_reports', 'alt_engine_checks', 'toxicity_reviews', 'internal_link_runs', 'content_briefs', 'geogrid_scans', 'schema_generations', 'ai_chat_messages', 'ai_visibility_suggestion_runs'));--> statement-breakpoint
CREATE TRIGGER ai_prompt_suggestion_runs_site_deletion_guard BEFORE INSERT OR UPDATE ON ai_prompt_suggestion_runs FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER ai_prompt_suggestion_runs_account_deletion_guard BEFORE INSERT OR UPDATE ON ai_prompt_suggestion_runs FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');