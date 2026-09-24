DROP INDEX "ga4_metrics_site_date_dim_window_key_idx";--> statement-breakpoint
DROP INDEX "ga4_metrics_site_dim_date_idx";--> statement-breakpoint
DROP INDEX "gsc_search_analytics_account_site_date_dim_key_idx";--> statement-breakpoint
DROP INDEX "gsc_search_analytics_account_site_dim_date_idx";--> statement-breakpoint
DROP INDEX "gsc_search_appearance_site_property_date_raw_idx";--> statement-breakpoint
DROP INDEX "gsc_search_appearance_site_date_idx";--> statement-breakpoint
DROP INDEX "gsc_search_appearance_site_generative_idx";--> statement-breakpoint
DROP INDEX "gsc_sitemaps_site_date_path_idx";--> statement-breakpoint
DROP INDEX "gsc_sitemaps_site_date_idx";--> statement-breakpoint
DROP INDEX "gsc_sync_runs_tenant_generation_uidx";--> statement-breakpoint
DROP INDEX "gsc_sync_runs_tenant_property_generation_idx";--> statement-breakpoint
ALTER TABLE "ga4_metrics" ADD COLUMN "binding_generation_id" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "gsc_search_analytics" ADD COLUMN "binding_generation_id" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "gsc_search_appearance" ADD COLUMN "binding_generation_id" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "gsc_sitemaps" ADD COLUMN "binding_generation_id" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "gsc_sync_runs" ADD COLUMN "binding_generation_id" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "ga4_metrics" ALTER COLUMN "binding_generation_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "gsc_search_analytics" ALTER COLUMN "binding_generation_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "gsc_search_appearance" ALTER COLUMN "binding_generation_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "gsc_sitemaps" ALTER COLUMN "binding_generation_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "gsc_sync_runs" ALTER COLUMN "binding_generation_id" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "ga4_metrics_site_date_dim_window_key_idx" ON "ga4_metrics" USING btree ("site_id","binding_generation_id","snapshot_date","dimension_set","window_days","dimension_key");--> statement-breakpoint
CREATE INDEX "ga4_metrics_site_dim_date_idx" ON "ga4_metrics" USING btree ("site_id","binding_generation_id","dimension_set","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_search_analytics_account_site_date_dim_key_idx" ON "gsc_search_analytics" USING btree ("account_id","site_id","binding_generation_id","snapshot_date","dimension_set","window_days","dimension_key");--> statement-breakpoint
CREATE INDEX "gsc_search_analytics_account_site_dim_date_idx" ON "gsc_search_analytics" USING btree ("account_id","site_id","binding_generation_id","dimension_set","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_search_appearance_site_property_date_raw_idx" ON "gsc_search_appearance" USING btree ("site_id","binding_generation_id","property","snapshot_date","window_days","raw_appearance");--> statement-breakpoint
CREATE INDEX "gsc_search_appearance_site_date_idx" ON "gsc_search_appearance" USING btree ("site_id","binding_generation_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "gsc_search_appearance_site_generative_idx" ON "gsc_search_appearance" USING btree ("site_id","binding_generation_id","classified_generative");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_sitemaps_site_date_path_idx" ON "gsc_sitemaps" USING btree ("site_id","binding_generation_id","snapshot_date","path");--> statement-breakpoint
CREATE INDEX "gsc_sitemaps_site_date_idx" ON "gsc_sitemaps" USING btree ("site_id","binding_generation_id","snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_sync_runs_tenant_generation_uidx" ON "gsc_sync_runs" USING btree ("account_id","site_id","binding_generation_id","generation");--> statement-breakpoint
CREATE INDEX "gsc_sync_runs_tenant_property_generation_idx" ON "gsc_sync_runs" USING btree ("account_id","site_id","binding_generation_id","property_url_hash","generation" DESC NULLS LAST);
