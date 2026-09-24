CREATE TABLE "dynamic_plan_payment_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"intent_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"provider_checkout_id" text,
	"provider_subscription_id" text,
	"provider_order_id" text,
	"provider_refund_id" text,
	"provider_customer_id" text,
	"product_id" text,
	"provider_price_id" text,
	"status" text NOT NULL,
	"billing_reason" text,
	"amount_cents" bigint,
	"net_amount_cents" bigint,
	"discount_amount_cents" bigint,
	"tax_amount_cents" bigint,
	"total_amount_cents" bigint,
	"applied_balance_amount_cents" bigint,
	"due_amount_cents" bigint,
	"refunded_amount_cents" bigint,
	"currency" text,
	"recurring_interval" text,
	"recurring_interval_count" integer,
	"allows_discount_codes" boolean,
	"allows_trial" boolean,
	"contract_matches" boolean,
	"paid" boolean,
	"has_proration" boolean,
	"discount_id" text,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"seats" integer,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"metadata_matches" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"resource_modified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_payment_evidence_kind_check" CHECK ("dynamic_plan_payment_evidence"."kind" in ('checkout', 'subscription', 'order', 'refund')),
	CONSTRAINT "dynamic_plan_payment_evidence_money_check" CHECK (
      ("dynamic_plan_payment_evidence"."amount_cents" is null or "dynamic_plan_payment_evidence"."amount_cents" >= 0)
      and ("dynamic_plan_payment_evidence"."net_amount_cents" is null or "dynamic_plan_payment_evidence"."net_amount_cents" >= 0)
      and ("dynamic_plan_payment_evidence"."discount_amount_cents" is null or "dynamic_plan_payment_evidence"."discount_amount_cents" >= 0)
      and ("dynamic_plan_payment_evidence"."refunded_amount_cents" is null or "dynamic_plan_payment_evidence"."refunded_amount_cents" >= 0)
    ),
	CONSTRAINT "dynamic_plan_payment_evidence_period_check" CHECK ("dynamic_plan_payment_evidence"."period_start" is null or ("dynamic_plan_payment_evidence"."period_end" is not null and "dynamic_plan_payment_evidence"."period_end" > "dynamic_plan_payment_evidence"."period_start"))
);
--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "provider_customer_id" text;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "provider_order_id" text;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "compensation_refund_id" text;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "incident_code" text;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "compensated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_payment_evidence_provider_event_uidx" ON "dynamic_plan_payment_evidence" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "dynamic_plan_payment_evidence_intent_idx" ON "dynamic_plan_payment_evidence" USING btree ("intent_id","kind");--> statement-breakpoint
CREATE INDEX "dynamic_plan_payment_evidence_checkout_idx" ON "dynamic_plan_payment_evidence" USING btree ("provider_checkout_id");--> statement-breakpoint
CREATE INDEX "dynamic_plan_payment_evidence_subscription_idx" ON "dynamic_plan_payment_evidence" USING btree ("provider_subscription_id");--> statement-breakpoint
CREATE INDEX "dynamic_plan_payment_evidence_order_idx" ON "dynamic_plan_payment_evidence" USING btree ("provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_provider_checkout_uidx" ON "billing_checkout_intents" USING btree ("provider_checkout_id") WHERE "billing_checkout_intents"."provider_checkout_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_provider_order_uidx" ON "billing_checkout_intents" USING btree ("provider_order_id") WHERE "billing_checkout_intents"."provider_order_id" is not null;