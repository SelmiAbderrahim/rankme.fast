CREATE TABLE "domain_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"last_rank_check_at" timestamp with time zone,
	"cadence" text DEFAULT 'weekly' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_states_site_id_unique" UNIQUE("site_id"),
	CONSTRAINT "domain_states_cadence_check" CHECK ("domain_states"."cadence" in ('weekly', 'daily'))
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"phrase" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"device" text DEFAULT 'desktop' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keywords_device_check" CHECK ("keywords"."device" in ('desktop', 'mobile'))
);
--> statement-breakpoint
CREATE TABLE "rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"keyword_id" uuid NOT NULL,
	"position" integer,
	"rank_absolute" integer,
	"found_url" text,
	"checked_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rankings_source_check" CHECK ("rankings"."source" in ('fresh', 'cache'))
);
--> statement-breakpoint
CREATE TABLE "serp_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"top_results" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serp_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_site_phrase_loc_lang_device_idx" ON "keywords" USING btree ("site_id","phrase","location_code","language_code","device");--> statement-breakpoint
CREATE INDEX "keywords_site_active_idx" ON "keywords" USING btree ("site_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "rankings_keyword_checkedAt_idx" ON "rankings" USING btree ("keyword_id","checked_at");--> statement-breakpoint
CREATE INDEX "rankings_keyword_checkedAt_desc_idx" ON "rankings" USING btree ("keyword_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "serp_cache_expires_at_idx" ON "serp_cache" USING btree ("expires_at");