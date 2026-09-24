CREATE TABLE "vendor_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability" text NOT NULL,
	"operation" text NOT NULL,
	"cache_key" text NOT NULL,
	"params" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capability" text NOT NULL,
	"operation" text NOT NULL,
	"cache_key" text NOT NULL,
	"params" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"account_id" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_cache_cap_op_key_idx" ON "vendor_cache" USING btree ("capability","operation","cache_key");
--> statement-breakpoint
CREATE INDEX "vendor_cache_expires_at_idx" ON "vendor_cache" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "vendor_responses_cap_fetched_idx" ON "vendor_responses" USING btree ("capability","fetched_at");
--> statement-breakpoint
CREATE INDEX "vendor_responses_cache_key_idx" ON "vendor_responses" USING btree ("cache_key");
