import { Router } from 'express';
import { requireWorkspaceOwner } from '../../shared/middleware/require-team-role.js';
import { requireTeamSiteAccess } from '../../shared/middleware/team-site-access.js';
import { create, getOne, list, pause, remove, resume, update } from './sites.controller.js';
// Auth is applied at the mount point: app.ts wires this router behind
// [requireAuth, requireVerified] like every other product surface.
export const sitesRouter: Router = Router();
sitesRouter.post('/', requireWorkspaceOwner, create);
sitesRouter.get('/', list);
sitesRouter.get('/:id', requireTeamSiteAccess((req) => req.params.id), getOne);
sitesRouter.patch('/:id', requireTeamSiteAccess((req) => req.params.id), update);
sitesRouter.post('/:id/pause', requireTeamSiteAccess((req) => req.params.id), requireWorkspaceOwner, pause);
sitesRouter.post('/:id/resume', requireTeamSiteAccess((req) => req.params.id), requireWorkspaceOwner, resume);
sitesRouter.delete('/:id', requireTeamSiteAccess((req) => req.params.id), requireWorkspaceOwner, remove);
