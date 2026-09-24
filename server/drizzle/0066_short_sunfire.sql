CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"recipient_ref" text,
	"idempotency_key" text NOT NULL,
	"transition_kind" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"suppressed_reason" text,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_deliveries_status_check" CHECK ("alert_deliveries"."status" in ('pending', 'sent', 'failed', 'suppressed')),
	CONSTRAINT "alert_deliveries_channel_check" CHECK ("alert_deliveries"."channel" in ('email', 'slack', 'webhook')),
	CONSTRAINT "alert_deliveries_reason_when_suppressed" CHECK (("alert_deliveries"."status" = 'suppressed' AND "alert_deliveries"."suppressed_reason" IS NOT NULL) OR ("alert_deliveries"."status" <> 'suppressed' AND "alert_deliveries"."suppressed_reason" IS NULL)),
	CONSTRAINT "alert_deliveries_recipient_when_email" CHECK (("alert_deliveries"."channel" = 'email' AND "alert_deliveries"."recipient_ref" IS NOT NULL) OR ("alert_deliveries"."channel" <> 'email' AND "alert_deliveries"."recipient_ref" IS NULL)),
	CONSTRAINT "alert_deliveries_attempt_bound" CHECK ("alert_deliveries"."attempt" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"site_id" text NOT NULL,
	"type" text NOT NULL,
	"threshold" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"email_recipient_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slack_webhook" jsonb,
	"slack_host_masked" text,
	"webhook_url" text,
	"webhook_secret" jsonb,
	"webhook_secret_last4" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_type_check" CHECK ("alert_rules"."type" in ('rank_drop', 'new_backlink', 'lost_backlink')),
	CONSTRAINT "alert_rules_threshold_when_rank_drop" CHECK (("alert_rules"."type" = 'rank_drop' AND "alert_rules"."threshold" IS NOT NULL AND "alert_rules"."threshold" between 1 and 100) OR ("alert_rules"."type" <> 'rank_drop' AND "alert_rules"."threshold" IS NULL)),
	CONSTRAINT "alert_rules_slack_pair" CHECK (("alert_rules"."slack_webhook" IS NULL) = ("alert_rules"."slack_host_masked" IS NULL)),
	CONSTRAINT "alert_rules_webhook_pair" CHECK (("alert_rules"."webhook_url" IS NULL) = ("alert_rules"."webhook_secret" IS NULL) AND ("alert_rules"."webhook_url" IS NULL) = ("alert_rules"."webhook_secret_last4" IS NULL)),
	CONSTRAINT "alert_rules_webhook_url_length" CHECK ("alert_rules"."webhook_url" IS NULL OR char_length("alert_rules"."webhook_url") between 1 and 2048),
	CONSTRAINT "alert_rules_recipient_bound" CHECK (jsonb_array_length("alert_rules"."email_recipient_ids") between 0 and 20),
	CONSTRAINT "alert_rules_at_least_one_channel" CHECK (jsonb_array_length("alert_rules"."email_recipient_ids") > 0 OR "alert_rules"."slack_webhook" IS NOT NULL OR "alert_rules"."webhook_url" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_deliveries_idempotency_uq" ON "alert_deliveries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "alert_deliveries_rule_created_idx" ON "alert_deliveries" USING btree ("account_id","rule_id","created_at","id");--> statement-breakpoint
CREATE INDEX "alert_rules_account_site_idx" ON "alert_rules" USING btree ("account_id","site_id","type");--> statement-breakpoint
CREATE INDEX "alert_rules_account_enabled_idx" ON "alert_rules" USING btree ("account_id","enabled","type");