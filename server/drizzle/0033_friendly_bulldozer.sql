CREATE TABLE "ai_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text,
	"job_id" text,
	"task" text NOT NULL,
	"correlation_id" text NOT NULL,
	"provider" text,
	"model" text,
	"attempt_ordinal" integer NOT NULL,
	"status" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_input_tokens" integer,
	"reasoning_tokens" integer,
	"latency_ms" integer NOT NULL,
	"configured_estimate_cost_micros" bigint NOT NULL,
	"actual_cost_micros" bigint,
	"actual_or_estimated_cost_micros" bigint NOT NULL,
	"cost_source" text NOT NULL,
	"error_category" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_events_account_correlation_ordinal_uidx" ON "ai_usage_events" USING btree ("account_id","correlation_id","attempt_ordinal");--> statement-breakpoint
CREATE INDEX "ai_usage_events_account_created_idx" ON "ai_usage_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_provider_created_idx" ON "ai_usage_events" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_task_created_idx" ON "ai_usage_events" USING btree ("task","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_events_correlation_idx" ON "ai_usage_events" USING btree ("correlation_id");