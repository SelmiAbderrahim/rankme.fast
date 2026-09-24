CREATE TABLE "keyword_research_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"phrases" jsonb NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"result_count" integer NOT NULL,
	"cached" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "krh_kind_check" CHECK ("keyword_research_history"."kind" in ('metrics', 'related', 'intent', 'ideas'))
);
--> statement-breakpoint
CREATE INDEX "krh_account_created_idx" ON "keyword_research_history" USING btree ("account_id","created_at","id");