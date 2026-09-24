CREATE TABLE "gsc_search_analytics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"dimension_set" text NOT NULL,
	"dimension_key" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" real NOT NULL,
	"position" real NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_sitemaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"last_submitted" timestamp with time zone,
	"last_downloaded" timestamp with time zone,
	"is_pending" boolean NOT NULL,
	"is_sitemaps_index" boolean NOT NULL,
	"errors" integer NOT NULL,
	"warnings" integer NOT NULL,
	"processed" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_search_analytics_site_date_dim_key_idx" ON "gsc_search_analytics" USING btree ("site_id","snapshot_date","dimension_set","dimension_key");
--> statement-breakpoint
CREATE INDEX "gsc_search_analytics_site_dim_date_idx" ON "gsc_search_analytics" USING btree ("site_id","dimension_set","snapshot_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_sitemaps_site_date_path_idx" ON "gsc_sitemaps" USING btree ("site_id","snapshot_date","path");
--> statement-breakpoint
CREATE INDEX "gsc_sitemaps_site_date_idx" ON "gsc_sitemaps" USING btree ("site_id","snapshot_date");
