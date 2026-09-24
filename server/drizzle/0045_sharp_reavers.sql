CREATE TABLE "site_pulse_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"schedule_key" integer NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_pulse_settings_schedule_key_nonneg_check" CHECK ("site_pulse_settings"."schedule_key" >= 0)
);
--> statement-breakpoint
CREATE TABLE "site_pulse_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"user_id" text NOT NULL,
	"locale" text NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_pulse_citation_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pulse_run_id" uuid NOT NULL,
	"prior_pulse_run_id" uuid,
	"change" text NOT NULL,
	"engine" text NOT NULL,
	"surface" text NOT NULL,
	"prompt_cohort_id" text NOT NULL,
	"prompt_cohort_version" integer NOT NULL,
	"canonical_url" text NOT NULL,
	"host" text NOT NULL,
	"citation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_pulse_citation_changes_change_check" CHECK ("weekly_pulse_citation_changes"."change" in ('new','lost','unknown_partial')),
	CONSTRAINT "weekly_pulse_citation_changes_surface_check" CHECK ("weekly_pulse_citation_changes"."surface" in ('mentions','citations'))
);
--> statement-breakpoint
CREATE TABLE "weekly_pulse_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pulse_run_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"surface" text NOT NULL,
	"prompt_cohort_id" text NOT NULL,
	"prompt_cohort_version" integer NOT NULL,
	"canonical_url" text NOT NULL,
	"title_safe" text,
	"host" text NOT NULL,
	"mention_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_pulse_citations_surface_check" CHECK ("weekly_pulse_citations"."surface" in ('mentions','citations')),
	CONSTRAINT "weekly_pulse_citations_mention_count_nonneg_check" CHECK ("weekly_pulse_citations"."mention_count" >= 0),
	CONSTRAINT "weekly_pulse_citations_cohort_version_nonneg_check" CHECK ("weekly_pulse_citations"."prompt_cohort_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_pulse_delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pulse_run_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"locale" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"error_detail_safe" text,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_pulse_delivery_events_status_check" CHECK ("weekly_pulse_delivery_events"."status" in ('queued','delivered','not_delivered','suppressed_no_transport','suppressed_membership_removed','suppressed_unsubscribed')),
	CONSTRAINT "weekly_pulse_delivery_events_channel_check" CHECK ("weekly_pulse_delivery_events"."channel" in ('email')),
	CONSTRAINT "weekly_pulse_delivery_events_attempt_positive_check" CHECK ("weekly_pulse_delivery_events"."attempt" >= 1),
	CONSTRAINT "weekly_pulse_delivery_events_cost_nonneg_check" CHECK ("weekly_pulse_delivery_events"."cost_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_pulse_digest_projection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pulse_run_id" uuid NOT NULL,
	"rendered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_pulse_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"iso_week" text NOT NULL,
	"status" text NOT NULL,
	"market_snapshot" jsonb NOT NULL,
	"prompt_cohort_id" text NOT NULL,
	"prompt_cohort_version" integer NOT NULL,
	"engine_surface_set" jsonb NOT NULL,
	"observation_meta" jsonb NOT NULL,
	"usage_reference" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"error_code" text,
	"error_detail_safe" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_pulse_runs_status_check" CHECK ("weekly_pulse_runs"."status" in ('queued','collecting','completed','partial','blocked_capacity','unsupported','failed')),
	CONSTRAINT "weekly_pulse_runs_cohort_version_nonneg_check" CHECK ("weekly_pulse_runs"."prompt_cohort_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "weekly_pulse_citation_changes" ADD CONSTRAINT "weekly_pulse_citation_changes_pulse_run_id_weekly_pulse_runs_id_fk" FOREIGN KEY ("pulse_run_id") REFERENCES "public"."weekly_pulse_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_pulse_citation_changes" ADD CONSTRAINT "weekly_pulse_citation_changes_prior_pulse_run_id_weekly_pulse_runs_id_fk" FOREIGN KEY ("prior_pulse_run_id") REFERENCES "public"."weekly_pulse_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_pulse_citation_changes" ADD CONSTRAINT "weekly_pulse_citation_changes_citation_id_weekly_pulse_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."weekly_pulse_citations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_pulse_citations" ADD CONSTRAINT "weekly_pulse_citations_pulse_run_id_weekly_pulse_runs_id_fk" FOREIGN KEY ("pulse_run_id") REFERENCES "public"."weekly_pulse_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_pulse_delivery_events" ADD CONSTRAINT "weekly_pulse_delivery_events_pulse_run_id_weekly_pulse_runs_id_fk" FOREIGN KEY ("pulse_run_id") REFERENCES "public"."weekly_pulse_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_pulse_digest_projection" ADD CONSTRAINT "weekly_pulse_digest_projection_pulse_run_id_weekly_pulse_runs_id_fk" FOREIGN KEY ("pulse_run_id") REFERENCES "public"."weekly_pulse_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_pulse_settings_account_site_uidx" ON "site_pulse_settings" USING btree ("account_id","site_id");--> statement-breakpoint
CREATE INDEX "site_pulse_settings_enabled_next_run_idx" ON "site_pulse_settings" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_pulse_subscriptions_account_site_user_uidx" ON "site_pulse_subscriptions" USING btree ("account_id","site_id","user_id");--> statement-breakpoint
CREATE INDEX "site_pulse_subscriptions_site_enabled_idx" ON "site_pulse_subscriptions" USING btree ("site_id","disabled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_pulse_citation_changes_cell_url_uidx" ON "weekly_pulse_citation_changes" USING btree ("pulse_run_id","change","engine","surface","prompt_cohort_id","prompt_cohort_version","canonical_url");--> statement-breakpoint
CREATE INDEX "weekly_pulse_citation_changes_run_idx" ON "weekly_pulse_citation_changes" USING btree ("pulse_run_id","change");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_pulse_citations_run_cell_url_uidx" ON "weekly_pulse_citations" USING btree ("pulse_run_id","engine","surface","prompt_cohort_id","prompt_cohort_version","canonical_url");--> statement-breakpoint
CREATE INDEX "weekly_pulse_citations_run_engine_idx" ON "weekly_pulse_citations" USING btree ("pulse_run_id","engine","surface");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_pulse_delivery_events_run_user_channel_uidx" ON "weekly_pulse_delivery_events" USING btree ("pulse_run_id","user_id","channel");--> statement-breakpoint
CREATE INDEX "weekly_pulse_delivery_events_run_status_idx" ON "weekly_pulse_delivery_events" USING btree ("pulse_run_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_pulse_digest_projection_run_uidx" ON "weekly_pulse_digest_projection" USING btree ("pulse_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_pulse_runs_account_site_week_uidx" ON "weekly_pulse_runs" USING btree ("account_id","site_id","iso_week");--> statement-breakpoint
CREATE INDEX "weekly_pulse_runs_site_created_idx" ON "weekly_pulse_runs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "weekly_pulse_runs_status_created_idx" ON "weekly_pulse_runs" USING btree ("status","created_at");