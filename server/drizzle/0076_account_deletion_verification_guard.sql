-- Better Auth stores password-reset and delete-account principals in
-- verification.value. 0075's generic account tombstone trigger intentionally
-- accepts column names, so this forward-only migration closes the identity
-- token insert/update race without rewriting the already-applied migration.
CREATE TRIGGER verification_account_deletion_guard
BEFORE INSERT OR UPDATE ON verification
FOR EACH ROW
EXECUTE FUNCTION reject_deleted_account_write('value');
