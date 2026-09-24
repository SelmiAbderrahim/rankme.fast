import type { RouteObject } from 'react-router-dom';
import { rootReducer } from '@app/store';
import {
  RequireAuth,
  RequireVerified,
  RequiredPasswordChangePage,
} from '@features/auth';
import { teamReducer } from './store/slice';

const injectTeamReducer = () => {
  rootReducer.inject({ reducerPath: 'team', reducer: teamReducer });
};

export const teamRoutes: RouteObject[] = [
  {
    path: 'settings/team',
    lazy: async () => {
      const { TeamPage } = await import('./components/TeamPage');
      injectTeamReducer();

      return {
        element: (
          <RequireVerified>
            <TeamPage />
          </RequireVerified>
        ),
      };
    },
  },
];

/** Public preview/decision and provisional credential routes use MinimalLayout. */
export const teamActionRoutes: RouteObject[] = [
  {
    path: 'team/invitations',
    lazy: async () => {
      const { PendingInvitationsPage } = await import('./components/PendingInvitationsPage');
      return {
        element: (
          <RequireAuth>
            <PendingInvitationsPage />
          </RequireAuth>
        ),
      };
    },
  },
  {
    path: 'team/accept/:token',
    lazy: async () => {
      const { AcceptInvitePage } = await import('./components/AcceptInvitePage');
      return { element: <AcceptInvitePage /> };
    },
  },
  {
    path: 'team/reject/:token',
    lazy: async () => {
      const { RejectInvitePage } = await import('./components/RejectInvitePage');
      return { element: <RejectInvitePage /> };
    },
  },
  {
    path: 'team/change-password',
    lazy: async () => {
      return {
        element: (
          <RequireAuth>
            <RequiredPasswordChangePage />
          </RequireAuth>
        ),
      };
    },
  },
];
