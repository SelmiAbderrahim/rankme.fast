CREATE TABLE "content_analysis_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"reservation_key" text NOT NULL,
	"kind" text NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"ai_cost_micros" bigint DEFAULT 0 NOT NULL,
	"error_category" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_analysis_events_kind_check" CHECK ("content_analysis_events"."kind" in ('reserved', 'refunded', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "content_analysis_events_units_nonneg_check" CHECK ("content_analysis_events"."units" >= 0),
	CONSTRAINT "content_analysis_events_cost_nonneg_check" CHECK ("content_analysis_events"."cost_micros" >= 0 and "content_analysis_events"."ai_cost_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_metric_check";--> statement-breakpoint
ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_metric_check";--> statement-breakpoint
CREATE UNIQUE INDEX "content_analysis_events_reservation_kind_uidx" ON "content_analysis_events" USING btree ("reservation_key","kind");--> statement-breakpoint
CREATE INDEX "content_analysis_events_account_recorded_idx" ON "content_analysis_events" USING btree ("account_id","recorded_at");--> statement-breakpoint
CREATE INDEX "content_analysis_events_site_recorded_idx" ON "content_analysis_events" USING btree ("site_id","recorded_at");--> statement-breakpoint
CREATE INDEX "content_analysis_events_analysis_idx" ON "content_analysis_events" USING btree ("analysis_id");--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_metric_check" CHECK ("credit_ledger"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses'));--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_metric_check" CHECK ("usage_counters"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses'));