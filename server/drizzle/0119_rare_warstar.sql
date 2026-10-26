ALTER TABLE "scheduled_reports" DROP CONSTRAINT "scheduled_reports_cadence_fields_check";--> statement-breakpoint
ALTER TABLE "scheduled_reports" DROP CONSTRAINT "scheduled_reports_hour_check";--> statement-breakpoint
ALTER TABLE "keyword_research_history" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "keyword_research_history" ADD COLUMN "lookup_id" uuid;--> statement-breakpoint
ALTER TABLE "local_reviews_snapshots" ADD COLUMN "business_ref" text;--> statement-breakpoint
ALTER TABLE "local_reviews_snapshots" ADD COLUMN "business_name" text;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD COLUMN "local_hour" integer;--> statement-breakpoint
-- Every existing schedule was written in UTC (`timezone` defaults to UTC), so
-- its stored UTC hour is its local hour.
UPDATE "scheduled_reports" SET "local_hour" = "hour_utc" WHERE "local_hour" IS NULL;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ALTER COLUMN "local_hour" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "krh_account_site_created_idx" ON "keyword_research_history" USING btree ("account_id","site_id","created_at","id");--> statement-breakpoint
ALTER TABLE "scheduled_reports" DROP COLUMN "hour_utc";--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_cadence_fields_check" CHECK (("scheduled_reports"."frequency" = 'weekly' and "scheduled_reports"."weekday_utc" between 0 and 6 and "scheduled_reports"."monthday_utc" is null) or ("scheduled_reports"."frequency" = 'monthly' and ("scheduled_reports"."monthday_utc" between 1 and 28 or "scheduled_reports"."monthday_utc" = -1) and "scheduled_reports"."weekday_utc" is null));--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_hour_check" CHECK ("scheduled_reports"."local_hour" between 0 and 23);--> statement-breakpoint
CREATE TRIGGER keyword_research_history_site_deletion_guard BEFORE INSERT OR UPDATE ON keyword_research_history FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
