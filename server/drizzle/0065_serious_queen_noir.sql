CREATE TABLE "backlink_row_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" text NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"spam_score" integer NOT NULL,
	"rubric_band" text NOT NULL,
	"rubric_version" text NOT NULL,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"dofollow" boolean NOT NULL,
	"is_broken" boolean NOT NULL,
	"rationale" text,
	"rationale_status" text DEFAULT 'not_requested' NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "backlink_row_snapshots_spam_score_check" CHECK ("backlink_row_snapshots"."spam_score" between 0 and 100),
	CONSTRAINT "backlink_row_snapshots_url_length_check" CHECK (char_length("backlink_row_snapshots"."url") between 1 and 2048),
	CONSTRAINT "backlink_row_snapshots_domain_length_check" CHECK (char_length("backlink_row_snapshots"."domain") between 1 and 253),
	CONSTRAINT "backlink_row_snapshots_rationale_length_check" CHECK ("backlink_row_snapshots"."rationale" is null or char_length("backlink_row_snapshots"."rationale") <= 300),
	CONSTRAINT "backlink_row_snapshots_rubric_band_check" CHECK ("backlink_row_snapshots"."rubric_band" in ('clean', 'watch', 'toxic')),
	CONSTRAINT "backlink_row_snapshots_rationale_status_check" CHECK ("backlink_row_snapshots"."rationale_status" in ('not_requested', 'annotated', 'abstained', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backlink_row_snapshots_review_url_idx" ON "backlink_row_snapshots" USING btree ("review_id","url");--> statement-breakpoint
CREATE INDEX "backlink_row_snapshots_site_captured_idx" ON "backlink_row_snapshots" USING btree ("account_id","site_id","captured_at","id");--> statement-breakpoint
CREATE INDEX "backlink_row_snapshots_review_band_idx" ON "backlink_row_snapshots" USING btree ("account_id","review_id","rubric_band","id");
