ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_tier_check";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "tier" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tier_check" CHECK ("subscriptions"."tier" in ('free', 'starter', 'pro', 'agency'));
