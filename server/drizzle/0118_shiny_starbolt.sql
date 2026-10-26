CREATE TABLE "rank_check_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"keyword_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rank_check_job_items_state_check" CHECK ("rank_check_job_items"."state" in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "rank_check_job_items_attempts_check" CHECK ("rank_check_job_items"."attempts" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "rank_check_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text,
	"retry_of_job_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rank_check_jobs_status_check" CHECK ("rank_check_jobs"."status" in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
	CONSTRAINT "rank_check_jobs_scope_check" CHECK ("rank_check_jobs"."scope" in ('site', 'keyword', 'retry'))
);
--> statement-breakpoint
CREATE TABLE "rank_check_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"keyword_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"first_attempt_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"retry_deadline" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rank_check_outcomes_status_check" CHECK ("rank_check_outcomes"."status" in ('checked', 'failed', 'skipped')),
	CONSTRAINT "rank_check_outcomes_attempts_check" CHECK ("rank_check_outcomes"."attempts" between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "billing_checkout_intents" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_customers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_refunds" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_ledger" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_pack_liabilities" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_billing_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_billing_jobs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_contracts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_cost_reconciliations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_cost_telemetry_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_envelope_counters" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_envelope_reservations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_live_reservations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_operational_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_payment_evidence" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_lifecycle_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_sources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_pricing_versions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quote_costs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quote_entitlements" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quote_provider_bindings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quote_selections" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_quotes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_release_guard_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_decisions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_reprice_notices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revision_entitlements" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revision_provider_bindings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_revisions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_runtime_envelopes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_transitions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_usage_attempts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dynamic_plan_usage_reservations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "enterprise_agreement_caps" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "enterprise_agreements" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_subscription_bindings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription_addons" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_activity_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "usage_counters" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "billing_checkout_intents" CASCADE;--> statement-breakpoint
DROP TABLE "billing_customers" CASCADE;--> statement-breakpoint
DROP TABLE "billing_refunds" CASCADE;--> statement-breakpoint
DROP TABLE "credit_ledger" CASCADE;--> statement-breakpoint
DROP TABLE "credit_pack_liabilities" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_billing_events" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_billing_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_contracts" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_cost_reconciliations" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_cost_telemetry_events" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_envelope_counters" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_envelope_reservations" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_live_reservations" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_operational_events" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_payment_evidence" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_pricing_lifecycle_events" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_pricing_sources" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_pricing_versions" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_quote_costs" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_quote_entitlements" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_quote_provider_bindings" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_quote_selections" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_quotes" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_release_guard_events" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_reprice_decisions" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_reprice_notices" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_revision_entitlements" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_revision_provider_bindings" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_revisions" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_runtime_envelopes" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_transitions" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_usage_attempts" CASCADE;--> statement-breakpoint
DROP TABLE "dynamic_plan_usage_reservations" CASCADE;--> statement-breakpoint
DROP TABLE "enterprise_agreement_caps" CASCADE;--> statement-breakpoint
DROP TABLE "enterprise_agreements" CASCADE;--> statement-breakpoint
DROP TABLE "invoices" CASCADE;--> statement-breakpoint
DROP TABLE "provider_subscription_bindings" CASCADE;--> statement-breakpoint
DROP TABLE "subscription_addons" CASCADE;--> statement-breakpoint
DROP TABLE "subscriptions" CASCADE;--> statement-breakpoint
DROP TABLE "usage_activity_events" CASCADE;--> statement-breakpoint
DROP TABLE "usage_counters" CASCADE;--> statement-breakpoint
DROP INDEX "keywords_site_active_idx";--> statement-breakpoint
ALTER TABLE "rank_check_job_items" ADD CONSTRAINT "rank_check_job_items_job_id_rank_check_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."rank_check_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_check_job_items" ADD CONSTRAINT "rank_check_job_items_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_check_outcomes" ADD CONSTRAINT "rank_check_outcomes_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_check_job_items_job_keyword_uq" ON "rank_check_job_items" USING btree ("job_id","keyword_id");--> statement-breakpoint
CREATE INDEX "rank_check_job_items_keyword_idx" ON "rank_check_job_items" USING btree ("keyword_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rank_check_jobs_idempotency_uq" ON "rank_check_jobs" USING btree ("account_id","site_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "rank_check_jobs_site_created_idx" ON "rank_check_jobs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "rank_check_jobs_open_deadline_idx" ON "rank_check_jobs" USING btree ("deadline_at") WHERE "rank_check_jobs"."finished_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_check_outcomes_keyword_period_uq" ON "rank_check_outcomes" USING btree ("keyword_id","period_key");--> statement-breakpoint
CREATE INDEX "rank_check_outcomes_site_period_idx" ON "rank_check_outcomes" USING btree ("site_id","period_key");--> statement-breakpoint
CREATE INDEX "keywords_site_active_created_idx" ON "keywords" USING btree ("site_id","active","created_at","id");--> statement-breakpoint
CREATE TRIGGER rank_check_jobs_site_deletion_guard BEFORE INSERT OR UPDATE ON rank_check_jobs FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER rank_check_outcomes_site_deletion_guard BEFORE INSERT OR UPDATE ON rank_check_outcomes FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER rank_check_jobs_account_deletion_guard BEFORE INSERT OR UPDATE ON rank_check_jobs FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER rank_check_outcomes_account_deletion_guard BEFORE INSERT OR UPDATE ON rank_check_outcomes FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
