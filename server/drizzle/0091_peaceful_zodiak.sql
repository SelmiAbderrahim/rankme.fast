CREATE TABLE "dynamic_plan_billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"event_kind" text NOT NULL,
	"provider_event_id" text,
	"evidence_hash" text NOT NULL,
	"prior_state" text,
	"next_state" text,
	"amount_cents" bigint,
	"currency" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_billing_events_sequence_check" CHECK ("dynamic_plan_billing_events"."sequence" > 0),
	CONSTRAINT "dynamic_plan_billing_events_hash_check" CHECK ("dynamic_plan_billing_events"."evidence_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_billing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"claimed_by" text,
	"claimed_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"last_error_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_billing_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "dynamic_plan_billing_jobs_attempts_check" CHECK ("dynamic_plan_billing_jobs"."attempts" >= 0 and "dynamic_plan_billing_jobs"."max_attempts" > 0 and "dynamic_plan_billing_jobs"."attempts" <= "dynamic_plan_billing_jobs"."max_attempts"),
	CONSTRAINT "dynamic_plan_billing_jobs_claim_check" CHECK (("dynamic_plan_billing_jobs"."status" = 'claimed' and "dynamic_plan_billing_jobs"."claimed_by" is not null and "dynamic_plan_billing_jobs"."claimed_until" is not null) or "dynamic_plan_billing_jobs"."status" <> 'claimed')
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"initial_quote_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"replaced_by_contract_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "dynamic_plan_contracts_status_check" CHECK ("dynamic_plan_contracts"."status" in ('active', 'replaced', 'canceled', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_pricing_sources" (
	"version_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_checksum" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"stale_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_pricing_sources_pk" PRIMARY KEY("version_id","source_id"),
	CONSTRAINT "dynamic_plan_pricing_sources_checksum_check" CHECK ("dynamic_plan_pricing_sources"."source_checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dynamic_plan_pricing_sources_stale_check" CHECK ("dynamic_plan_pricing_sources"."stale_at" > "dynamic_plan_pricing_sources"."verified_at")
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_pricing_versions" (
	"version_id" text PRIMARY KEY NOT NULL,
	"code_checksum" text NOT NULL,
	"staged_at" timestamp with time zone NOT NULL,
	"new_sales_effective_at" timestamp with time zone,
	"new_sales_ends_at" timestamp with time zone,
	"renewals_effective_at" timestamp with time zone,
	"renewals_ends_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_pricing_versions_code_checksum_unique" UNIQUE("code_checksum"),
	CONSTRAINT "dynamic_plan_pricing_versions_checksum_check" CHECK ("dynamic_plan_pricing_versions"."code_checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dynamic_plan_pricing_versions_new_sales_window_check" CHECK ("dynamic_plan_pricing_versions"."new_sales_ends_at" is null or ("dynamic_plan_pricing_versions"."new_sales_effective_at" is not null and "dynamic_plan_pricing_versions"."new_sales_ends_at" > "dynamic_plan_pricing_versions"."new_sales_effective_at")),
	CONSTRAINT "dynamic_plan_pricing_versions_renewal_window_check" CHECK ("dynamic_plan_pricing_versions"."renewals_ends_at" is null or ("dynamic_plan_pricing_versions"."renewals_effective_at" is not null and "dynamic_plan_pricing_versions"."renewals_ends_at" > "dynamic_plan_pricing_versions"."renewals_effective_at")),
	CONSTRAINT "dynamic_plan_pricing_versions_retired_check" CHECK ("dynamic_plan_pricing_versions"."retired_at" is null or ("dynamic_plan_pricing_versions"."new_sales_ends_at" is not null and "dynamic_plan_pricing_versions"."renewals_ends_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_quote_costs" (
	"quote_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"cost_driver" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "dynamic_plan_quote_costs_pk" PRIMARY KEY("quote_id","cost_driver","source_id"),
	CONSTRAINT "dynamic_plan_quote_costs_amount_check" CHECK ("dynamic_plan_quote_costs"."amount_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_quote_entitlements" (
	"quote_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"entitlement" text NOT NULL,
	"value" text NOT NULL,
	"reset_strategy" text NOT NULL,
	CONSTRAINT "dynamic_plan_quote_entitlements_pk" PRIMARY KEY("quote_id","entitlement")
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_quote_provider_bindings" (
	"quote_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"capability" text NOT NULL,
	"provider" text NOT NULL,
	"cost_source" text NOT NULL,
	"credential_affinity" text,
	CONSTRAINT "dynamic_plan_quote_provider_bindings_pk" PRIMARY KEY("quote_id","capability")
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_quote_selections" (
	"quote_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"control_id" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "dynamic_plan_quote_selections_pk" PRIMARY KEY("quote_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"interval" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"pricing_version_id" text NOT NULL,
	"pricing_checksum" text NOT NULL,
	"canonical_hash" text NOT NULL,
	"pricing_context_key" text NOT NULL,
	"reset_strategy" text DEFAULT 'billing_anchor_month' NOT NULL,
	"reset_anchor" timestamp with time zone NOT NULL,
	"reset_bucket_count" integer NOT NULL,
	"direct_cost_micros" bigint NOT NULL,
	"fee_and_risk_micros" bigint NOT NULL,
	"total_direct_cost_micros" bigint NOT NULL,
	"commercial_price_cents" bigint NOT NULL,
	"minimum_price_cents" bigint NOT NULL,
	"margin_numerator" bigint NOT NULL,
	"margin_denominator" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reserved_by" text,
	"reserved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_quotes_interval_check" CHECK ("dynamic_plan_quotes"."interval" in ('monthly', 'yearly')),
	CONSTRAINT "dynamic_plan_quotes_money_check" CHECK ("dynamic_plan_quotes"."amount_cents" > 0 and "dynamic_plan_quotes"."direct_cost_micros" >= 0 and "dynamic_plan_quotes"."fee_and_risk_micros" >= 0 and "dynamic_plan_quotes"."total_direct_cost_micros" = "dynamic_plan_quotes"."direct_cost_micros" + "dynamic_plan_quotes"."fee_and_risk_micros"),
	CONSTRAINT "dynamic_plan_quotes_margin_check" CHECK ("dynamic_plan_quotes"."margin_numerator" > 0 and "dynamic_plan_quotes"."margin_denominator" > 0 and "dynamic_plan_quotes"."amount_cents" * 10000 * "dynamic_plan_quotes"."margin_denominator" >= "dynamic_plan_quotes"."total_direct_cost_micros" * "dynamic_plan_quotes"."margin_numerator"),
	CONSTRAINT "dynamic_plan_quotes_hash_check" CHECK ("dynamic_plan_quotes"."pricing_checksum" ~ '^[0-9a-f]{64}$' and "dynamic_plan_quotes"."canonical_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "dynamic_plan_quotes_bucket_check" CHECK ("dynamic_plan_quotes"."reset_bucket_count" = case when "dynamic_plan_quotes"."interval" = 'monthly' then 1 else 12 end),
	CONSTRAINT "dynamic_plan_quotes_ttl_check" CHECK ("dynamic_plan_quotes"."expires_at" > "dynamic_plan_quotes"."created_at"),
	CONSTRAINT "dynamic_plan_quotes_state_check" CHECK (("dynamic_plan_quotes"."status" = 'open' and "dynamic_plan_quotes"."reserved_by" is null and "dynamic_plan_quotes"."consumed_at" is null) or ("dynamic_plan_quotes"."status" = 'reserved' and "dynamic_plan_quotes"."reserved_by" is not null and "dynamic_plan_quotes"."reserved_at" is not null and "dynamic_plan_quotes"."consumed_at" is null) or ("dynamic_plan_quotes"."status" = 'consumed' and "dynamic_plan_quotes"."reserved_by" is not null and "dynamic_plan_quotes"."consumed_at" is not null) or ("dynamic_plan_quotes"."status" = 'expired' and "dynamic_plan_quotes"."consumed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_reprice_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"contract_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"pricing_version_id" text NOT NULL,
	"decision" text NOT NULL,
	"current_amount_cents" bigint NOT NULL,
	"required_amount_cents" bigint NOT NULL,
	"evidence_hash" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dynamic_plan_reprice_decisions_money_check" CHECK ("dynamic_plan_reprice_decisions"."current_amount_cents" > 0 and "dynamic_plan_reprice_decisions"."required_amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_reprice_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"decision_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_reprice_notices_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "dynamic_plan_reprice_notices_state_check" CHECK ("dynamic_plan_reprice_notices"."state" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_revision_entitlements" (
	"revision_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"entitlement" text NOT NULL,
	"value" text NOT NULL,
	"reset_strategy" text NOT NULL,
	"reset_anchor" timestamp with time zone NOT NULL,
	CONSTRAINT "dynamic_plan_revision_entitlements_pk" PRIMARY KEY("revision_id","entitlement")
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_revision_provider_bindings" (
	"revision_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"capability" text NOT NULL,
	"provider" text NOT NULL,
	"cost_source" text NOT NULL,
	"credential_affinity" text,
	CONSTRAINT "dynamic_plan_revision_provider_bindings_pk" PRIMARY KEY("revision_id","capability")
);
--> statement-breakpoint
CREATE TABLE "dynamic_plan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"contract_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"quote_id" uuid NOT NULL,
	"pricing_version_id" text NOT NULL,
	"pricing_checksum" text NOT NULL,
	"canonical_hash" text NOT NULL,
	"pricing_context_key" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"interval" text NOT NULL,
	"paid_period_start" timestamp with time zone NOT NULL,
	"paid_period_end" timestamp with time zone NOT NULL,
	"reset_strategy" text NOT NULL,
	"reset_anchor" timestamp with time zone NOT NULL,
	"reset_bucket_count" integer NOT NULL,
	"direct_cost_micros" bigint NOT NULL,
	"total_direct_cost_micros" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"replaces_revision_id" uuid,
	"activated_at" timestamp with time zone,
	"replaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dynamic_plan_revisions_revision_check" CHECK ("dynamic_plan_revisions"."revision" > 0),
	CONSTRAINT "dynamic_plan_revisions_period_check" CHECK ("dynamic_plan_revisions"."paid_period_end" > "dynamic_plan_revisions"."paid_period_start"),
	CONSTRAINT "dynamic_plan_revisions_money_check" CHECK ("dynamic_plan_revisions"."amount_cents" > 0 and "dynamic_plan_revisions"."direct_cost_micros" >= 0 and "dynamic_plan_revisions"."total_direct_cost_micros" >= "dynamic_plan_revisions"."direct_cost_micros"),
	CONSTRAINT "dynamic_plan_revisions_bucket_check" CHECK ("dynamic_plan_revisions"."reset_bucket_count" = case when "dynamic_plan_revisions"."interval" = 'monthly' then 1 else 12 end),
	CONSTRAINT "dynamic_plan_revisions_hash_check" CHECK ("dynamic_plan_revisions"."pricing_checksum" ~ '^[0-9a-f]{64}$' and "dynamic_plan_revisions"."canonical_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "provider_subscription_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_subscription_bindings_kind_check" CHECK ("provider_subscription_bindings"."kind" in ('fixed', 'custom', 'addon', 'enterprise'))
);
--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" DROP CONSTRAINT "billing_checkout_intents_kind_check";--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" DROP CONSTRAINT "billing_checkout_intents_status_check";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_status_check";--> statement-breakpoint
DROP INDEX "billing_checkout_intents_open_product_uidx";--> statement-breakpoint
DROP INDEX "billing_checkout_intents_open_recurring_uidx";--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "plan_source" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "custom_quote_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "custom_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD COLUMN "custom_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "plan_source" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "custom_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "custom_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "dynamic_plan_contracts" ADD CONSTRAINT "dynamic_plan_contracts_initial_quote_id_dynamic_plan_quotes_id_fk" FOREIGN KEY ("initial_quote_id") REFERENCES "public"."dynamic_plan_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_sources" ADD CONSTRAINT "dynamic_plan_pricing_sources_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quote_costs" ADD CONSTRAINT "dynamic_plan_quote_costs_quote_id_dynamic_plan_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."dynamic_plan_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quote_entitlements" ADD CONSTRAINT "dynamic_plan_quote_entitlements_quote_id_dynamic_plan_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."dynamic_plan_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quote_provider_bindings" ADD CONSTRAINT "dynamic_plan_quote_provider_bindings_quote_id_dynamic_plan_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."dynamic_plan_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quote_selections" ADD CONSTRAINT "dynamic_plan_quote_selections_quote_id_dynamic_plan_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."dynamic_plan_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quotes" ADD CONSTRAINT "dynamic_plan_quotes_pricing_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD CONSTRAINT "dynamic_plan_reprice_decisions_contract_id_dynamic_plan_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."dynamic_plan_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD CONSTRAINT "dynamic_plan_reprice_decisions_revision_id_dynamic_plan_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."dynamic_plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" ADD CONSTRAINT "dynamic_plan_reprice_decisions_pricing_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_notices" ADD CONSTRAINT "dynamic_plan_reprice_notices_decision_id_dynamic_plan_reprice_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."dynamic_plan_reprice_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revision_entitlements" ADD CONSTRAINT "dynamic_plan_revision_entitlements_revision_id_dynamic_plan_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."dynamic_plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revision_provider_bindings" ADD CONSTRAINT "dynamic_plan_revision_provider_bindings_revision_id_dynamic_plan_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."dynamic_plan_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revisions" ADD CONSTRAINT "dynamic_plan_revisions_contract_id_dynamic_plan_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."dynamic_plan_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revisions" ADD CONSTRAINT "dynamic_plan_revisions_quote_id_dynamic_plan_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."dynamic_plan_quotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revisions" ADD CONSTRAINT "dynamic_plan_revisions_pricing_version_id_dynamic_plan_pricing_versions_version_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."dynamic_plan_pricing_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_billing_events_sequence_uidx" ON "dynamic_plan_billing_events" USING btree ("aggregate_type","aggregate_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_billing_events_provider_event_uidx" ON "dynamic_plan_billing_events" USING btree ("provider_event_id") WHERE "dynamic_plan_billing_events"."provider_event_id" is not null;--> statement-breakpoint
CREATE INDEX "dynamic_plan_billing_events_account_idx" ON "dynamic_plan_billing_events" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "dynamic_plan_billing_jobs_claim_idx" ON "dynamic_plan_billing_jobs" USING btree ("status","available_at","claimed_until");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_contracts_one_active_uidx" ON "dynamic_plan_contracts" USING btree ("account_id") WHERE "dynamic_plan_contracts"."status" = 'active';--> statement-breakpoint
CREATE INDEX "dynamic_plan_pricing_versions_new_sales_idx" ON "dynamic_plan_pricing_versions" USING btree ("new_sales_effective_at","new_sales_ends_at");--> statement-breakpoint
CREATE INDEX "dynamic_plan_pricing_versions_renewals_idx" ON "dynamic_plan_pricing_versions" USING btree ("renewals_effective_at","renewals_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_quotes_account_idempotency_uidx" ON "dynamic_plan_quotes" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "dynamic_plan_quotes_expiry_idx" ON "dynamic_plan_quotes" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_reprice_decisions_revision_version_uidx" ON "dynamic_plan_reprice_decisions" USING btree ("revision_id","pricing_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_revisions_contract_revision_uidx" ON "dynamic_plan_revisions" USING btree ("contract_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "dynamic_plan_revisions_one_active_uidx" ON "dynamic_plan_revisions" USING btree ("contract_id") WHERE "dynamic_plan_revisions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "provider_subscription_bindings_provider_subscription_uidx" ON "provider_subscription_bindings" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_subscription_bindings_target_uidx" ON "provider_subscription_bindings" USING btree ("kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_open_base_uidx" ON "billing_checkout_intents" USING btree ("account_id") WHERE "billing_checkout_intents"."kind" in ('base', 'custom') and "billing_checkout_intents"."status" in ('creating', 'unknown', 'open');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_open_product_uidx" ON "billing_checkout_intents" USING btree ("account_id","product_id") WHERE "billing_checkout_intents"."status" in ('creating', 'unknown', 'open');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_intents_open_recurring_uidx" ON "billing_checkout_intents" USING btree ("account_id","kind") WHERE "billing_checkout_intents"."kind" in ('base', 'custom', 'daily_rank', 'brand_radar', 'app_seo') and "billing_checkout_intents"."status" in ('creating', 'unknown', 'open');--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_plan_source_check" CHECK ("billing_checkout_intents"."plan_source" in ('fixed', 'custom', 'enterprise', 'addon', 'pack'));--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_custom_linkage_check" CHECK (("billing_checkout_intents"."kind" = 'custom' and "billing_checkout_intents"."plan_source" = 'custom' and "billing_checkout_intents"."custom_quote_id" is not null) or ("billing_checkout_intents"."kind" <> 'custom' and "billing_checkout_intents"."custom_quote_id" is null and "billing_checkout_intents"."custom_contract_id" is null and "billing_checkout_intents"."custom_revision_id" is null));--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_kind_check" CHECK ("billing_checkout_intents"."kind" in ('base', 'custom', 'daily_rank', 'brand_radar', 'app_seo', 'pack'));--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" ADD CONSTRAINT "billing_checkout_intents_status_check" CHECK ("billing_checkout_intents"."status" in ('creating', 'unknown', 'open', 'paid', 'compensating', 'completed', 'expired', 'failed'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_source_check" CHECK ("subscriptions"."plan_source" in ('fixed', 'custom', 'enterprise'));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_custom_linkage_check" CHECK (("subscriptions"."plan_source" = 'custom' and "subscriptions"."custom_contract_id" is not null and "subscriptions"."custom_revision_id" is not null) or ("subscriptions"."plan_source" <> 'custom' and "subscriptions"."custom_contract_id" is null and "subscriptions"."custom_revision_id" is null));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('trialing', 'active', 'past_due', 'canceled', 'revoked', 'paused', 'unpaid', 'incomplete', 'incomplete_expired', 'none', 'unknown'));
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT 'polar'::text AS provider, polar_subscription_id AS provider_subscription_id
      FROM subscriptions WHERE polar_subscription_id IS NOT NULL
      UNION ALL
      SELECT provider, provider_subscription_id FROM subscription_addons
    ) legacy
    GROUP BY provider, provider_subscription_id HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'duplicate legacy provider subscription binding'; END IF;
END $$;
--> statement-breakpoint
INSERT INTO provider_subscription_bindings
  (account_id, provider, provider_subscription_id, kind, target_id)
SELECT account_id, 'polar', polar_subscription_id,
  CASE WHEN plan_source = 'custom' THEN 'custom' WHEN tier = 'enterprise' THEN 'enterprise' ELSE 'fixed' END,
  CASE WHEN plan_source = 'custom' THEN custom_contract_id::text ELSE id::text END
FROM subscriptions WHERE polar_subscription_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO provider_subscription_bindings
  (account_id, provider, provider_subscription_id, kind, target_id)
SELECT account_id, provider, provider_subscription_id, 'addon', id::text FROM subscription_addons;
--> statement-breakpoint
CREATE FUNCTION sync_base_subscription_binding() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM provider_subscription_bindings
      WHERE kind IN ('fixed', 'custom', 'enterprise') AND target_id = OLD.id::text;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.polar_subscription_id IS DISTINCT FROM NEW.polar_subscription_id THEN
    DELETE FROM provider_subscription_bindings
      WHERE provider = 'polar' AND provider_subscription_id = OLD.polar_subscription_id;
  END IF;
  IF NEW.polar_subscription_id IS NOT NULL THEN
    INSERT INTO provider_subscription_bindings
      (account_id, provider, provider_subscription_id, kind, target_id, updated_at)
    VALUES (NEW.account_id, 'polar', NEW.polar_subscription_id,
      CASE WHEN NEW.plan_source = 'custom' THEN 'custom' WHEN NEW.tier = 'enterprise' THEN 'enterprise' ELSE 'fixed' END,
      CASE WHEN NEW.plan_source = 'custom' THEN NEW.custom_contract_id::text ELSE NEW.id::text END, now())
    ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET
      account_id = EXCLUDED.account_id, kind = EXCLUDED.kind,
      target_id = EXCLUDED.target_id, updated_at = now()
    WHERE provider_subscription_bindings.account_id = EXCLUDED.account_id
      AND provider_subscription_bindings.target_id = EXCLUDED.target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'provider subscription binding conflict'; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER subscriptions_provider_binding_dual_write
AFTER INSERT OR UPDATE OF account_id, polar_subscription_id, tier, plan_source, custom_contract_id OR DELETE
ON subscriptions FOR EACH ROW EXECUTE FUNCTION sync_base_subscription_binding();
--> statement-breakpoint
CREATE FUNCTION sync_addon_subscription_binding() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM provider_subscription_bindings WHERE kind = 'addon' AND target_id = OLD.id::text;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.provider, OLD.provider_subscription_id) IS DISTINCT FROM (NEW.provider, NEW.provider_subscription_id) THEN
    DELETE FROM provider_subscription_bindings
      WHERE provider = OLD.provider AND provider_subscription_id = OLD.provider_subscription_id;
  END IF;
  INSERT INTO provider_subscription_bindings
    (account_id, provider, provider_subscription_id, kind, target_id, updated_at)
  VALUES (NEW.account_id, NEW.provider, NEW.provider_subscription_id, 'addon', NEW.id::text, now())
  ON CONFLICT (provider, provider_subscription_id) DO UPDATE SET
    account_id = EXCLUDED.account_id, target_id = EXCLUDED.target_id, updated_at = now()
  WHERE provider_subscription_bindings.kind = 'addon'
    AND provider_subscription_bindings.account_id = EXCLUDED.account_id
    AND provider_subscription_bindings.target_id = EXCLUDED.target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider subscription binding conflict'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER subscription_addons_provider_binding_dual_write
AFTER INSERT OR UPDATE OF account_id, provider, provider_subscription_id OR DELETE
ON subscription_addons FOR EACH ROW EXECUTE FUNCTION sync_addon_subscription_binding();
--> statement-breakpoint
CREATE FUNCTION reject_dynamic_plan_lifecycle_overlap() RETURNS trigger AS $$
BEGIN
  IF NEW.new_sales_effective_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM dynamic_plan_pricing_versions other
    WHERE other.version_id <> NEW.version_id AND other.new_sales_effective_at IS NOT NULL
      AND tstzrange(other.new_sales_effective_at, other.new_sales_ends_at, '[)')
          && tstzrange(NEW.new_sales_effective_at, NEW.new_sales_ends_at, '[)')
  ) THEN RAISE EXCEPTION 'overlapping dynamic plan new-sale lifecycle window'; END IF;
  IF NEW.renewals_effective_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM dynamic_plan_pricing_versions other
    WHERE other.version_id <> NEW.version_id AND other.renewals_effective_at IS NOT NULL
      AND tstzrange(other.renewals_effective_at, other.renewals_ends_at, '[)')
          && tstzrange(NEW.renewals_effective_at, NEW.renewals_ends_at, '[)')
  ) THEN RAISE EXCEPTION 'overlapping dynamic plan renewal lifecycle window'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_pricing_versions_no_overlap
BEFORE INSERT OR UPDATE OF new_sales_effective_at, new_sales_ends_at, renewals_effective_at, renewals_ends_at
ON dynamic_plan_pricing_versions FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_lifecycle_overlap();
--> statement-breakpoint
CREATE FUNCTION protect_dynamic_plan_pricing_identity() RETURNS trigger AS $$
BEGIN
  IF OLD.version_id IS DISTINCT FROM NEW.version_id OR OLD.code_checksum IS DISTINCT FROM NEW.code_checksum
    OR OLD.staged_at IS DISTINCT FROM NEW.staged_at OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN RAISE EXCEPTION 'immutable dynamic plan pricing identity'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_pricing_versions_immutable_identity
BEFORE UPDATE ON dynamic_plan_pricing_versions FOR EACH ROW EXECUTE FUNCTION protect_dynamic_plan_pricing_identity();
--> statement-breakpoint
CREATE FUNCTION reject_dynamic_plan_snapshot_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'immutable dynamic plan economic snapshot'; END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_pricing_sources_immutable BEFORE UPDATE ON dynamic_plan_pricing_sources FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quote_selections_immutable BEFORE UPDATE ON dynamic_plan_quote_selections FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quote_costs_immutable BEFORE UPDATE ON dynamic_plan_quote_costs FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quote_entitlements_immutable BEFORE UPDATE ON dynamic_plan_quote_entitlements FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quote_provider_bindings_immutable BEFORE UPDATE ON dynamic_plan_quote_provider_bindings FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_revision_entitlements_immutable BEFORE UPDATE ON dynamic_plan_revision_entitlements FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_revision_provider_bindings_immutable BEFORE UPDATE ON dynamic_plan_revision_provider_bindings FOR EACH ROW EXECUTE FUNCTION reject_dynamic_plan_snapshot_update();
--> statement-breakpoint
CREATE FUNCTION protect_dynamic_plan_quote_economics() RETURNS trigger AS $$
BEGIN
  IF (OLD.account_id, OLD.interval, OLD.amount_cents, OLD.currency, OLD.pricing_version_id, OLD.pricing_checksum,
      OLD.canonical_hash, OLD.pricing_context_key, OLD.reset_strategy, OLD.reset_anchor, OLD.reset_bucket_count,
      OLD.direct_cost_micros, OLD.fee_and_risk_micros, OLD.total_direct_cost_micros, OLD.commercial_price_cents,
      OLD.minimum_price_cents, OLD.margin_numerator, OLD.margin_denominator, OLD.idempotency_key, OLD.expires_at, OLD.created_at)
     IS DISTINCT FROM
     (NEW.account_id, NEW.interval, NEW.amount_cents, NEW.currency, NEW.pricing_version_id, NEW.pricing_checksum,
      NEW.canonical_hash, NEW.pricing_context_key, NEW.reset_strategy, NEW.reset_anchor, NEW.reset_bucket_count,
      NEW.direct_cost_micros, NEW.fee_and_risk_micros, NEW.total_direct_cost_micros, NEW.commercial_price_cents,
      NEW.minimum_price_cents, NEW.margin_numerator, NEW.margin_denominator, NEW.idempotency_key, NEW.expires_at, NEW.created_at)
  THEN RAISE EXCEPTION 'immutable dynamic plan quote economics'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quotes_immutable_economics BEFORE UPDATE ON dynamic_plan_quotes FOR EACH ROW EXECUTE FUNCTION protect_dynamic_plan_quote_economics();
--> statement-breakpoint
CREATE FUNCTION protect_dynamic_plan_revision_economics() RETURNS trigger AS $$
BEGIN
  IF (OLD.account_id, OLD.contract_id, OLD.revision, OLD.quote_id, OLD.pricing_version_id, OLD.pricing_checksum,
      OLD.canonical_hash, OLD.pricing_context_key, OLD.amount_cents, OLD.currency, OLD.interval,
      OLD.paid_period_start, OLD.paid_period_end, OLD.reset_strategy, OLD.reset_anchor, OLD.reset_bucket_count,
      OLD.direct_cost_micros, OLD.total_direct_cost_micros, OLD.replaces_revision_id, OLD.created_at)
     IS DISTINCT FROM
     (NEW.account_id, NEW.contract_id, NEW.revision, NEW.quote_id, NEW.pricing_version_id, NEW.pricing_checksum,
      NEW.canonical_hash, NEW.pricing_context_key, NEW.amount_cents, NEW.currency, NEW.interval,
      NEW.paid_period_start, NEW.paid_period_end, NEW.reset_strategy, NEW.reset_anchor, NEW.reset_bucket_count,
      NEW.direct_cost_micros, NEW.total_direct_cost_micros, NEW.replaces_revision_id, NEW.created_at)
  THEN RAISE EXCEPTION 'immutable dynamic plan revision economics'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_revisions_immutable_economics BEFORE UPDATE ON dynamic_plan_revisions FOR EACH ROW EXECUTE FUNCTION protect_dynamic_plan_revision_economics();
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_billing_events_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_billing_events FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_billing_jobs_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_billing_jobs FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_contracts_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_contracts FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quote_costs_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_quote_costs FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quote_entitlements_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_quote_entitlements FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quote_provider_bindings_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_quote_provider_bindings FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quote_selections_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_quote_selections FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_quotes_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_quotes FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_reprice_decisions_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_reprice_decisions FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_reprice_notices_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_reprice_notices FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_revision_entitlements_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_revision_entitlements FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_revision_provider_bindings_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_revision_provider_bindings FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_revisions_account_deletion_guard BEFORE INSERT OR UPDATE ON dynamic_plan_revisions FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER provider_subscription_bindings_account_deletion_guard BEFORE INSERT OR UPDATE ON provider_subscription_bindings FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
