CREATE TABLE "competitor_content_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_id" text NOT NULL,
	"reservation_key" text NOT NULL,
	"kind" text NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"ai_cost_micros" bigint DEFAULT 0 NOT NULL,
	"error_category" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_content_events_kind_check" CHECK ("competitor_content_events"."kind" in ('reserved', 'refunded', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "competitor_content_events_units_nonneg_check" CHECK ("competitor_content_events"."units" >= 0),
	CONSTRAINT "competitor_content_events_cost_nonneg_check" CHECK ("competitor_content_events"."cost_micros" >= 0 and "competitor_content_events"."ai_cost_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "competitor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"origin" text NOT NULL,
	"registrable_domain" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_profiles_source_check" CHECK ("competitor_profiles"."source" in ('suggested', 'manual')),
	CONSTRAINT "competitor_profiles_status_check" CHECK ("competitor_profiles"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_metric_check";--> statement-breakpoint
ALTER TABLE "usage_activity_events" DROP CONSTRAINT "usage_activity_events_metric_check";--> statement-breakpoint
ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_metric_check";--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_content_events_reservation_kind_uidx" ON "competitor_content_events" USING btree ("reservation_key","kind");--> statement-breakpoint
CREATE INDEX "competitor_content_events_account_recorded_idx" ON "competitor_content_events" USING btree ("account_id","recorded_at");--> statement-breakpoint
CREATE INDEX "competitor_content_events_site_recorded_idx" ON "competitor_content_events" USING btree ("site_id","recorded_at");--> statement-breakpoint
CREATE INDEX "competitor_content_events_run_idx" ON "competitor_content_events" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_profiles_site_domain_uq" ON "competitor_profiles" USING btree ("site_id","registrable_domain");--> statement-breakpoint
CREATE INDEX "competitor_profiles_account_idx" ON "competitor_profiles" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "competitor_profiles_site_status_idx" ON "competitor_profiles" USING btree ("site_id","status");--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_metric_check" CHECK ("credit_ledger"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs', 'content_inventory_page_blocks', 'competitor_content_runs'));--> statement-breakpoint
ALTER TABLE "usage_activity_events" ADD CONSTRAINT "usage_activity_events_metric_check" CHECK ("usage_activity_events"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs', 'content_inventory_page_blocks', 'competitor_content_runs'));--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_metric_check" CHECK ("usage_counters"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs', 'content_inventory_page_blocks', 'competitor_content_runs'));