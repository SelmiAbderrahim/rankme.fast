CREATE TRIGGER credit_pack_liabilities_account_deletion_guard
BEFORE INSERT OR UPDATE ON credit_pack_liabilities
FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_cost_telemetry_events_account_deletion_guard
BEFORE INSERT OR UPDATE ON dynamic_plan_cost_telemetry_events
FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
--> statement-breakpoint
CREATE TRIGGER dynamic_plan_payment_evidence_account_deletion_guard
BEFORE INSERT OR UPDATE ON dynamic_plan_payment_evidence
FOR EACH ROW EXECUTE FUNCTION reject_deleted_account_write('account_id');
