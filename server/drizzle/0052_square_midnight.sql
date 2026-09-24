CREATE TABLE "content_monitor_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"monitor_id" text NOT NULL,
	"check_id" text,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"iso_week" text,
	"units" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_monitor_events_kind_check" CHECK ("content_monitor_events"."kind" in ('check_reserved', 'check_completed', 'change_detected', 'check_failed', 'cap_paused')),
	CONSTRAINT "content_monitor_events_units_nonneg_check" CHECK ("content_monitor_events"."units" >= 0),
	CONSTRAINT "content_monitor_events_cost_nonneg_check" CHECK ("content_monitor_events"."cost_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_metric_check";--> statement-breakpoint
CREATE UNIQUE INDEX "content_monitor_events_monitor_eventkey_uidx" ON "content_monitor_events" USING btree ("monitor_id","event_key");--> statement-breakpoint
CREATE INDEX "content_monitor_events_account_recorded_idx" ON "content_monitor_events" USING btree ("account_id","recorded_at");--> statement-breakpoint
CREATE INDEX "content_monitor_events_monitor_recorded_idx" ON "content_monitor_events" USING btree ("monitor_id","recorded_at");--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_metric_check" CHECK ("usage_counters"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs', 'content_inventory_page_blocks', 'competitor_content_runs', 'content_monitor_checks'));