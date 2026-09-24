import { Router } from 'express';
import { requireAuth } from '../../shared/middleware/require-auth.js';
import { requireWorkspaceOwner } from '../../shared/middleware/require-team-role.js';
import { getBrandingHandler, getLanguagePreferenceHandler, getNotificationPreferences, patchLanguagePreferenceHandler, patchNotificationPreferences, putBrandingHandler, viewProfile, } from './users.controller.js';
export const usersRouter: Router = Router();
usersRouter.get('/preferences/language', requireAuth, getLanguagePreferenceHandler);
usersRouter.patch('/preferences/language', requireAuth, patchLanguagePreferenceHandler);
// Notification preferences. Mounted BEFORE `/:userId` so the
// literal `notifications` segment is never consumed by the id route.
usersRouter.get('/notifications', requireAuth, getNotificationPreferences);
usersRouter.patch('/notifications', requireAuth, patchNotificationPreferences);
// White-label PDF branding (workstream B). Read is open to any verified user.
usersRouter.get('/branding', requireAuth, getBrandingHandler);
// Owner-only: white-label branding is account identity, not workspace work.
// The read stays open so a member composing a client report still renders the
// workspace's letterhead. Every other users route is caller-scoped
// (`req.user.id`), so a workspace header is inert on them by construction.
usersRouter.put('/branding', requireAuth, requireWorkspaceOwner, putBrandingHandler);
usersRouter.get('/:userId', requireAuth, viewProfile);
