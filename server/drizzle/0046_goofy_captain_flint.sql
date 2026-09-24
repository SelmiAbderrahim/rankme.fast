CREATE TABLE "gsc_search_appearance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"property" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"window_days" integer DEFAULT 28 NOT NULL,
	"raw_appearance" text NOT NULL,
	"classification_slug" text NOT NULL,
	"classified_generative" boolean NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" real NOT NULL,
	"position" real NOT NULL,
	"observation_meta" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_search_appearance_site_property_date_raw_idx" ON "gsc_search_appearance" USING btree ("site_id","property","snapshot_date","window_days","raw_appearance");--> statement-breakpoint
CREATE INDEX "gsc_search_appearance_site_date_idx" ON "gsc_search_appearance" USING btree ("site_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "gsc_search_appearance_site_generative_idx" ON "gsc_search_appearance" USING btree ("site_id","classified_generative");