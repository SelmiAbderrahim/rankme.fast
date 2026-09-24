CREATE TABLE "billing_checkout_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"product_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_checkout_id" text,
	"checkout_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkout_intents_kind_check" CHECK ("billing_checkout_intents"."kind" in ('base', 'daily_rank', 'brand_radar', 'pack')),
	CONSTRAINT "billing_checkout_intents_status_check" CHECK ("billing_checkout_intents"."status" in ('creating', 'open', 'completed', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider" text DEFAULT 'polar' NOT NULL,
	"provider_customer_id" text NOT NULL,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_refund_id" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"last_event_at" timestamp with time zone NOT NULL,
	"last_event_id" text,
	"last_event_rank" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_refunds_status_check" CHECK ("billing_refunds"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "subscription_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text DEFAULT 'polar' NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"pause_at_period_end" boolean DEFAULT false NOT NULL,
	"resumes_at" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"last_event_id" text,
	"last_event_rank" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_addons_kind_check" CHECK ("subscription_addons"."kind" in ('daily_rank', 'brand_radar')),
	CONSTRAINT "subscription_addons_status_check" CHECK ("subscription_addons"."status" in ('active', 'trialing', 'past_due', 'paused', 'canceled', 'revoked', 'unpaid', 'incomplete', 'incomplete_expired'))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_status_check";--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "related_polar_order_id" text;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "source_event_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "refunded_amount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "refund_status" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "refund_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "last_event_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "last_event_rank" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "product_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pause_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "resumes_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_event_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_event_rank" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_idempotency_uidx" ON "billing_checkout_intents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_open_product_uidx" ON "billing_checkout_intents" USING btree ("account_id","product_id") WHERE "billing_checkout_intents"."status" in ('creating', 'open');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_open_recurring_uidx" ON "billing_checkout_intents" USING btree ("account_id","kind") WHERE "billing_checkout_intents"."kind" in ('base', 'daily_rank', 'brand_radar') and "billing_checkout_intents"."status" in ('creating', 'open');--> statement-breakpoint
CREATE INDEX "billing_checkout_intents_expiry_idx" ON "billing_checkout_intents" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_account_provider_uidx" ON "billing_customers" USING btree ("account_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_provider_customer_uidx" ON "billing_customers" USING btree ("provider","provider_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_refunds_provider_refund_uidx" ON "billing_refunds" USING btree ("provider_refund_id");--> statement-breakpoint
CREATE INDEX "billing_refunds_order_idx" ON "billing_refunds" USING btree ("provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_addons_provider_subscription_uidx" ON "subscription_addons" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_addons_account_kind_idx" ON "subscription_addons" USING btree ("account_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_source_event_id_uidx" ON "credit_ledger" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_related_order_idx" ON "credit_ledger" USING btree ("related_polar_order_id");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('trialing', 'active', 'past_due', 'canceled', 'revoked', 'paused', 'unpaid', 'incomplete', 'incomplete_expired', 'none'));