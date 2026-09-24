CREATE TABLE "app_chart_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"store" text NOT NULL,
	"chart_id" text NOT NULL,
	"category_id" text,
	"position" integer,
	"checked_at" timestamp with time zone NOT NULL,
	"observation_meta" jsonb NOT NULL,
	CONSTRAINT "app_chart_snapshots_store_check" CHECK ("app_chart_snapshots"."store" in ('google_play', 'app_store'))
);
--> statement-breakpoint
CREATE TABLE "app_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"store" text NOT NULL,
	"phrase" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_keywords_store_check" CHECK ("app_keywords"."store" in ('google_play', 'app_store'))
);
--> statement-breakpoint
CREATE TABLE "app_listing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"store" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"listing" jsonb NOT NULL,
	"findings" jsonb NOT NULL,
	"observation_meta" jsonb NOT NULL,
	CONSTRAINT "app_listing_snapshots_store_check" CHECK ("app_listing_snapshots"."store" in ('google_play', 'app_store'))
);
--> statement-breakpoint
CREATE TABLE "app_rank_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"keyword_id" uuid NOT NULL,
	"position" integer,
	"rank_absolute" integer,
	"found_app_id" text,
	"checked_at" timestamp with time zone NOT NULL,
	"observation_meta" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_rank_snapshots" ADD CONSTRAINT "app_rank_snapshots_keyword_id_app_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."app_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_chart_snapshots_profile_history_idx" ON "app_chart_snapshots" USING btree ("profile_id","store","chart_id","category_id","checked_at");--> statement-breakpoint
CREATE INDEX "app_chart_snapshots_site_checked_at_idx" ON "app_chart_snapshots" USING btree ("site_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_keywords_profile_store_phrase_location_language_idx" ON "app_keywords" USING btree ("profile_id","store","phrase","location_code","language_code");--> statement-breakpoint
CREATE INDEX "app_keywords_account_active_idx" ON "app_keywords" USING btree ("account_id","active");--> statement-breakpoint
CREATE INDEX "app_keywords_site_profile_active_idx" ON "app_keywords" USING btree ("site_id","profile_id","active");--> statement-breakpoint
CREATE INDEX "app_listing_snapshots_profile_history_idx" ON "app_listing_snapshots" USING btree ("profile_id","store","captured_at");--> statement-breakpoint
CREATE INDEX "app_listing_snapshots_site_captured_at_idx" ON "app_listing_snapshots" USING btree ("site_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_rank_snapshots_keyword_checked_at_idx" ON "app_rank_snapshots" USING btree ("keyword_id","checked_at");--> statement-breakpoint
CREATE INDEX "app_rank_snapshots_site_checked_at_idx" ON "app_rank_snapshots" USING btree ("site_id","checked_at");--> statement-breakpoint
CREATE TRIGGER app_chart_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON app_chart_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER app_chart_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON app_chart_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER app_keywords_account_deletion_guard BEFORE INSERT OR UPDATE ON app_keywords FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER app_keywords_site_deletion_guard BEFORE INSERT OR UPDATE ON app_keywords FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER app_listing_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON app_listing_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER app_listing_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON app_listing_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER app_rank_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON app_rank_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER app_rank_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON app_rank_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
