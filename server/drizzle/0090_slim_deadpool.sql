CREATE TEMP TABLE "enterprise_legacy_null_caps" ON COMMIT DROP AS
SELECT
	"caps"."agreement_id",
	"agreements"."account_id",
	"agreements"."status",
	"caps"."metric"
FROM "enterprise_agreement_caps" AS "caps"
INNER JOIN "enterprise_agreements" AS "agreements"
	ON "agreements"."id" = "caps"."agreement_id"
WHERE "caps"."cap" IS NULL;--> statement-breakpoint
ALTER TABLE "enterprise_agreement_caps" DROP CONSTRAINT "enterprise_agreement_caps_cap_check";--> statement-breakpoint
ALTER TABLE "enterprise_agreements" DROP CONSTRAINT "enterprise_agreements_seats_check";--> statement-breakpoint
UPDATE "enterprise_agreements"
SET "seats" = CASE
	WHEN "seats" IS NULL THEN 25
	WHEN "seats" < 1 THEN 1
	WHEN "seats" > 250 THEN 250
	ELSE "seats"
END;--> statement-breakpoint
UPDATE "enterprise_agreement_caps"
SET "cap" = LEAST(
	"cap",
	CASE "metric"
		WHEN 'sites' THEN 1000
		WHEN 'keywords_tracked' THEN 20000
		WHEN 'audits' THEN 450
		WHEN 'audit_pages' THEN 50000
		WHEN 'serp_checks' THEN 100000
		WHEN 'backlink_rows' THEN 1000000
		WHEN 'ai_summaries' THEN 4800
		WHEN 'competitor_lookups' THEN 5000
		WHEN 'ai_mentions_checks' THEN 300
		WHEN 'keyword_lookups' THEN 1000
		WHEN 'local_listing_checks' THEN 600
		WHEN 'content_analyses' THEN 300
		WHEN 'audience_research_runs' THEN 300
		WHEN 'content_inventory_page_blocks' THEN 750
		WHEN 'competitor_content_runs' THEN 1000
		WHEN 'content_monitor_checks' THEN 250
		WHEN 'trend_explorations' THEN 800
		WHEN 'traffic_snapshots' THEN 800
		WHEN 'link_intel_checks' THEN 800
		WHEN 'review_syncs' THEN 500
		WHEN 'brand_mention_scans' THEN 200
		WHEN 'keyword_cluster_runs' THEN 200
		WHEN 'cannibalization_reports' THEN 1000
		WHEN 'alt_engine_checks' THEN 2400
		WHEN 'toxicity_reviews' THEN 120
		WHEN 'internal_link_runs' THEN 250
		WHEN 'content_briefs' THEN 80
		WHEN 'geogrid_scans' THEN 60
		WHEN 'schema_generations' THEN 600
		WHEN 'ai_chat_messages' THEN 4000
		WHEN 'ai_visibility_suggestion_runs' THEN 200
		WHEN 'app_keyword_checks' THEN 500
		WHEN 'app_listing_audits' THEN 40
		WHEN 'app_chart_checks' THEN 200
		WHEN 'app_keyword_lookups' THEN 20
		WHEN 'app_competitor_lookups' THEN 100
		WHEN 'app_review_runs' THEN 100
		WHEN 'alertRules' THEN 500
		WHEN 'altEngineKeywordSlots' THEN 300
		WHEN 'scheduledReports' THEN 200
		WHEN 'portalClients' THEN 250
		WHEN 'appProfiles' THEN 50
		WHEN 'appKeywordSlots' THEN 500
		ELSE -1
	END
)
WHERE "cap" IS NOT NULL;--> statement-breakpoint
INSERT INTO "usage_counters" (
	"account_id",
	"period",
	"metric",
	"used",
	"limit"
)
SELECT
	"account_id",
	to_char(timezone('UTC', now()), 'YYYY-MM'),
	"metric",
	CASE "metric"
		WHEN 'audits' THEN 45
		WHEN 'serp_checks' THEN 10000
		WHEN 'backlink_rows' THEN 100000
		WHEN 'ai_summaries' THEN 480
		WHEN 'competitor_lookups' THEN 500
		WHEN 'ai_mentions_checks' THEN 30
		WHEN 'keyword_lookups' THEN 100
		WHEN 'local_listing_checks' THEN 60
		WHEN 'content_analyses' THEN 30
		WHEN 'audience_research_runs' THEN 30
		WHEN 'content_inventory_page_blocks' THEN 75
		WHEN 'competitor_content_runs' THEN 100
		WHEN 'content_monitor_checks' THEN 25
		WHEN 'trend_explorations' THEN 80
		WHEN 'traffic_snapshots' THEN 80
		WHEN 'link_intel_checks' THEN 80
		WHEN 'review_syncs' THEN 50
		WHEN 'brand_mention_scans' THEN 20
		WHEN 'keyword_cluster_runs' THEN 20
		WHEN 'cannibalization_reports' THEN 100
		WHEN 'alt_engine_checks' THEN 240
		WHEN 'toxicity_reviews' THEN 12
		WHEN 'internal_link_runs' THEN 25
		WHEN 'content_briefs' THEN 8
		WHEN 'geogrid_scans' THEN 6
		WHEN 'schema_generations' THEN 60
		WHEN 'ai_chat_messages' THEN 400
		WHEN 'ai_visibility_suggestion_runs' THEN 20
		WHEN 'app_keyword_checks' THEN 50
		WHEN 'app_listing_audits' THEN 4
		WHEN 'app_chart_checks' THEN 20
		WHEN 'app_keyword_lookups' THEN 2
		WHEN 'app_competitor_lookups' THEN 0
		WHEN 'app_review_runs' THEN 0
		ELSE -1
	END,
	CASE "metric"
		WHEN 'audits' THEN 45
		WHEN 'serp_checks' THEN 10000
		WHEN 'backlink_rows' THEN 100000
		WHEN 'ai_summaries' THEN 480
		WHEN 'competitor_lookups' THEN 500
		WHEN 'ai_mentions_checks' THEN 30
		WHEN 'keyword_lookups' THEN 100
		WHEN 'local_listing_checks' THEN 60
		WHEN 'content_analyses' THEN 30
		WHEN 'audience_research_runs' THEN 30
		WHEN 'content_inventory_page_blocks' THEN 75
		WHEN 'competitor_content_runs' THEN 100
		WHEN 'content_monitor_checks' THEN 25
		WHEN 'trend_explorations' THEN 80
		WHEN 'traffic_snapshots' THEN 80
		WHEN 'link_intel_checks' THEN 80
		WHEN 'review_syncs' THEN 50
		WHEN 'brand_mention_scans' THEN 20
		WHEN 'keyword_cluster_runs' THEN 20
		WHEN 'cannibalization_reports' THEN 100
		WHEN 'alt_engine_checks' THEN 240
		WHEN 'toxicity_reviews' THEN 12
		WHEN 'internal_link_runs' THEN 25
		WHEN 'content_briefs' THEN 8
		WHEN 'geogrid_scans' THEN 6
		WHEN 'schema_generations' THEN 60
		WHEN 'ai_chat_messages' THEN 400
		WHEN 'ai_visibility_suggestion_runs' THEN 20
		WHEN 'app_keyword_checks' THEN 50
		WHEN 'app_listing_audits' THEN 4
		WHEN 'app_chart_checks' THEN 20
		WHEN 'app_keyword_lookups' THEN 2
		WHEN 'app_competitor_lookups' THEN 0
		WHEN 'app_review_runs' THEN 0
		ELSE -1
	END
FROM "enterprise_legacy_null_caps"
WHERE "status" = 'active'
	AND "metric" IN (
		'audits',
		'serp_checks',
		'backlink_rows',
		'ai_summaries',
		'competitor_lookups',
		'ai_mentions_checks',
		'keyword_lookups',
		'local_listing_checks',
		'content_analyses',
		'audience_research_runs',
		'content_inventory_page_blocks',
		'competitor_content_runs',
		'content_monitor_checks',
		'trend_explorations',
		'traffic_snapshots',
		'link_intel_checks',
		'review_syncs',
		'brand_mention_scans',
		'keyword_cluster_runs',
		'cannibalization_reports',
		'alt_engine_checks',
		'toxicity_reviews',
		'internal_link_runs',
		'content_briefs',
		'geogrid_scans',
		'schema_generations',
		'ai_chat_messages',
		'ai_visibility_suggestion_runs',
		'app_keyword_checks',
		'app_listing_audits',
		'app_chart_checks',
		'app_keyword_lookups',
		'app_competitor_lookups',
		'app_review_runs'
	)
ON CONFLICT ("account_id", "period", "metric") DO UPDATE
SET
	"used" = GREATEST("usage_counters"."used", EXCLUDED."used"),
	"limit" = EXCLUDED."limit",
	"updated_at" = now();--> statement-breakpoint
DELETE FROM "enterprise_agreement_caps" AS "caps"
USING "enterprise_legacy_null_caps" AS "legacy"
WHERE "caps"."agreement_id" = "legacy"."agreement_id"
	AND "caps"."metric" = "legacy"."metric"
	AND "caps"."cap" IS NULL;--> statement-breakpoint
ALTER TABLE "enterprise_agreement_caps" ALTER COLUMN "cap" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_agreements" ALTER COLUMN "seats" SET DEFAULT 25;--> statement-breakpoint
ALTER TABLE "enterprise_agreements" ALTER COLUMN "seats" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_agreement_caps" ADD CONSTRAINT "enterprise_agreement_caps_cap_check" CHECK ("enterprise_agreement_caps"."cap" between 0 and case "enterprise_agreement_caps"."metric" when 'sites' then 1000 when 'keywords_tracked' then 20000 when 'audits' then 450 when 'audit_pages' then 50000 when 'serp_checks' then 100000 when 'backlink_rows' then 1000000 when 'ai_summaries' then 4800 when 'competitor_lookups' then 5000 when 'ai_mentions_checks' then 300 when 'keyword_lookups' then 1000 when 'local_listing_checks' then 600 when 'content_analyses' then 300 when 'audience_research_runs' then 300 when 'content_inventory_page_blocks' then 750 when 'competitor_content_runs' then 1000 when 'content_monitor_checks' then 250 when 'trend_explorations' then 800 when 'traffic_snapshots' then 800 when 'link_intel_checks' then 800 when 'review_syncs' then 500 when 'brand_mention_scans' then 200 when 'keyword_cluster_runs' then 200 when 'cannibalization_reports' then 1000 when 'alt_engine_checks' then 2400 when 'toxicity_reviews' then 120 when 'internal_link_runs' then 250 when 'content_briefs' then 80 when 'geogrid_scans' then 60 when 'schema_generations' then 600 when 'ai_chat_messages' then 4000 when 'ai_visibility_suggestion_runs' then 200 when 'app_keyword_checks' then 500 when 'app_listing_audits' then 40 when 'app_chart_checks' then 200 when 'app_keyword_lookups' then 20 when 'app_competitor_lookups' then 100 when 'app_review_runs' then 100 when 'alertRules' then 500 when 'altEngineKeywordSlots' then 300 when 'scheduledReports' then 200 when 'portalClients' then 250 when 'appProfiles' then 50 when 'appKeywordSlots' then 500 else -1 end);--> statement-breakpoint
ALTER TABLE "enterprise_agreements" ADD CONSTRAINT "enterprise_agreements_seats_check" CHECK ("enterprise_agreements"."seats" between 1 and 250);
