-- TOCTOU fix (12): (siteId, competitorDomain, snapshotDay) unique index on
-- `competitors` closes the concurrent same-day snapshot race. Add the column
-- nullable → backfill from fetched_at → SET NOT NULL → create the unique index.
ALTER TABLE "competitors" ADD COLUMN "snapshot_day" date;--> statement-breakpoint
UPDATE "competitors" SET "snapshot_day" = ("fetched_at" AT TIME ZONE 'UTC')::date WHERE "snapshot_day" IS NULL;--> statement-breakpoint
ALTER TABLE "competitors" ALTER COLUMN "snapshot_day" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_site_domain_day_uq" ON "competitors" USING btree ("site_id","competitor_domain","snapshot_day");
