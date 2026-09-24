CREATE TRIGGER gsc_sync_runs_account_deletion_guard
BEFORE INSERT OR UPDATE ON gsc_sync_runs
FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER gsc_sync_runs_site_deletion_guard
BEFORE INSERT OR UPDATE ON gsc_sync_runs
FOR EACH ROW EXECUTE FUNCTION reject_deleted_site_write();
