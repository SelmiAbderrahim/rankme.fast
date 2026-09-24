CREATE TABLE "audience_research_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"reservation_key" text NOT NULL,
	"kind" text NOT NULL,
	"units" bigint DEFAULT 1 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_research_events_kind_check" CHECK ("audience_research_events"."kind" in ('reserved', 'consumed', 'refunded')),
	CONSTRAINT "audience_research_events_units_nonneg_check" CHECK ("audience_research_events"."units" >= 0),
	CONSTRAINT "audience_research_events_cost_nonneg_check" CHECK ("audience_research_events"."cost_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_metric_check";--> statement-breakpoint
ALTER TABLE "usage_activity_events" DROP CONSTRAINT "usage_activity_events_metric_check";--> statement-breakpoint
ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_metric_check";--> statement-breakpoint
CREATE UNIQUE INDEX "audience_research_events_reservation_kind_uidx" ON "audience_research_events" USING btree ("reservation_key","kind");--> statement-breakpoint
CREATE INDEX "audience_research_events_run_created_idx" ON "audience_research_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "audience_research_events_account_created_idx" ON "audience_research_events" USING btree ("account_id","created_at");--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_metric_check" CHECK ("credit_ledger"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs'));--> statement-breakpoint
ALTER TABLE "usage_activity_events" ADD CONSTRAINT "usage_activity_events_metric_check" CHECK ("usage_activity_events"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs'));--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_metric_check" CHECK ("usage_counters"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs'));