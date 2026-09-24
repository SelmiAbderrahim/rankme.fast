CREATE TABLE "competitor_intersections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"account_id" text NOT NULL,
	"competitor_domain" text NOT NULL,
	"keywords" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_metric_check";--> statement-breakpoint
CREATE INDEX "competitor_intersections_lookup_idx" ON "competitor_intersections" USING btree ("site_id","competitor_domain","fetched_at");--> statement-breakpoint
CREATE INDEX "competitor_intersections_account_idx" ON "competitor_intersections" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_metric_check" CHECK ("usage_counters"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups'));
