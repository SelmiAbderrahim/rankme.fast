ALTER TABLE "vendor_cache" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "vendor_cache" ADD COLUMN "site_id" text;--> statement-breakpoint
ALTER TABLE "vendor_responses" ADD COLUMN "site_id" text;--> statement-breakpoint
CREATE INDEX "vendor_cache_account_site_idx" ON "vendor_cache" USING btree ("account_id","site_id");--> statement-breakpoint
CREATE INDEX "vendor_responses_site_fetched_idx" ON "vendor_responses" USING btree ("site_id","fetched_at");--> statement-breakpoint
CREATE TRIGGER vendor_cache_account_deletion_guard BEFORE INSERT OR UPDATE ON vendor_cache FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');--> statement-breakpoint
CREATE TRIGGER vendor_cache_site_deletion_guard BEFORE INSERT OR UPDATE ON vendor_cache FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER vendor_responses_site_deletion_guard BEFORE INSERT OR UPDATE ON vendor_responses FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
