CREATE TABLE "rate_limit_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route" text NOT NULL,
	"hit_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"account_id" text
);
--> statement-breakpoint
CREATE INDEX "rate_limit_hits_route_hit_at_idx" ON "rate_limit_hits" USING btree ("route","hit_at");
