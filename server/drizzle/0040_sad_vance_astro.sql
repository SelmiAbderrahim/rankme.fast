CREATE TABLE "action_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"action_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id_ref" text NOT NULL,
	"prior_state" text,
	"new_state" text NOT NULL,
	"event_kind" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"note" text,
	"ordinal" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_events_new_state_check" CHECK ("action_events"."new_state" in ('open','planned','dismissed','completed')),
	CONSTRAINT "action_events_prior_state_check" CHECK ("action_events"."prior_state" IS NULL OR "action_events"."prior_state" in ('open','planned','dismissed','completed')),
	CONSTRAINT "action_events_kind_check" CHECK ("action_events"."event_kind" in ('plan','dismiss','complete','reopen','note')),
	CONSTRAINT "action_events_ordinal_positive" CHECK ("action_events"."ordinal" >= 1),
	CONSTRAINT "action_events_note_len" CHECK ("action_events"."note" IS NULL OR char_length("action_events"."note") <= 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "action_events_ordinal_uq" ON "action_events" USING btree ("account_id","action_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "action_events_idempotency_uq" ON "action_events" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "action_events_action_lookup_idx" ON "action_events" USING btree ("account_id","action_id","ordinal");--> statement-breakpoint
CREATE INDEX "action_events_site_history_idx" ON "action_events" USING btree ("account_id","site_id","created_at");--> statement-breakpoint
CREATE INDEX "action_events_site_action_idx" ON "action_events" USING btree ("account_id","site_id","action_id");