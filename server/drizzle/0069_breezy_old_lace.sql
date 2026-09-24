CREATE TABLE "geogrid_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"keyword_id" text NOT NULL,
	"keyword" text NOT NULL,
	"language_code" text NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"spacing_meters" integer NOT NULL,
	"grid_size" integer NOT NULL,
	"zoom" integer NOT NULL,
	"status" text NOT NULL,
	"total_cells" integer NOT NULL,
	"observed_cells" integer DEFAULT 0 NOT NULL,
	"not_in_pack_cells" integer DEFAULT 0 NOT NULL,
	"failed_cells" integer DEFAULT 0 NOT NULL,
	"failed_point_indexes" integer[] DEFAULT '{}' NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"refund_issued" boolean DEFAULT false NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "geogrid_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"keyword_id" text NOT NULL,
	"point_index" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"position" integer,
	"total_pack_size" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "geogrid_scans_site_keyword_created_idx" ON "geogrid_scans" USING btree ("site_id","keyword_id","created_at");--> statement-breakpoint
CREATE INDEX "geogrid_scans_account_created_idx" ON "geogrid_scans" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "geogrid_snapshots_scan_point_idx" ON "geogrid_snapshots" USING btree ("scan_id","point_index");--> statement-breakpoint
CREATE INDEX "geogrid_snapshots_site_keyword_captured_idx" ON "geogrid_snapshots" USING btree ("site_id","keyword_id","captured_at");