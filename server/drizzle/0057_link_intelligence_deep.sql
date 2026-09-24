CREATE TABLE "backlink_deep_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_id" text NOT NULL,
	"type" text NOT NULL,
	"domain" text NOT NULL,
	"payload" jsonb NOT NULL,
	"retained_count" integer NOT NULL,
	"retained_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backlink_deep_snapshots_type_check" CHECK ("backlink_deep_snapshots"."type" in ('refDomains', 'anchors', 'history', 'bulkRanks')),
	CONSTRAINT "backlink_deep_snapshots_domain_length_check" CHECK (char_length("backlink_deep_snapshots"."domain") between 1 and 253),
	CONSTRAINT "backlink_deep_snapshots_payload_check" CHECK (jsonb_typeof("backlink_deep_snapshots"."payload") = 'array' and jsonb_array_length("backlink_deep_snapshots"."payload") <= case when "backlink_deep_snapshots"."type" = 'history' then 24 when "backlink_deep_snapshots"."type" = 'bulkRanks' then 100 else 500 end),
	CONSTRAINT "backlink_deep_snapshots_retained_count_check" CHECK ("backlink_deep_snapshots"."retained_count" >= 0 and "backlink_deep_snapshots"."retained_count" = jsonb_array_length("backlink_deep_snapshots"."payload"))
);
--> statement-breakpoint
CREATE TABLE "link_gap_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_id" text NOT NULL,
	"own_domain" text NOT NULL,
	"competitor" text NOT NULL,
	"payload" jsonb NOT NULL,
	"retained_count" integer NOT NULL,
	"retained_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_gap_snapshots_domain_length_check" CHECK (char_length("link_gap_snapshots"."own_domain") between 1 and 253 and char_length("link_gap_snapshots"."competitor") between 1 and 253),
	CONSTRAINT "link_gap_snapshots_payload_check" CHECK (jsonb_typeof("link_gap_snapshots"."payload") = 'array' and jsonb_array_length("link_gap_snapshots"."payload") <= 500),
	CONSTRAINT "link_gap_snapshots_retained_count_check" CHECK ("link_gap_snapshots"."retained_count" >= 0 and "link_gap_snapshots"."retained_count" = jsonb_array_length("link_gap_snapshots"."payload"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backlink_deep_snapshots_account_run_type_uq" ON "backlink_deep_snapshots" USING btree ("account_id","run_id","type");--> statement-breakpoint
CREATE INDEX "backlink_deep_snapshots_site_retained_idx" ON "backlink_deep_snapshots" USING btree ("account_id","site_id","retained_at");--> statement-breakpoint
CREATE UNIQUE INDEX "link_gap_snapshots_account_run_competitor_uq" ON "link_gap_snapshots" USING btree ("account_id","run_id","competitor");--> statement-breakpoint
CREATE INDEX "link_gap_snapshots_site_retained_idx" ON "link_gap_snapshots" USING btree ("account_id","site_id","retained_at");