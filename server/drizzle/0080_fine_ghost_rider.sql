ALTER TABLE "scheduled_report_deliveries" DROP CONSTRAINT "scheduled_report_deliveries_error_check";--> statement-breakpoint
ALTER TABLE "alert_deliveries" DROP CONSTRAINT "alert_deliveries_rule_id_alert_rules_id_fk";
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD COLUMN "first_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD COLUMN "request_payload" jsonb;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "alert_deliveries_rule_transition_idx" ON "alert_deliveries" USING btree ("account_id","rule_id","transition_id","id");--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_request_size" CHECK ("alert_deliveries"."request_payload" is null or octet_length("alert_deliveries"."request_payload"::text) between 1 and 131072);--> statement-breakpoint
ALTER TABLE "scheduled_report_deliveries" ADD CONSTRAINT "scheduled_report_deliveries_error_check" CHECK ("scheduled_report_deliveries"."error_code" is null or "scheduled_report_deliveries"."error_code" in ('composition_failed','transport_reported_failure','transport_exception','retries_exhausted','provider_outcome_unknown','provider_outcome_unknown_payload_drift','provider_outcome_unknown_idempotency_window_expired','idempotency_window_expired'));