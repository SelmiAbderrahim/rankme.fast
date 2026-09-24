ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_tier_check";--> statement-breakpoint
UPDATE "subscriptions" SET "tier" = 'none' WHERE "tier" = 'free';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "tier" SET DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tier_check" CHECK ("subscriptions"."tier" in ('none', 'free', 'starter', 'pro', 'agency', 'enterprise'));
