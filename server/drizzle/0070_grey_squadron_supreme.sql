CREATE TABLE "scheduled_report_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_key" text NOT NULL,
	"recipient" text NOT NULL,
	"status" text NOT NULL,
	"suppression_reason" text,
	"error_code" text,
	"snapshot_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	CONSTRAINT "scheduled_report_deliveries_status_check" CHECK ("scheduled_report_deliveries"."status" in ('sent','failed','suppressed')),
	CONSTRAINT "scheduled_report_deliveries_suppression_check" CHECK ("scheduled_report_deliveries"."suppression_reason" is null or "scheduled_report_deliveries"."suppression_reason" in ('preference','removed_user','transport'))
);
--> statement-breakpoint
CREATE TABLE "scheduled_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"frequency" text NOT NULL,
	"weekday_utc" integer,
	"monthday_utc" integer,
	"hour_utc" integer NOT NULL,
	"minute_utc" integer NOT NULL,
	"locale" text NOT NULL,
	"recipients" jsonb NOT NULL,
	"sections" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_reports_frequency_check" CHECK ("scheduled_reports"."frequency" in ('weekly','monthly')),
	CONSTRAINT "scheduled_reports_cadence_fields_check" CHECK (("scheduled_reports"."frequency" = 'weekly' and "scheduled_reports"."weekday_utc" between 0 and 6 and "scheduled_reports"."monthday_utc" is null) or ("scheduled_reports"."frequency" = 'monthly' and "scheduled_reports"."monthday_utc" between 1 and 28 and "scheduled_reports"."weekday_utc" is null)),
	CONSTRAINT "scheduled_reports_hour_check" CHECK ("scheduled_reports"."hour_utc" between 0 and 23),
	CONSTRAINT "scheduled_reports_minute_check" CHECK ("scheduled_reports"."minute_utc" between 0 and 59),
	CONSTRAINT "scheduled_reports_locale_check" CHECK ("scheduled_reports"."locale" in ('en','ar','fr','de','es','ru','zh'))
);
--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD CONSTRAINT "scheduled_report_deliveries_schedule_id_scheduled_reports_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_report_deliveries_schedule_run_recipient_uidx" ON "scheduled_report_deliveries" USING btree ("schedule_id","run_key","recipient");--> statement-breakpoint
CREATE INDEX "scheduled_report_deliveries_schedule_created_idx" ON "scheduled_report_deliveries" USING btree ("schedule_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scheduled_report_deliveries_account_site_idx" ON "scheduled_report_deliveries" USING btree ("account_id","site_id");--> statement-breakpoint
CREATE INDEX "scheduled_reports_account_created_idx" ON "scheduled_reports" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scheduled_reports_site_enabled_idx" ON "scheduled_reports" USING btree ("site_id","enabled");