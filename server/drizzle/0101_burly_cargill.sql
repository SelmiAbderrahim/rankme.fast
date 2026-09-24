CREATE TABLE "credit_pack_liabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"pack_slug" text NOT NULL,
	"metric" text NOT NULL,
	"sold_units" bigint NOT NULL,
	"reserved_cost_micros" bigint NOT NULL,
	"cost_version_id" text NOT NULL,
	"provider_bindings_checksum" text NOT NULL,
	"status" text DEFAULT 'funded' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_pack_liabilities_units_check" CHECK ("credit_pack_liabilities"."sold_units" > 0),
	CONSTRAINT "credit_pack_liabilities_cost_check" CHECK ("credit_pack_liabilities"."reserved_cost_micros" >= 0),
	CONSTRAINT "credit_pack_liabilities_status_check" CHECK ("credit_pack_liabilities"."status" in ('funded', 'refunded', 'expired', 'exhausted', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "plan_source" text DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "custom_revision_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_pack_liabilities_provider_order_uidx" ON "credit_pack_liabilities" USING btree ("provider_order_id");--> statement-breakpoint
CREATE INDEX "credit_pack_liabilities_account_metric_idx" ON "credit_pack_liabilities" USING btree ("account_id","metric");