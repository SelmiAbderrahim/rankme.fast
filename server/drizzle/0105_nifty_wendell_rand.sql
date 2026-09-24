CREATE TABLE "dynamic_plan_cost_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricing_version_id" text NOT NULL,
	"cost_driver" text NOT NULL,
	"context_key" text NOT NULL,
	"modeled_micros" bigint NOT NULL,
	"actual_micros" bigint NOT NULL,
	"variance_ppm" bigint NOT NULL,
	"state" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"evidence_checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_cost_reconciliation_money_check" CHECK ("dynamic_plan_cost_reconciliations"."modeled_micros" >= 0 and "dynamic_plan_cost_reconciliations"."actual_micros" >= 0),
	CONSTRAINT "dynamic_plan_cost_reconciliation_state_check" CHECK ("dynamic_plan_cost_reconciliations"."state" in ('within_threshold', 'variance_alert', 'unknown_cost')),
	CONSTRAINT "dynamic_plan_cost_reconciliation_window_check" CHECK ("dynamic_plan_cost_reconciliations"."window_end" > "dynamic_plan_cost_reconciliations"."window_start"),
	CONSTRAINT "dynamic_plan_cost_reconciliation_checksum_check" CHECK ("dynamic_plan_cost_reconciliations"."evidence_checksum" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_cost_telemetry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_event_id" text NOT NULL,
	"pricing_version_id" text,
	"pricing_checksum" text NOT NULL,
	"operation" text NOT NULL,
	"cost_driver" text NOT NULL,
	"context_key" text NOT NULL,
	"basis" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"rate_source_id" text,
	"rate_snapshot_checksum" text,
	"account_id" text,
	"revision_id" uuid,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_cost_telemetry_source_check" CHECK ("dynamic_plan_cost_telemetry_events"."source" in ('provider', 'ai', 'infrastructure', 'payment')),
	CONSTRAINT "dynamic_plan_cost_telemetry_basis_check" CHECK ("dynamic_plan_cost_telemetry_events"."basis" in ('actual', 'estimated')),
	CONSTRAINT "dynamic_plan_cost_telemetry_amount_check" CHECK ("dynamic_plan_cost_telemetry_events"."amount_micros" >= 0),
	CONSTRAINT "dynamic_plan_cost_telemetry_checksum_check" CHECK ("dynamic_plan_cost_telemetry_events"."pricing_checksum" ~ '^[0-9a-f]{64}$' and ("dynamic_plan_cost_telemetry_events"."rate_snapshot_checksum" is null or "dynamic_plan_cost_telemetry_events"."rate_snapshot_checksum" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "dynamic_plan_cost_telemetry_rate_evidence_check" CHECK ("dynamic_plan_cost_telemetry_events"."rate_source_id" is not null or "dynamic_plan_cost_telemetry_events"."rate_snapshot_checksum" is not null)
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_operational_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text,
	"pricing_version_id" text,
	"count" integer DEFAULT 1 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_operational_events_kind_check" CHECK ("dynamic_plan_operational_events"."kind" in ('readiness', 'preview', 'quote', 'session', 'activation', 'renewal', 'reprice', 'solver_refusal', 'catalog_drift', 'runtime_drift', 'provider_mismatch', 'compensation', 'reconciliation')),
	CONSTRAINT "dynamic_plan_operational_events_count_check" CHECK ("dynamic_plan_operational_events"."count" > 0 and ("dynamic_plan_operational_events"."duration_ms" is null or "dynamic_plan_operational_events"."duration_ms" >= 0))
);
--> statement-breakpoint
ALTER TABLE "dynamic_plan_cost_reconciliations" ADD CONSTRAINT "dynamic_plan_cost_reconciliations_pricing_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_cost_telemetry_events" ADD CONSTRAINT "dynamic_plan_cost_telemetry_events_pricing_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_operational_events" ADD CONSTRAINT "dynamic_plan_operational_events_pricing_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dynamic_plan_cost_reconciliation_version_idx" ON "dynamic_plan_cost_reconciliations" USING btree ("pricing_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_cost_telemetry_source_event_uidx" ON "dynamic_plan_cost_telemetry_events" USING btree ("source","source_event_id");--> statement-breakpoint
CREATE INDEX "dynamic_plan_cost_telemetry_version_driver_idx" ON "dynamic_plan_cost_telemetry_events" USING btree ("pricing_version_id","cost_driver","context_key","observed_at");--> statement-breakpoint
CREATE INDEX "dynamic_plan_cost_telemetry_account_idx" ON "dynamic_plan_cost_telemetry_events" USING btree ("account_id","observed_at");--> statement-breakpoint
CREATE INDEX "dynamic_plan_operational_events_kind_created_idx" ON "dynamic_plan_operational_events" USING btree ("kind","created_at");