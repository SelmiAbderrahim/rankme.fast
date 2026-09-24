CREATE TABLE "landscape_opportunity_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"report_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"action_id" text NOT NULL,
	"accepted_by_user_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "landscape_acceptance_opportunity_uq" ON "landscape_opportunity_acceptances" USING btree ("account_id","report_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "landscape_acceptance_idempotency_uq" ON "landscape_opportunity_acceptances" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "landscape_acceptance_site_idx" ON "landscape_opportunity_acceptances" USING btree ("account_id","site_id","accepted_at");--> statement-breakpoint
CREATE INDEX "landscape_acceptance_action_idx" ON "landscape_opportunity_acceptances" USING btree ("account_id","action_id");--> statement-breakpoint
CREATE TRIGGER landscape_opportunity_acceptances_account_deletion_guard BEFORE INSERT OR UPDATE ON landscape_opportunity_acceptances FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER landscape_opportunity_acceptances_site_deletion_guard BEFORE INSERT OR UPDATE ON landscape_opportunity_acceptances FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
