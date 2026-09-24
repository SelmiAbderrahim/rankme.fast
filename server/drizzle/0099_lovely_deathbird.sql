CREATE TABLE "dynamic_plan_pricing_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audience" text NOT NULL,
	"action" text NOT NULL,
	"version_id" text,
	"effective_at" timestamp with time zone NOT NULL,
	"actor_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_pricing_lifecycle_events_action_check" CHECK ("dynamic_plan_pricing_lifecycle_events"."action" in ('activate', 'stop', 'retire')),
	CONSTRAINT "dynamic_plan_pricing_lifecycle_events_role_check" CHECK ("dynamic_plan_pricing_lifecycle_events"."actor_role" in ('system', 'finance', 'operations', 'security')),
	CONSTRAINT "dynamic_plan_pricing_lifecycle_events_version_check" CHECK (("dynamic_plan_pricing_lifecycle_events"."action" in ('activate', 'retire') and "dynamic_plan_pricing_lifecycle_events"."version_id" is not null) or ("dynamic_plan_pricing_lifecycle_events"."action" = 'stop' and "dynamic_plan_pricing_lifecycle_events"."version_id" is null))
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_release_guard_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"safe_version_id" text,
	"actor_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_release_guard_events_action_check" CHECK ("dynamic_plan_release_guard_events"."action" in ('stop', 'clear')),
	CONSTRAINT "dynamic_plan_release_guard_events_role_check" CHECK ("dynamic_plan_release_guard_events"."actor_role" in ('system', 'finance', 'operations', 'security')),
	CONSTRAINT "dynamic_plan_release_guard_events_version_check" CHECK (("dynamic_plan_release_guard_events"."action" = 'clear' and "dynamic_plan_release_guard_events"."safe_version_id" is not null) or ("dynamic_plan_release_guard_events"."action" = 'stop' and "dynamic_plan_release_guard_events"."safe_version_id" is null))
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_runtime_envelopes" (
	"version_id" text NOT NULL,
	"key" text NOT NULL,
	"observed_maximum" bigint NOT NULL,
	"approved_maximum" bigint NOT NULL,
	"unit" text NOT NULL,
	CONSTRAINT "dynamic_plan_runtime_envelopes_pk" PRIMARY KEY("version_id","key"),
	CONSTRAINT "dynamic_plan_runtime_envelopes_bounds_check" CHECK ("dynamic_plan_runtime_envelopes"."observed_maximum" >= 0 and "dynamic_plan_runtime_envelopes"."approved_maximum" >= 0 and "dynamic_plan_runtime_envelopes"."observed_maximum" <= "dynamic_plan_runtime_envelopes"."approved_maximum")
);
--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" DROP CONSTRAINT "dynamic_plan_pricing_versions_code_checksum_unique";--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" DROP CONSTRAINT "billing_checkout_intents_status_check";--> statement-breakpoint
ALTER TABLE "dynamic_plan_quotes" DROP CONSTRAINT "dynamic_plan_quotes_state_check";--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD COLUMN "content_version_id" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD COLUMN "manifest_checksum" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD COLUMN "fee_context_key" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD COLUMN "provider_context_checksum" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD COLUMN "runtime_envelope_checksum" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD COLUMN "source_version_id" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD COLUMN "rollback_of_version_id" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD COLUMN "staged_by" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD COLUMN "staged_role" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_lifecycle_events" ADD CONSTRAINT "dynamic_plan_pricing_lifecycle_events_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_release_guard_events" ADD CONSTRAINT "dynamic_plan_release_guard_events_safe_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("safe_version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_runtime_envelopes" ADD CONSTRAINT "dynamic_plan_runtime_envelopes_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_pricing_lifecycle_events_audience_time_uidx" ON "dynamic_plan_pricing_lifecycle_events" USING btree ("audience","effective_at");--> statement-breakpoint
CREATE INDEX "dynamic_plan_pricing_lifecycle_events_lookup_idx" ON "dynamic_plan_pricing_lifecycle_events" USING btree ("audience","effective_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_release_guard_events_time_uidx" ON "dynamic_plan_release_guard_events" USING btree ("effective_at");--> statement-breakpoint
CREATE INDEX "dynamic_plan_release_guard_events_lookup_idx" ON "dynamic_plan_release_guard_events" USING btree ("effective_at","created_at");--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_status_check" CHECK ("billing_checkout_intents"."status" in ('creating', 'unknown', 'open', 'paid', 'compensating', 'completed', 'expired', 'failed', 'invalidated'));--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD CONSTRAINT "dynamic_plan_pricing_versions_manifest_checksum_check" CHECK ("dynamic_plan_pricing_versions"."manifest_checksum" is null or "dynamic_plan_pricing_versions"."manifest_checksum" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD CONSTRAINT "dynamic_plan_pricing_versions_provider_checksum_check" CHECK ("dynamic_plan_pricing_versions"."provider_context_checksum" is null or "dynamic_plan_pricing_versions"."provider_context_checksum" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD CONSTRAINT "dynamic_plan_pricing_versions_runtime_checksum_check" CHECK ("dynamic_plan_pricing_versions"."runtime_envelope_checksum" is null or "dynamic_plan_pricing_versions"."runtime_envelope_checksum" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD CONSTRAINT "dynamic_plan_pricing_versions_role_check" CHECK ("dynamic_plan_pricing_versions"."staged_role" is null or "dynamic_plan_pricing_versions"."staged_role" in ('system', 'finance', 'operations', 'security'));--> statement-breakpoint
ALTER TABLE "dynamic_plan_quotes" ADD CONSTRAINT "dynamic_plan_quotes_state_check" CHECK (("dynamic_plan_quotes"."status" = 'open' and "dynamic_plan_quotes"."reserved_by" is null and "dynamic_plan_quotes"."consumed_at" is null) or ("dynamic_plan_quotes"."status" = 'reserved' and "dynamic_plan_quotes"."reserved_by" is not null and "dynamic_plan_quotes"."reserved_at" is not null and "dynamic_plan_quotes"."consumed_at" is null) or ("dynamic_plan_quotes"."status" = 'consumed' and "dynamic_plan_quotes"."reserved_by" is not null and "dynamic_plan_quotes"."consumed_at" is not null) or ("dynamic_plan_quotes"."status" in ('expired', 'invalidated') and "dynamic_plan_quotes"."consumed_at" is null));
--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD CONSTRAINT "dynamic_plan_pricing_versions_source_version_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD CONSTRAINT "dynamic_plan_pricing_versions_rollback_version_fk" FOREIGN KEY ("rollback_of_version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" ADD CONSTRAINT "dynamic_plan_pricing_versions_release_reference_check" CHECK (("source_version_id" is null or "source_version_id" <> "version_id") and ("rollback_of_version_id" is null or "rollback_of_version_id" <> "version_id"));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_dynamic_plan_pricing_identity() RETURNS trigger AS $$
BEGIN
  IF OLD.version_id IS DISTINCT FROM NEW.version_id OR OLD.code_checksum IS DISTINCT FROM NEW.code_checksum
    OR OLD.content_version_id IS DISTINCT FROM NEW.content_version_id
    OR OLD.manifest_checksum IS DISTINCT FROM NEW.manifest_checksum
    OR OLD.fee_context_key IS DISTINCT FROM NEW.fee_context_key
    OR OLD.provider_context_checksum IS DISTINCT FROM NEW.provider_context_checksum
    OR OLD.runtime_envelope_checksum IS DISTINCT FROM NEW.runtime_envelope_checksum
    OR OLD.source_version_id IS DISTINCT FROM NEW.source_version_id
    OR OLD.rollback_of_version_id IS DISTINCT FROM NEW.rollback_of_version_id
    OR OLD.staged_by IS DISTINCT FROM NEW.staged_by
    OR OLD.staged_role IS DISTINCT FROM NEW.staged_role
    OR OLD.staged_at IS DISTINCT FROM NEW.staged_at OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR (OLD.content_version_id IS NOT NULL AND (
      OLD.new_sales_effective_at IS DISTINCT FROM NEW.new_sales_effective_at
      OR OLD.new_sales_ends_at IS DISTINCT FROM NEW.new_sales_ends_at
      OR OLD.renewals_effective_at IS DISTINCT FROM NEW.renewals_effective_at
      OR OLD.renewals_ends_at IS DISTINCT FROM NEW.renewals_ends_at
      OR OLD.retired_at IS DISTINCT FROM NEW.retired_at
    ))
  THEN RAISE EXCEPTION 'immutable dynamic plan pricing release'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_runtime_envelopes_immutable BEFORE UPDATE OR DELETE ON dynamic_plan_runtime_envelopes FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_pricing_sources_no_delete BEFORE DELETE ON dynamic_plan_pricing_sources FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_pricing_versions_no_delete BEFORE DELETE ON dynamic_plan_pricing_versions FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_pricing_lifecycle_events_immutable BEFORE UPDATE OR DELETE ON dynamic_plan_pricing_lifecycle_events FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_release_guard_events_immutable BEFORE UPDATE OR DELETE ON dynamic_plan_release_guard_events FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
