ALTER TABLE "rankings" ADD COLUMN "ai_overview_present" boolean;--> statement-breakpoint
ALTER TABLE "rankings" ADD COLUMN "ai_cited" boolean;--> statement-breakpoint
ALTER TABLE "rankings" ADD COLUMN "ai_cited_url" text;--> statement-breakpoint
ALTER TABLE "serp_cache" ADD COLUMN "ai_overview" jsonb;