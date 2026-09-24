CREATE TABLE "content_inventory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_id" text NOT NULL,
	"reservation_key" text NOT NULL,
	"kind" text NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"ai_cost_micros" bigint DEFAULT 0 NOT NULL,
	"error_category" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_inventory_events_kind_check" CHECK ("content_inventory_events"."kind" in ('reserved', 'refunded', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "content_inventory_events_units_nonneg_check" CHECK ("content_inventory_events"."units" >= 0),
	CONSTRAINT "content_inventory_events_cost_nonneg_check" CHECK ("content_inventory_events"."cost_micros" >= 0 and "content_inventory_events"."ai_cost_micros" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_inventory_events_reservation_kind_uidx" ON "content_inventory_events" USING btree ("reservation_key","kind");--> statement-breakpoint
CREATE INDEX "content_inventory_events_account_recorded_idx" ON "content_inventory_events" USING btree ("account_id","recorded_at");--> statement-breakpoint
CREATE INDEX "content_inventory_events_site_recorded_idx" ON "content_inventory_events" USING btree ("site_id","recorded_at");--> statement-breakpoint
CREATE INDEX "content_inventory_events_run_idx" ON "content_inventory_events" USING btree ("run_id");