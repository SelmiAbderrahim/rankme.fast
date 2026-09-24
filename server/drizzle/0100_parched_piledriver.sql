CREATE TABLE "dynamic_plan_envelope_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"revision_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"dimension" text NOT NULL,
	"used" bigint DEFAULT 0 NOT NULL,
	"limit" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_envelope_counters_bounds_check" CHECK ("dynamic_plan_envelope_counters"."used" >= 0 and "dynamic_plan_envelope_counters"."limit" >= 0 and "dynamic_plan_envelope_counters"."used" <= "dynamic_plan_envelope_counters"."limit")
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_envelope_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"revision_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"period_key" text NOT NULL,
	"dimension" text NOT NULL,
	"units" bigint NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_envelope_reservations_units_check" CHECK ("dynamic_plan_envelope_reservations"."units" > 0)
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_live_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"revision_id" uuid NOT NULL,
	"operation_key" text NOT NULL,
	"resource_kind" text NOT NULL,
	"units" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_live_reservations_units_check" CHECK ("dynamic_plan_live_reservations"."units" > 0),
	CONSTRAINT "dynamic_plan_live_reservations_status_check" CHECK ("dynamic_plan_live_reservations"."status" in ('pending', 'finalized', 'released')),
	CONSTRAINT "dynamic_plan_live_reservations_final_check" CHECK (("dynamic_plan_live_reservations"."status" = 'pending' and "dynamic_plan_live_reservations"."finalized_at" is null) or ("dynamic_plan_live_reservations"."status" in ('finalized', 'released') and "dynamic_plan_live_reservations"."finalized_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_usage_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"reservation_id" uuid NOT NULL,
	"attempt_key" text NOT NULL,
	"ordinal" integer NOT NULL,
	"outcome" text DEFAULT 'claimed' NOT NULL,
	"evidence" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "dynamic_plan_usage_attempts_ordinal_check" CHECK ("dynamic_plan_usage_attempts"."ordinal" > 0),
	CONSTRAINT "dynamic_plan_usage_attempts_outcome_check" CHECK ("dynamic_plan_usage_attempts"."outcome" in ('claimed', 'succeeded', 'provider_billed', 'ambiguous', 'pre_spend_failed')),
	CONSTRAINT "dynamic_plan_usage_attempts_final_check" CHECK (("dynamic_plan_usage_attempts"."outcome" = 'claimed' and "dynamic_plan_usage_attempts"."finalized_at" is null and "dynamic_plan_usage_attempts"."evidence" is null) or ("dynamic_plan_usage_attempts"."outcome" <> 'claimed' and "dynamic_plan_usage_attempts"."finalized_at" is not null and "dynamic_plan_usage_attempts"."evidence" is not null))
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"revision_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"metric" text NOT NULL,
	"units" bigint NOT NULL,
	"base_units" bigint NOT NULL,
	"credit_units" bigint NOT NULL,
	"max_attempts" integer NOT NULL,
	"attempts_claimed" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"final_evidence" text,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_usage_reservations_units_check" CHECK ("dynamic_plan_usage_reservations"."units" > 0 and "dynamic_plan_usage_reservations"."base_units" >= 0 and "dynamic_plan_usage_reservations"."credit_units" >= 0 and "dynamic_plan_usage_reservations"."base_units" + "dynamic_plan_usage_reservations"."credit_units" = "dynamic_plan_usage_reservations"."units"),
	CONSTRAINT "dynamic_plan_usage_reservations_attempts_check" CHECK ("dynamic_plan_usage_reservations"."max_attempts" > 0 and "dynamic_plan_usage_reservations"."attempts_claimed" >= 0 and "dynamic_plan_usage_reservations"."attempts_claimed" <= "dynamic_plan_usage_reservations"."max_attempts"),
	CONSTRAINT "dynamic_plan_usage_reservations_status_check" CHECK ("dynamic_plan_usage_reservations"."status" in ('reserved', 'consumed', 'released')),
	CONSTRAINT "dynamic_plan_usage_reservations_final_check" CHECK (("dynamic_plan_usage_reservations"."status" = 'reserved' and "dynamic_plan_usage_reservations"."finalized_at" is null and "dynamic_plan_usage_reservations"."final_evidence" is null) or ("dynamic_plan_usage_reservations"."status" in ('consumed', 'released') and "dynamic_plan_usage_reservations"."finalized_at" is not null and "dynamic_plan_usage_reservations"."final_evidence" is not null))
);
--> statement-breakpoint
ALTER TABLE "dynamic_plan_envelope_counters" ADD CONSTRAINT "dynamic_plan_envelope_counters_revision_id_dynamic_plan_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."dynamic_plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_envelope_reservations" ADD CONSTRAINT "dynamic_plan_envelope_reservations_revision_id_dynamic_plan_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."dynamic_plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_live_reservations" ADD CONSTRAINT "dynamic_plan_live_reservations_revision_id_dynamic_plan_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."dynamic_plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_usage_attempts" ADD CONSTRAINT "dynamic_plan_usage_attempts_reservation_id_dynamic_plan_usage_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."dynamic_plan_usage_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_usage_reservations" ADD CONSTRAINT "dynamic_plan_usage_reservations_revision_id_dynamic_plan_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."dynamic_plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_envelope_counters_scope_uidx" ON "dynamic_plan_envelope_counters" USING btree ("account_id","revision_id","period_key","dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_envelope_reservations_operation_uidx" ON "dynamic_plan_envelope_reservations" USING btree ("account_id","operation_key","dimension");--> statement-breakpoint
CREATE INDEX "dynamic_plan_envelope_reservations_scope_idx" ON "dynamic_plan_envelope_reservations" USING btree ("revision_id","period_key","dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_live_reservations_operation_uidx" ON "dynamic_plan_live_reservations" USING btree ("account_id","operation_key");--> statement-breakpoint
CREATE INDEX "dynamic_plan_live_reservations_pending_idx" ON "dynamic_plan_live_reservations" USING btree ("account_id","revision_id","resource_kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_usage_attempts_key_uidx" ON "dynamic_plan_usage_attempts" USING btree ("reservation_id","attempt_key");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_usage_attempts_ordinal_uidx" ON "dynamic_plan_usage_attempts" USING btree ("reservation_id","ordinal");--> statement-breakpoint
CREATE INDEX "dynamic_plan_usage_attempts_account_idx" ON "dynamic_plan_usage_attempts" USING btree ("account_id","claimed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_usage_reservations_operation_uidx" ON "dynamic_plan_usage_reservations" USING btree ("account_id","operation_key");--> statement-breakpoint
CREATE INDEX "dynamic_plan_usage_reservations_revision_period_idx" ON "dynamic_plan_usage_reservations" USING btree ("revision_id","period_key","metric");--> statement-breakpoint
CREATE TRIGGER dynamic_plan_envelope_counters_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_envelope_counters FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER dynamic_plan_envelope_reservations_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_envelope_reservations FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER dynamic_plan_live_reservations_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_live_reservations FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER dynamic_plan_usage_attempts_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_usage_attempts FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER dynamic_plan_usage_reservations_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_usage_reservations FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
