DROP TABLE "serp_cache";
--> statement-breakpoint
DROP TABLE "keyword_metrics";
--> statement-breakpoint
ALTER TABLE "backlink_snapshots" DROP COLUMN "cached_page";
--> statement-breakpoint
ALTER TABLE "backlink_snapshots" DROP COLUMN "cached_page_expires_at";
