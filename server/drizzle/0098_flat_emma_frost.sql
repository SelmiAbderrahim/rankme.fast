CREATE TABLE "landscape_page_match_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"report_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"competitor_profile_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"owned_url" text,
	"competitor_url" text,
	"reviewed_by_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landscape_page_match_review_decision_check" CHECK ("landscape_page_match_reviews"."decision" in ('approved', 'rejected')),
	CONSTRAINT "landscape_page_match_review_urls_check" CHECK (("landscape_page_match_reviews"."decision" = 'approved' and "landscape_page_match_reviews"."owned_url" is not null and "landscape_page_match_reviews"."competitor_url" is not null) or ("landscape_page_match_reviews"."decision" = 'rejected' and "landscape_page_match_reviews"."owned_url" is null and "landscape_page_match_reviews"."competitor_url" is null)),
	CONSTRAINT "landscape_page_match_review_version_check" CHECK ("landscape_page_match_reviews"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "landscape_page_match_review_suggestion_uq" ON "landscape_page_match_reviews" USING btree ("account_id","report_id","suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "landscape_page_match_review_idempotency_uq" ON "landscape_page_match_reviews" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "landscape_page_match_review_site_idx" ON "landscape_page_match_reviews" USING btree ("account_id","site_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "landscape_page_match_review_profile_idx" ON "landscape_page_match_reviews" USING btree ("account_id","competitor_profile_id");--> statement-breakpoint
CREATE TRIGGER landscape_page_match_reviews_account_deletion_guard BEFORE INSERT OR UPDATE ON landscape_page_match_reviews FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER landscape_page_match_reviews_site_deletion_guard BEFORE INSERT OR UPDATE ON landscape_page_match_reviews FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
