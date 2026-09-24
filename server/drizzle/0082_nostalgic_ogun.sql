CREATE TABLE "enterprise_agreement_caps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"cap" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprise_agreement_caps_metric_check" CHECK ("enterprise_agreement_caps"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses', 'audience_research_runs', 'content_inventory_page_blocks', 'competitor_content_runs', 'content_monitor_checks', 'trend_explorations', 'traffic_snapshots', 'link_intel_checks', 'review_syncs', 'brand_mention_scans', 'keyword_cluster_runs', 'cannibalization_reports', 'alt_engine_checks', 'toxicity_reviews', 'internal_link_runs', 'content_briefs', 'geogrid_scans', 'schema_generations', 'ai_chat_messages', 'ai_visibility_suggestion_runs', 'alertRules', 'altEngineKeywordSlots', 'scheduledReports', 'portalClients')),
	CONSTRAINT "enterprise_agreement_caps_cap_check" CHECK ("enterprise_agreement_caps"."cap" is null or "enterprise_agreement_caps"."cap" >= 0)
);
--> statement-breakpoint
CREATE TABLE "enterprise_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"price_monthly_cents" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"seats" bigint,
	"polar_product_id" text,
	"notes" text,
	"created_by" text NOT NULL,
	"activated_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enterprise_agreements_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "enterprise_agreements_polar_product_id_unique" UNIQUE("polar_product_id"),
	CONSTRAINT "enterprise_agreements_status_check" CHECK ("enterprise_agreements"."status" in ('draft', 'active', 'suspended', 'ended')),
	CONSTRAINT "enterprise_agreements_price_check" CHECK ("enterprise_agreements"."price_monthly_cents" >= 0),
	CONSTRAINT "enterprise_agreements_seats_check" CHECK ("enterprise_agreements"."seats" is null or "enterprise_agreements"."seats" >= 0)
);
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_tier_check";--> statement-breakpoint
CREATE UNIQUE INDEX "enterprise_agreement_caps_agreement_metric_uidx" ON "enterprise_agreement_caps" USING btree ("agreement_id","metric");--> statement-breakpoint
CREATE INDEX "enterprise_agreement_caps_agreement_idx" ON "enterprise_agreement_caps" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "enterprise_agreements_status_idx" ON "enterprise_agreements" USING btree ("status");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tier_check" CHECK ("subscriptions"."tier" in ('free', 'starter', 'pro', 'agency', 'enterprise'));