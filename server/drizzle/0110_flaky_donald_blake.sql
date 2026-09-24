CREATE TABLE "team_member_site_grants" (
	"team_member_id" uuid NOT NULL,
	"site_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_provisioned_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_provisioned_accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "team_provisioned_accounts_status_check" CHECK ("team_provisioned_accounts"."status" in ('pending', 'claimed', 'deleting'))
);
--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "site_access_mode" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "reject_token_hash" text;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team_member_site_grants" ADD CONSTRAINT "team_member_site_grants_member_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_provisioned_accounts" ADD CONSTRAINT "team_provisioned_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_site_grants_member_site_uidx" ON "team_member_site_grants" USING btree ("team_member_id","site_id");--> statement-breakpoint
CREATE INDEX "team_member_site_grants_site_id_idx" ON "team_member_site_grants" USING btree ("site_id");--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_reject_token_hash_unique" UNIQUE("reject_token_hash");--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_site_access_mode_check" CHECK ("team_members"."site_access_mode" in ('all', 'selected'));--> statement-breakpoint
CREATE TRIGGER team_member_site_grants_site_deletion_guard BEFORE INSERT OR UPDATE ON team_member_site_grants FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();--> statement-breakpoint
CREATE TRIGGER team_provisioned_accounts_account_deletion_guard BEFORE INSERT OR UPDATE ON team_provisioned_accounts FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('user_id');
