CREATE TABLE "scheduled_report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_key" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"snapshot_date" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_report_runs_payload_size_check" CHECK (octet_length("scheduled_report_runs"."payload"::text) between 1 and 12582912)
);
--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" DROP CONSTRAINT "scheduled_report_deliveries_status_check";--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ALTER COLUMN "finished_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD COLUMN "transition_id" text;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD COLUMN "first_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "alert_deliveries"
SET "transition_id" = substring(
  "idempotency_key"
  FROM char_length('alert:' || "rule_id"::text || ':') + 1
  FOR char_length("idempotency_key")
    - char_length('alert:' || "rule_id"::text || ':')
    - char_length(':' || "channel" || ':' || coalesce("recipient_ref", '-'))
)
WHERE
  left("idempotency_key", char_length('alert:' || "rule_id"::text || ':')) =
    'alert:' || "rule_id"::text || ':'
  AND right(
    "idempotency_key",
    char_length(':' || "channel" || ':' || coalesce("recipient_ref", '-'))
  ) = ':' || "channel" || ':' || coalesce("recipient_ref", '-')
  AND char_length("idempotency_key") >
    char_length('alert:' || "rule_id"::text || ':') +
    char_length(':' || "channel" || ':' || coalesce("recipient_ref", '-'));--> statement-breakpoint
UPDATE "alert_deliveries"
SET
  "status" = 'failed',
  "attempt" = 3,
  "claim_token" = NULL,
  "error_code" = 'provider_outcome_unknown_payload_drift',
  "suppressed_reason" = NULL,
  "updated_at" = now()
WHERE "transition_id" IS NULL
  AND "status" IN ('pending', 'failed');--> statement-breakpoint
UPDATE "alert_deliveries"
SET "transition_id" = 'legacy-malformed:' || "id"::text
WHERE "transition_id" IS NULL;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ALTER COLUMN "transition_id" SET NOT NULL;--> statement-breakpoint
UPDATE "alert_deliveries"
SET
  "status" = 'failed',
  "attempt" = 3,
  "claim_token" = NULL,
  "error_code" = 'provider_outcome_unknown_payload_drift',
  "suppressed_reason" = NULL,
  "updated_at" = now()
WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "scheduled_report_runs" ADD CONSTRAINT "scheduled_report_runs_schedule_id_scheduled_reports_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_report_runs_schedule_run_uidx" ON "scheduled_report_runs" USING btree ("schedule_id","run_key");--> statement-breakpoint
CREATE INDEX "scheduled_report_runs_reconcile_idx" ON "scheduled_report_runs" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "scheduled_report_runs_account_site_idx" ON "scheduled_report_runs" USING btree ("account_id","site_id");--> statement-breakpoint
CREATE TRIGGER scheduled_report_runs_site_deletion_guard BEFORE INSERT OR UPDATE ON scheduled_report_runs FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER scheduled_report_runs_account_deletion_guard BEFORE INSERT OR UPDATE ON scheduled_report_runs FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_claim_shape" CHECK (("alert_deliveries"."status" = 'pending' and "alert_deliveries"."claim_token" is not null) or ("alert_deliveries"."status" <> 'pending' and "alert_deliveries"."claim_token" is null));--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD CONSTRAINT "scheduled_report_deliveries_error_check" CHECK ("scheduled_report_deliveries"."error_code" is null or "scheduled_report_deliveries"."error_code" in ('composition_failed','transport_reported_failure','transport_exception','provider_outcome_unknown_payload_drift','idempotency_window_expired'));--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD CONSTRAINT "scheduled_report_deliveries_attempt_check" CHECK ("scheduled_report_deliveries"."attempt" between 0 and 3);--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD CONSTRAINT "scheduled_report_deliveries_pending_shape_check" CHECK (("scheduled_report_deliveries"."status" = 'pending' and "scheduled_report_deliveries"."claim_token" is not null and "scheduled_report_deliveries"."request_fingerprint" is not null and "scheduled_report_deliveries"."first_attempt_at" is not null and "scheduled_report_deliveries"."finished_at" is null) or ("scheduled_report_deliveries"."status" <> 'pending' and "scheduled_report_deliveries"."claim_token" is null and "scheduled_report_deliveries"."finished_at" is not null));--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD CONSTRAINT "scheduled_report_deliveries_status_check" CHECK ("scheduled_report_deliveries"."status" in ('pending','sent','failed','suppressed'));
