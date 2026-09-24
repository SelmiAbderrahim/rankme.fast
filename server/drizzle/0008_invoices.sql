CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"polar_invoice_id" text NOT NULL,
	"polar_order_id" text,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"invoice_url" text,
	"invoice_pdf" text,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_polar_invoice_id_uidx" ON "invoices" USING btree ("polar_invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_account_issued_at_idx" ON "invoices" USING btree ("account_id","issued_at");