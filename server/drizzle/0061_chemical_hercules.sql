CREATE TABLE "volatility_indices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_date" date NOT NULL,
	"category" text NOT NULL,
	"value_tenths" integer,
	"state" text NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "volatility_indices_category_check" CHECK ("volatility_indices"."category" in ('finance', 'health', 'travel', 'technology', 'retail', 'entertainment', 'local_services', 'education', 'real_estate', 'automotive', 'composite')),
	CONSTRAINT "volatility_indices_state_check" CHECK ("volatility_indices"."state" in ('published', 'partial', 'baseline', 'skipped_budget', 'failed')),
	CONSTRAINT "volatility_indices_value_check" CHECK ("volatility_indices"."value_tenths" is null or "volatility_indices"."value_tenths" between 0 and 100),
	CONSTRAINT "volatility_indices_spent_nonnegative_check" CHECK ("volatility_indices"."spent_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "volatility_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_date" date NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"budget_micros" bigint NOT NULL,
	"halt_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volatility_runs_status_check" CHECK ("volatility_runs"."status" in ('running', 'completed', 'partial', 'skipped_budget', 'failed')),
	CONSTRAINT "volatility_runs_halt_reason_check" CHECK ("volatility_runs"."halt_reason" is null or "volatility_runs"."halt_reason" in ('pre_dispatch', 'mid_run_projected', 'mid_run_actual')),
	CONSTRAINT "volatility_runs_spent_nonnegative_check" CHECK ("volatility_runs"."spent_micros" >= 0),
	CONSTRAINT "volatility_runs_budget_positive_check" CHECK ("volatility_runs"."budget_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE "volatility_serp_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_date" date NOT NULL,
	"category" text NOT NULL,
	"keyword_ordinal" integer NOT NULL,
	"result_key" text NOT NULL,
	"position" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "volatility_snapshots_category_check" CHECK ("volatility_serp_snapshots"."category" in ('finance', 'health', 'travel', 'technology', 'retail', 'entertainment', 'local_services', 'education', 'real_estate', 'automotive')),
	CONSTRAINT "volatility_snapshots_keyword_ordinal_check" CHECK ("volatility_serp_snapshots"."keyword_ordinal" between 0 and 19),
	CONSTRAINT "volatility_snapshots_position_check" CHECK ("volatility_serp_snapshots"."position" between 1 and 20),
	CONSTRAINT "volatility_snapshots_result_key_check" CHECK (length("volatility_serp_snapshots"."result_key") between 1 and 2048)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "volatility_indices_day_category_uidx" ON "volatility_indices" USING btree ("observation_date","category");--> statement-breakpoint
CREATE INDEX "volatility_indices_category_day_idx" ON "volatility_indices" USING btree ("category","observation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "volatility_runs_observation_date_uidx" ON "volatility_runs" USING btree ("observation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "volatility_snapshots_day_category_keyword_position_uidx" ON "volatility_serp_snapshots" USING btree ("observation_date","category","keyword_ordinal","position");--> statement-breakpoint
CREATE INDEX "volatility_snapshots_day_category_keyword_position_idx" ON "volatility_serp_snapshots" USING btree ("observation_date","category","keyword_ordinal","position");