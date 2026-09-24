CREATE TABLE "serp_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"keyword_id" uuid NOT NULL,
	"engine" text DEFAULT 'google' NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"features" jsonb NOT NULL,
	"top_results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "serp_observations" ADD CONSTRAINT "serp_observations_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "serp_observations_keyword_engine_checkedAt_uq" ON "serp_observations" USING btree ("keyword_id","engine","checked_at");--> statement-breakpoint
CREATE INDEX "serp_observations_site_checkedAt_idx" ON "serp_observations" USING btree ("site_id","checked_at");--> statement-breakpoint
CREATE INDEX "serp_observations_account_checkedAt_idx" ON "serp_observations" USING btree ("account_id","checked_at");