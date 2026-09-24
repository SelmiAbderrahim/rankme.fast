-- rankme-enterprise-orgs 01. Every account-owned table carries the account
-- tombstone guard so a producer that cleared its ownership check just before
-- a deletion claim cannot write a row into an erased account. Registered in
-- ACCOUNT_ERASED_POSTGRES_TABLE_NAMES; the ratchet test in
-- account-postgres-cascade.test.ts asserts the trigger exists.
--
-- `enterprise_agreement_caps` deliberately has NO guard: it carries no
-- account column, so the generic function has nothing to check. Its rows are
-- erased through their parent agreement by the cascade.
CREATE TRIGGER enterprise_agreements_account_deletion_guard
BEFORE INSERT OR UPDATE ON enterprise_agreements
FOR EACH ROW
EXECUTE FUNCTION reject_deleted_account_write('account_id');
