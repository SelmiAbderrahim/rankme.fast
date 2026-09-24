CREATE TABLE "usage_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"activity_key" text NOT NULL,
	"event_key" text NOT NULL,
	"feature" text NOT NULL,
	"operation" text NOT NULL,
	"metric" text NOT NULL,
	"event_kind" text NOT NULL,
	"units" bigint NOT NULL,
	"cached_status" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_activity_events_units_positive_check" CHECK ("usage_activity_events"."units" > 0),
	CONSTRAINT "usage_activity_events_feature_check" CHECK ("usage_activity_events"."feature" in ('audits', 'ranks', 'keyword_research', 'backlinks', 'competitors', 'local_seo', 'ai_visibility', 'content_intelligence', 'sites')),
	CONSTRAINT "usage_activity_events_event_kind_check" CHECK ("usage_activity_events"."event_kind" in ('reserved', 'consumed', 'refunded')),
	CONSTRAINT "usage_activity_events_cached_status_check" CHECK ("usage_activity_events"."cached_status" in ('cached', 'fresh_required', 'mixed', 'unknown')),
	CONSTRAINT "usage_activity_events_metric_check" CHECK ("usage_activity_events"."metric" in ('sites', 'keywords_tracked', 'audits', 'audit_pages', 'serp_checks', 'backlink_rows', 'ai_summaries', 'competitor_lookups', 'ai_mentions_checks', 'keyword_lookups', 'local_listing_checks', 'content_analyses'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_activity_events_event_key_uidx" ON "usage_activity_events" USING btree ("account_id","event_key");--> statement-breakpoint
CREATE INDEX "usage_activity_events_account_time_idx" ON "usage_activity_events" USING btree ("account_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "usage_activity_events_activity_key_idx" ON "usage_activity_events" USING btree ("account_id","activity_key");