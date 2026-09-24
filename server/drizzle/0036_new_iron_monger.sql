CREATE TABLE "content_recommendation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"recommendation_id" text NOT NULL,
	"analysis_version" text NOT NULL,
	"event_kind" text NOT NULL,
	"prior_state" text NOT NULL,
	"new_state" text NOT NULL,
	"state_version" integer NOT NULL,
	"actor_user_id" text NOT NULL,
	"note" text,
	"content_hash" text,
	"analysis_content_hash" text,
	"applied_at" timestamp with time zone,
	"baseline_anchor_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_rec_events_state_version_check" CHECK ("content_recommendation_events"."state_version" > 0),
	CONSTRAINT "content_rec_events_state_check" CHECK ("content_recommendation_events"."prior_state" in ('suggested','accepted','dismissed','applied') and "content_recommendation_events"."new_state" in ('suggested','accepted','dismissed','applied')),
	CONSTRAINT "content_rec_events_kind_check" CHECK ("content_recommendation_events"."event_kind" in ('accepted','dismissed','applied','undo_applied'))
);
--> statement-breakpoint
CREATE TABLE "content_recommendation_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"recommendation_id" text NOT NULL,
	"applied_event_id" uuid NOT NULL,
	"aggregation_version" text NOT NULL,
	"source" text NOT NULL,
	"phase" text NOT NULL,
	"observed_date" timestamp with time zone NOT NULL,
	"clicks" integer,
	"impressions" integer,
	"ctr" real,
	"average_position" real,
	"rank_position" integer,
	"later_edit" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_rec_outcomes_source_check" CHECK ("content_recommendation_outcomes"."source" in ('gsc','rank')),
	CONSTRAINT "content_rec_outcomes_phase_check" CHECK ("content_recommendation_outcomes"."phase" in ('baseline','following')),
	CONSTRAINT "content_rec_outcomes_later_edit_check" CHECK ("content_recommendation_outcomes"."later_edit" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_rec_events_idempotency_uidx" ON "content_recommendation_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "content_rec_events_state_version_uidx" ON "content_recommendation_events" USING btree ("analysis_id","recommendation_id","state_version");--> statement-breakpoint
CREATE INDEX "content_rec_events_account_recorded_idx" ON "content_recommendation_events" USING btree ("account_id","recorded_at");--> statement-breakpoint
CREATE INDEX "content_rec_events_analysis_rec_recorded_idx" ON "content_recommendation_events" USING btree ("analysis_id","recommendation_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_rec_outcomes_observation_uidx" ON "content_recommendation_outcomes" USING btree ("applied_event_id","aggregation_version","source","observed_date");--> statement-breakpoint
CREATE INDEX "content_rec_outcomes_analysis_rec_date_idx" ON "content_recommendation_outcomes" USING btree ("analysis_id","recommendation_id","observed_date");--> statement-breakpoint
CREATE INDEX "content_rec_outcomes_account_date_idx" ON "content_recommendation_outcomes" USING btree ("account_id","observed_date");