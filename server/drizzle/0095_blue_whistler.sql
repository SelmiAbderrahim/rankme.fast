CREATE TABLE "gsc_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"generation" bigint NOT NULL,
	"property_url_hash" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"snapshot_date" date,
	"last_success_at" timestamp with time zone,
	"failure_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "gsc_search_analytics"
		GROUP BY "account_id", "site_id", "snapshot_date", "dimension_set", "window_days", "dimension_key"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'gsc_search_analytics contains ambiguous tenant-scoped duplicates';
	END IF;
END $$;
--> statement-breakpoint
DROP INDEX "gsc_search_analytics_site_date_dim_key_idx";--> statement-breakpoint
DROP INDEX "gsc_search_analytics_site_dim_date_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_sync_runs_tenant_generation_uidx" ON "gsc_sync_runs" USING btree ("account_id","site_id","generation");--> statement-breakpoint
CREATE INDEX "gsc_sync_runs_tenant_property_generation_idx" ON "gsc_sync_runs" USING btree ("account_id","site_id","property_url_hash","generation" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_search_analytics_account_site_date_dim_key_idx" ON "gsc_search_analytics" USING btree ("account_id","site_id","snapshot_date","dimension_set","window_days","dimension_key");--> statement-breakpoint
CREATE INDEX "gsc_search_analytics_account_site_dim_date_idx" ON "gsc_search_analytics" USING btree ("account_id","site_id","dimension_set","snapshot_date");
