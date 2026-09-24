CREATE TABLE "keyword_cluster_decision_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"run_id" text NOT NULL,
	"cluster_id" text NOT NULL,
	"kind" text NOT NULL,
	"site_id" uuid,
	"recommendation_id" text,
	"idempotency_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kcde_kind_check" CHECK ("keyword_cluster_decision_events"."kind" in ('accepted', 'dismissed')),
	CONSTRAINT "kcde_accepted_requires_site" CHECK (("keyword_cluster_decision_events"."kind" = 'accepted' and "keyword_cluster_decision_events"."site_id" is not null) or ("keyword_cluster_decision_events"."kind" = 'dismissed' and "keyword_cluster_decision_events"."site_id" is null)),
	CONSTRAINT "kcde_note_length_check" CHECK ("keyword_cluster_decision_events"."note" is null or char_length("keyword_cluster_decision_events"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "keyword_research_history" DROP CONSTRAINT "krh_kind_check";--> statement-breakpoint
CREATE UNIQUE INDEX "kcde_account_run_cluster_idem_uq" ON "keyword_cluster_decision_events" USING btree ("account_id","run_id","cluster_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "kcde_account_run_created_idx" ON "keyword_cluster_decision_events" USING btree ("account_id","run_id","created_at","id");--> statement-breakpoint
ALTER TABLE "keyword_research_history" ADD CONSTRAINT "krh_kind_check" CHECK ("keyword_research_history"."kind" in ('metrics', 'related', 'intent', 'ideas', 'gap', 'overview', 'trends', 'clusters'));