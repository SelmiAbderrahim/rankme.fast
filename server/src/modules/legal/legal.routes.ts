import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/require-auth.js';
import { requireCsrf } from '../../shared/middleware/csrf.js';
import { rejectForeignWorkspace } from '../../shared/middleware/require-team-role.js';
import { cancelMyAccountDeletion, accountDeletionStatus, deleteMyAccount, exportMyData, } from './legal.controller.js';
export const legalRouter: Router = Router();
// Data rights are owner-only and deliberately sit OUTSIDE the product
// `workspaceContext` chain (they must stay reachable for unverified
// accounts). `rejectForeignWorkspace` therefore does the whole job with no
// database read: no membership can ever grant another account's export or
// deletion, so naming one in `x-workspace-id` is simply not found.
//
// Both mutating data-rights routes are cookie-authenticated, so both carry the
// double-submit CSRF guard — a cross-site page must not be able to force an
// export (or the `data.export` audit-log write) on a victim's ambient session.
legalRouter.post('/export', requireAuth, rejectForeignWorkspace, requireCsrf, exportMyData);
legalRouter.post('/delete-account', requireAuth, rejectForeignWorkspace, requireCsrf, deleteMyAccount);
legalRouter.post('/cancel-account-deletion', requireAuth, rejectForeignWorkspace, requireCsrf, cancelMyAccountDeletion);
legalRouter.get('/account-deletion', requireAuth, rejectForeignWorkspace, accountDeletionStatus);
