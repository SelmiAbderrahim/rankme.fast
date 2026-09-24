# Bootstrap a SuperAdmin

Set `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` in the root `.env`, then start
or restart the `api` service. The password must contain at least 12 characters.
These variables are passed only to the API container; the worker and web
containers never receive the bootstrap password.

On every API start, RankMeFast launches the bootstrap seeder asynchronously
after its databases are ready. Startup does not wait for the seeder and a seed
failure cannot crash the API. If the configured email does not exist, Better
Auth creates the account and RankMeFast promotes it to `SuperAdmin`. If that
email already exists, the seeder skips it without changing its role or password.
This makes the seeder safe to run repeatedly, but it is not a credential-
rotation mechanism.

After the first sign-in, the account is sent to `/superadmin`. Administrative
API access remains blocked until the owner enrolls TOTP under
`/settings/security`; two-factor authentication is mandatory for both the admin
and SuperAdmin control surfaces.

Rotate the bootstrap password after the first successful login using the normal
account-security flow. Keep the root `.env` out of source control, and remove the
two bootstrap variables when automatic creation is no longer required. Removing
them does not delete or demote the existing account.
