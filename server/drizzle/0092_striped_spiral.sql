CREATE TABLE "page_performance_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"page_hash" text NOT NULL,
	"canonical_url" text NOT NULL,
	"display_url" text NOT NULL,
	"keyword" text NOT NULL,
	"position" double precision NOT NULL,
	"search_volume" integer,
	"difficulty" double precision,
	"estimated_traffic" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_performance_keywords_page_hash_check" CHECK ("page_performance_keywords"."page_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "page_performance_keywords_url_check" CHECK (length("page_performance_keywords"."canonical_url") between 8 and 2048 and "page_performance_keywords"."canonical_url" ~ '^https?://' and position('#' in "page_performance_keywords"."canonical_url") = 0 and length("page_performance_keywords"."display_url") between 1 and 2048),
	CONSTRAINT "page_performance_keywords_keyword_check" CHECK (length(btrim("page_performance_keywords"."keyword")) between 1 and 700),
	CONSTRAINT "page_performance_keywords_position_check" CHECK ("page_performance_keywords"."position" > 0 and "page_performance_keywords"."position" < 'Infinity'::double precision),
	CONSTRAINT "page_performance_keywords_metrics_check" CHECK (("page_performance_keywords"."search_volume" is null or "page_performance_keywords"."search_volume" >= 0) and ("page_performance_keywords"."difficulty" is null or ("page_performance_keywords"."difficulty" >= 0 and "page_performance_keywords"."difficulty" <= 100 and "page_performance_keywords"."difficulty" < 'Infinity'::double precision)) and ("page_performance_keywords"."estimated_traffic" is null or ("page_performance_keywords"."estimated_traffic" >= 0 and "page_performance_keywords"."estimated_traffic" < 'Infinity'::double precision)))
);
--> statement-breakpoint
CREATE TABLE "page_performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"source" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"cache_fetched_at" timestamp with time zone NOT NULL,
	"cache_status" text NOT NULL,
	"successful_empty" boolean DEFAULT false NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"source_rows_fetched" integer NOT NULL,
	"accepted_count" integer NOT NULL,
	"dropped_count" integer NOT NULL,
	"malformed_url_count" integer DEFAULT 0 NOT NULL,
	"offsite_url_count" integer DEFAULT 0 NOT NULL,
	"duplicate_url_count" integer DEFAULT 0 NOT NULL,
	"invalid_metric_count" integer DEFAULT 0 NOT NULL,
	"source_truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_performance_snapshots_source_check" CHECK ("page_performance_snapshots"."source" in ('dataforseo', 'demo')),
	CONSTRAINT "page_performance_snapshots_market_check" CHECK ("page_performance_snapshots"."location_code" > 0 and "page_performance_snapshots"."language_code" ~ '^[a-z][a-z0-9-]{1,9}$'),
	CONSTRAINT "page_performance_snapshots_fingerprint_check" CHECK ("page_performance_snapshots"."payload_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "page_performance_snapshots_counts_check" CHECK ("page_performance_snapshots"."source_rows_fetched" >= 0 and "page_performance_snapshots"."accepted_count" >= 0 and "page_performance_snapshots"."dropped_count" >= 0 and "page_performance_snapshots"."malformed_url_count" >= 0 and "page_performance_snapshots"."offsite_url_count" >= 0 and "page_performance_snapshots"."duplicate_url_count" >= 0 and "page_performance_snapshots"."invalid_metric_count" >= 0 and "page_performance_snapshots"."accepted_count" + "page_performance_snapshots"."dropped_count" = "page_performance_snapshots"."source_rows_fetched" and "page_performance_snapshots"."dropped_count" = "page_performance_snapshots"."malformed_url_count" + "page_performance_snapshots"."offsite_url_count" + "page_performance_snapshots"."duplicate_url_count" + "page_performance_snapshots"."invalid_metric_count"),
	CONSTRAINT "page_performance_snapshots_empty_check" CHECK ("page_performance_snapshots"."successful_empty" = ("page_performance_snapshots"."accepted_count" = 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "page_performance_snapshots_parent_tenant_uidx" ON "page_performance_snapshots" USING btree ("id","account_id","site_id");--> statement-breakpoint
ALTER TABLE "page_performance_keywords" ADD CONSTRAINT "page_performance_keywords_snapshot_tenant_fk" FOREIGN KEY ("snapshot_id","account_id","site_id") REFERENCES "public"."page_performance_snapshots"("id","account_id","site_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_performance_keywords_snapshot_page_keyword_uidx" ON "page_performance_keywords" USING btree ("snapshot_id","page_hash","keyword");--> statement-breakpoint
CREATE INDEX "page_performance_keywords_tenant_snapshot_idx" ON "page_performance_keywords" USING btree ("account_id","site_id","snapshot_id");--> statement-breakpoint
CREATE INDEX "page_performance_keywords_page_detail_idx" ON "page_performance_keywords" USING btree ("account_id","site_id","snapshot_id","page_hash","keyword");--> statement-breakpoint
CREATE UNIQUE INDEX "page_performance_snapshots_payload_uidx" ON "page_performance_snapshots" USING btree ("account_id","site_id","source","location_code","language_code","observed_at","payload_fingerprint");--> statement-breakpoint
CREATE INDEX "page_performance_snapshots_context_time_idx" ON "page_performance_snapshots" USING btree ("account_id","site_id","source","location_code","language_code","observed_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "page_performance_snapshots_account_site_idx" ON "page_performance_snapshots" USING btree ("account_id","site_id");--> statement-breakpoint
CREATE TRIGGER page_performance_keywords_site_deletion_guard BEFORE INSERT OR UPDATE ON page_performance_keywords FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER page_performance_keywords_account_deletion_guard BEFORE INSERT OR UPDATE ON page_performance_keywords FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER page_performance_snapshots_site_deletion_guard BEFORE INSERT OR UPDATE ON page_performance_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER page_performance_snapshots_account_deletion_guard BEFORE INSERT OR UPDATE ON page_performance_snapshots FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
