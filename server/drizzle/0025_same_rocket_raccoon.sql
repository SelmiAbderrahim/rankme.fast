DROP INDEX "rankings_keyword_checkedAt_desc_idx";--> statement-breakpoint
CREATE INDEX "keywords_account_active_idx" ON "keywords" USING btree ("account_id","active");