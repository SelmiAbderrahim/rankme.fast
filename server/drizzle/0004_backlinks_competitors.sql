CREATE TABLE "backlink_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"account_id" text NOT NULL,
	"domain_rating" integer,
	"backlinks" bigint DEFAULT 0 NOT NULL,
	"referring_domains" bigint DEFAULT 0 NOT NULL,
	"broken_backlinks" bigint DEFAULT 0 NOT NULL,
	"cached_page" jsonb,
	"cached_page_expires_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "backlink_snapshots_site_fetched_at_idx" ON "backlink_snapshots" USING btree ("site_id","fetched_at");
--> statement-breakpoint
CREATE INDEX "backlink_snapshots_account_idx" ON "backlink_snapshots" USING btree ("account_id");
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"account_id" text NOT NULL,
	"competitor_domain" text NOT NULL,
	"avg_position" numeric,
	"intersections" integer DEFAULT 0 NOT NULL,
	"estimated_traffic" numeric,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "competitors_site_fetched_at_idx" ON "competitors" USING btree ("site_id","fetched_at");
--> statement-breakpoint
CREATE INDEX "competitors_account_idx" ON "competitors" USING btree ("account_id");
