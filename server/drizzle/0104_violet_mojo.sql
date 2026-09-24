CREATE TABLE "dynamic_plan_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"decision_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"source_plan" text NOT NULL,
	"target_plan" text NOT NULL,
	"source_subscription_id" text NOT NULL,
	"source_revision_id" uuid,
	"replacement_quote_id" uuid,
	"target_product_id" text,
	"target_amount_cents" bigint,
	"target_currency" text,
	"target_interval" text,
	"effective_at" timestamp with time zone NOT NULL,
	"provider_cutoff" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"provider_confirmed_at" timestamp with time zone,
	"provider_confirmation_hash" text,
	"incident_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_transitions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "dynamic_plan_transitions_kind_check" CHECK ("dynamic_plan_transitions"."kind" in ('custom_revision', 'custom_to_fixed', 'fixed_to_custom', 'non_renew')),
	CONSTRAINT "dynamic_plan_transitions_status_check" CHECK ("dynamic_plan_transitions"."status" in ('offered', 'accepted', 'provider_pending', 'provider_confirmed', 'awaiting_checkout', 'completed', 'failed', 'canceled', 'emergency_stopped')),
	CONSTRAINT "dynamic_plan_transitions_clock_check" CHECK ("dynamic_plan_transitions"."provider_cutoff" < "dynamic_plan_transitions"."effective_at"),
	CONSTRAINT "dynamic_plan_transitions_target_money_check" CHECK (("dynamic_plan_transitions"."target_amount_cents" is null and "dynamic_plan_transitions"."target_currency" is null and "dynamic_plan_transitions"."target_interval" is null) or ("dynamic_plan_transitions"."target_amount_cents" > 0 and "dynamic_plan_transitions"."target_currency" = 'USD' and "dynamic_plan_transitions"."target_interval" in ('monthly', 'yearly'))),
	CONSTRAINT "dynamic_plan_transitions_confirmation_check" CHECK (("dynamic_plan_transitions"."provider_confirmed_at" is null and "dynamic_plan_transitions"."provider_confirmation_hash" is null) or ("dynamic_plan_transitions"."provider_confirmed_at" is not null and "dynamic_plan_transitions"."provider_confirmation_hash" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE "dynamic_plan_billing_jobs" ADD COLUMN "provider_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dynamic_plan_billing_jobs" ADD COLUMN "provider_confirmation_hash" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_billing_jobs" ADD COLUMN "incident_code" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD COLUMN "notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD COLUMN "acceptance_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD COLUMN "provider_cutoff" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD COLUMN "accepted_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD COLUMN "non_renew_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revisions" ADD COLUMN "provider_order_id" text;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revisions" ADD COLUMN "provider_subscription_id" text;--> statement-breakpoint
UPDATE "dynamic_plan_reprice_decisions" AS d
SET
  "decision" = CASE WHEN d."decision" = 'reprice_or_stop' THEN 'replacement_required' ELSE d."decision" END,
  "notice_at" = d."decided_at",
  "acceptance_deadline" = r."paid_period_end" - interval '7 days',
  "provider_cutoff" = r."paid_period_end" - interval '1 day'
FROM "dynamic_plan_revisions" AS r
WHERE r."id" = d."revision_id";--> statement-breakpoint
UPDATE "dynamic_plan_revisions" AS r
SET
  "provider_order_id" = i."provider_order_id",
  "provider_subscription_id" = i."provider_subscription_id"
FROM "billing_checkout_intents" AS i
WHERE i."custom_revision_id" = r."id"
  AND i."kind" = 'custom'
  AND i."provider_order_id" IS NOT NULL
  AND i."provider_subscription_id" IS NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "dynamic_plan_reprice_decisions"
    WHERE "notice_at" IS NULL OR "acceptance_deadline" IS NULL OR "provider_cutoff" IS NULL
  ) THEN
    RAISE EXCEPTION 'dynamic plan decision deadline backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "dynamic_plan_revisions"
    WHERE "provider_order_id" IS NULL OR "provider_subscription_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'dynamic plan paid-period authority backfill is incomplete';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ALTER COLUMN "notice_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ALTER COLUMN "acceptance_deadline" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ALTER COLUMN "provider_cutoff" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revisions" ALTER COLUMN "provider_order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revisions" ALTER COLUMN "provider_subscription_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dynamic_plan_transitions" ADD CONSTRAINT "dynamic_plan_transitions_decision_id_dynamic_plan_reprice_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."dynamic_plan_reprice_decisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_transitions" ADD CONSTRAINT "dynamic_plan_transitions_source_revision_id_dynamic_plan_revisions_id_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."dynamic_plan_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_transitions" ADD CONSTRAINT "dynamic_plan_transitions_replacement_quote_id_dynamic_plan_quotes_id_fk" FOREIGN KEY ("replacement_quote_id") REFERENCES "public"."dynamic_plan_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_transitions_one_open_base_uidx" ON "dynamic_plan_transitions" USING btree ("account_id") WHERE "dynamic_plan_transitions"."status" in ('offered', 'accepted', 'provider_pending', 'provider_confirmed', 'awaiting_checkout');--> statement-breakpoint
CREATE INDEX "dynamic_plan_transitions_effective_idx" ON "dynamic_plan_transitions" USING btree ("status","effective_at");--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD CONSTRAINT "dynamic_plan_reprice_decisions_accepted_quote_id_dynamic_plan_quotes_id_fk" FOREIGN KEY ("accepted_quote_id") REFERENCES "public"."dynamic_plan_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_revisions_provider_order_uidx" ON "dynamic_plan_revisions" USING btree ("provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_revisions_provider_period_uidx" ON "dynamic_plan_revisions" USING btree ("provider_subscription_id","paid_period_start","paid_period_end");--> statement-breakpoint
ALTER TABLE "dynamic_plan_billing_jobs" ADD CONSTRAINT "dynamic_plan_billing_jobs_confirmation_check" CHECK (("dynamic_plan_billing_jobs"."provider_confirmed_at" is null and "dynamic_plan_billing_jobs"."provider_confirmation_hash" is null) or ("dynamic_plan_billing_jobs"."provider_confirmed_at" is not null and "dynamic_plan_billing_jobs"."provider_confirmation_hash" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD CONSTRAINT "dynamic_plan_reprice_decisions_hash_check" CHECK ("dynamic_plan_reprice_decisions"."evidence_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD CONSTRAINT "dynamic_plan_reprice_decisions_decision_check" CHECK ("dynamic_plan_reprice_decisions"."decision" in ('honor_locked', 'replacement_required', 'stop_before_renewal'));--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD CONSTRAINT "dynamic_plan_reprice_decisions_clock_check" CHECK ("dynamic_plan_reprice_decisions"."acceptance_deadline" <= "dynamic_plan_reprice_decisions"."provider_cutoff");--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD CONSTRAINT "dynamic_plan_reprice_decisions_acceptance_check" CHECK (("dynamic_plan_reprice_decisions"."accepted_quote_id" is null and "dynamic_plan_reprice_decisions"."accepted_at" is null) or ("dynamic_plan_reprice_decisions"."accepted_quote_id" is not null and "dynamic_plan_reprice_decisions"."accepted_at" is not null));--> statement-breakpoint
CREATE TRIGGER dynamic_plan_transitions_account_deletion_guard
BEFORE INSERT OR UPDATE ON dynamic_plan_transitions
FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
