CREATE TABLE "rank_drop_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"keyword_id" uuid NOT NULL,
	"ranking_id" uuid NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"previous_position" integer,
	"candidate_position" integer,
	"confirmation_position" integer,
	"candidate_observed_at" timestamp with time zone NOT NULL,
	"confirmation_observed_at" timestamp with time zone,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"device" text NOT NULL,
	"attempt_reserved_at" timestamp with time zone NOT NULL,
	"provider_called_at" timestamp with time zone,
	"settled_at" timestamp with time zone NOT NULL,
	"alert_claimed_at" timestamp with time zone,
	"alert_delivered_at" timestamp with time zone,
	"alert_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rank_drop_confirmations_state_check" CHECK ("rank_drop_confirmations"."state" in ('confirmed', 'volatile', 'unconfirmed')),
	CONSTRAINT "rank_drop_confirmations_reason_when_unconfirmed" CHECK (("rank_drop_confirmations"."state" = 'unconfirmed' AND "rank_drop_confirmations"."reason" IS NOT NULL) OR ("rank_drop_confirmations"."state" <> 'unconfirmed' AND "rank_drop_confirmations"."reason" IS NULL)),
	CONSTRAINT "rank_drop_confirmations_obs_when_settled" CHECK (("rank_drop_confirmations"."state" = 'unconfirmed') OR ("rank_drop_confirmations"."confirmation_observed_at" IS NOT NULL)),
	CONSTRAINT "rank_drop_confirmations_positions_positive" CHECK (("rank_drop_confirmations"."candidate_position" IS NULL OR "rank_drop_confirmations"."candidate_position" >= 1) AND ("rank_drop_confirmations"."confirmation_position" IS NULL OR "rank_drop_confirmations"."confirmation_position" >= 1) AND ("rank_drop_confirmations"."previous_position" IS NULL OR "rank_drop_confirmations"."previous_position" >= 1)),
	CONSTRAINT "rank_drop_confirmations_alert_only_confirmed" CHECK ("rank_drop_confirmations"."alert_claimed_at" IS NULL OR "rank_drop_confirmations"."state" = 'confirmed')
);
--> statement-breakpoint
ALTER TABLE "rank_drop_confirmations" ADD CONSTRAINT "rank_drop_confirmations_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_drop_confirmations" ADD CONSTRAINT "rank_drop_confirmations_ranking_id_rankings_id_fk" FOREIGN KEY ("ranking_id") REFERENCES "public"."rankings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_drop_confirmations_ranking_uq" ON "rank_drop_confirmations" USING btree ("ranking_id");--> statement-breakpoint
CREATE INDEX "rank_drop_confirmations_lookup_idx" ON "rank_drop_confirmations" USING btree ("account_id","site_id","keyword_id","candidate_observed_at");