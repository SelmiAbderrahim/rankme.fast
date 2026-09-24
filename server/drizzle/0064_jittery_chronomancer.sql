DROP INDEX "keywords_site_phrase_loc_lang_device_idx";--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "engine" text DEFAULT 'google' NOT NULL;--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "engine_target" text;--> statement-breakpoint
ALTER TABLE "rankings" ADD COLUMN "engine" text DEFAULT 'google' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "keywords_site_engine_phrase_loc_lang_device_idx" ON "keywords" USING btree ("site_id","engine","phrase","location_code","language_code","device");--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_engine_check" CHECK ("keywords"."engine" in ('google', 'bing', 'youtube', 'amazon'));--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_engine_target_check" CHECK (("keywords"."engine" in ('youtube', 'amazon')) = ("keywords"."engine_target" is not null));--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_engine_check" CHECK ("rankings"."engine" in ('google', 'bing', 'youtube', 'amazon'));