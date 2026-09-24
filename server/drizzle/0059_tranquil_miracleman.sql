CREATE TABLE "brand_radar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"scan_id" text NOT NULL,
	"stage" text NOT NULL,
	"event" text NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_radar_events_cost_nonneg_check" CHECK ("brand_radar_events"."cost_micros" >= 0)
);
--> statement-breakpoint
CREATE INDEX "brand_radar_events_scan_occurred_idx" ON "brand_radar_events" USING btree ("scan_id","occurred_at");--> statement-breakpoint
CREATE INDEX "brand_radar_events_account_occurred_idx" ON "brand_radar_events" USING btree ("account_id","occurred_at" DESC NULLS LAST);