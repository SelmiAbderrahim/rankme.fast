CREATE TABLE "audience_research_signal_decision_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"run_id" text NOT NULL,
	"signal_id" text NOT NULL,
	"decision" text NOT NULL,
	"destination" text,
	"dismiss_reason" text,
	"downstream_id" text,
	"deep_link_path" text,
	"idempotency_key" text NOT NULL,
	"decided_by_user_id" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arsde_decision_check" CHECK ("audience_research_signal_decision_events"."decision" in ('accepted','dismissed')),
	CONSTRAINT "arsde_accepted_shape_check" CHECK (("audience_research_signal_decision_events"."decision" = 'accepted' and "audience_research_signal_decision_events"."destination" is not null and "audience_research_signal_decision_events"."downstream_id" is not null and "audience_research_signal_decision_events"."dismiss_reason" is null) or ("audience_research_signal_decision_events"."decision" = 'dismissed' and "audience_research_signal_decision_events"."destination" is null and "audience_research_signal_decision_events"."downstream_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "arsde_account_idem_uq" ON "audience_research_signal_decision_events" USING btree ("account_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "arsde_signal_terminal_uq" ON "audience_research_signal_decision_events" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "arsde_owner_ordered_idx" ON "audience_research_signal_decision_events" USING btree ("account_id","site_id","run_id","decided_at");