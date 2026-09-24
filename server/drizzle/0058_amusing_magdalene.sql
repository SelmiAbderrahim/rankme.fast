CREATE TABLE "traffic_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"run_id" text NOT NULL,
	"site_id" text,
	"target_domain" text NOT NULL,
	"payload" jsonb NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "traffic_snapshots_domain_length_check" CHECK (char_length("traffic_snapshots"."target_domain") between 1 and 253),
	CONSTRAINT "traffic_snapshots_payload_object_check" CHECK (jsonb_typeof("traffic_snapshots"."payload") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "traffic_snapshots_account_run_uq" ON "traffic_snapshots" USING btree ("account_id","run_id");--> statement-breakpoint
CREATE INDEX "traffic_snapshots_account_domain_captured_idx" ON "traffic_snapshots" USING btree ("account_id","target_domain","captured_at");