CREATE TABLE "keyword_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"phrase" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"search_volume" integer,
	"difficulty" integer,
	"cpc_micros" bigint,
	"monthly_searches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_keywords" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_metrics_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE INDEX "keyword_metrics_expires_at_idx" ON "keyword_metrics" USING btree ("expires_at");
