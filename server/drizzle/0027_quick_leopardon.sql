CREATE TABLE "local_listing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"consistent" boolean NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_pack_rank_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"keyword_id" text NOT NULL,
	"position" integer,
	"total_pack_size" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_reviews_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"average_rating" real,
	"review_count" integer NOT NULL,
	"unanswered_question_count" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_counters" DROP CONSTRAINT "usage_counters_metric_check";--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "track_local_pack" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "local_listing_snapshots_site_date_source_idx" ON "local_listing_snapshots" USING btree ("site_id","snapshot_date","source");--> statement-breakpoint
CREATE INDEX "local_pack_rank_snapshots_site_keyword_idx" ON "local_pack_rank_snapshots" USING btree ("site_id","keyword_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "local_reviews_snapshots_site_date_idx" ON "local_reviews_snapshots" USING btree ("site_id","snapshot_date");--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_metric_check" CHECK ("usage_counters"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks'));--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT IF EXISTS "credit_ledger_metric_check";--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_metric_check" CHECK ("credit_ledger"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks'));