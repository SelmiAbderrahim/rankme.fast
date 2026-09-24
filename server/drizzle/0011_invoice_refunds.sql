ALTER TABLE "invoices" ADD COLUMN "provider_refund_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "refunded_at" timestamp with time zone;
