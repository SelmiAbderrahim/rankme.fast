CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"metric" text NOT NULL,
	"delta" bigint NOT NULL,
	"polar_order_id" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_reason_check" CHECK ("credit_ledger"."reason" IN ('purchase','refund','consumption','grant','expire'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_polar_order_id_uidx" ON "credit_ledger" USING btree ("polar_order_id");
--> statement-breakpoint
CREATE INDEX "credit_ledger_account_metric_idx" ON "credit_ledger" USING btree ("account_id","metric");
