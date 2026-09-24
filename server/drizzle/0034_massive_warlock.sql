CREATE TABLE "ai_profile_run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text,
	"job_id" text,
	"correlation_id" text NOT NULL,
	"task" text NOT NULL,
	"profile_version" text NOT NULL,
	"output_schema_version" text NOT NULL,
	"prompt_template_id" text NOT NULL,
	"prompt_template_version" text NOT NULL,
	"status" text NOT NULL,
	"provider" text,
	"model" text,
	"attempts" integer NOT NULL,
	"fallback_used" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_micros" bigint NOT NULL,
	"quality_flags" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "profile_name" text;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "profile_version" text;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "output_schema_version" text;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "prompt_template_id" text;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "prompt_template_version" text;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "quality_flags" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_profile_run_events_account_correlation_uidx" ON "ai_profile_run_events" USING btree ("account_id","correlation_id");--> statement-breakpoint
CREATE INDEX "ai_profile_run_events_account_created_idx" ON "ai_profile_run_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_profile_run_events_task_created_idx" ON "ai_profile_run_events" USING btree ("task","created_at");--> statement-breakpoint
CREATE INDEX "ai_profile_run_events_provider_created_idx" ON "ai_profile_run_events" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "ai_profile_run_events_status_created_idx" ON "ai_profile_run_events" USING btree ("status","created_at");