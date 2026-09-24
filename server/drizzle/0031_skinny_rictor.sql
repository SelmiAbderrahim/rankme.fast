CREATE TABLE "ga4_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"window_days" integer DEFAULT 28 NOT NULL,
	"dimension_set" text NOT NULL,
	"dimension_key" text NOT NULL,
	"sessions" integer NOT NULL,
	"active_users" integer NOT NULL,
	"engaged_sessions" integer NOT NULL,
	"key_events" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "gsc_search_analytics_site_date_dim_key_idx";--> statement-breakpoint
ALTER TABLE "gsc_search_analytics" ADD COLUMN "window_days" integer DEFAULT 28 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ga4_metrics_site_date_dim_window_key_idx" ON "ga4_metrics" USING btree ("site_id","snapshot_date","dimension_set","window_days","dimension_key");--> statement-breakpoint
CREATE INDEX "ga4_metrics_site_dim_date_idx" ON "ga4_metrics" USING btree ("site_id","dimension_set","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_search_analytics_site_date_dim_key_idx" ON "gsc_search_analytics" USING btree ("site_id","snapshot_date","dimension_set","window_days","dimension_key");