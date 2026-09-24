CREATE TABLE "ai_competitor_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"competitor_domain" text NOT NULL,
	"mentioned" boolean NOT NULL,
	"cited" boolean NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_mention_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"mentioned" boolean NOT NULL,
	"cited_url" text,
	"sentiment" text,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tracked_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"prompt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_metric_check";--> statement-breakpoint
CREATE INDEX "ai_competitor_mentions_site_checked_idx" ON "ai_competitor_mentions" USING btree ("site_id","checked_at");--> statement-breakpoint
CREATE INDEX "ai_mention_snapshots_site_checked_idx" ON "ai_mention_snapshots" USING btree ("site_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_tracked_prompts_site_prompt_idx" ON "ai_tracked_prompts" USING btree ("site_id","prompt");--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_metric_check" CHECK ("usage_counters"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups'));