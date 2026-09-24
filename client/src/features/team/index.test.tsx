import { describe, expect, it } from 'vitest';
import * as team from './index';

describe('team barrel', () => {
  it('re-exports routes, reducer, reusable components, and selectors', () => {
    expect(team.teamRoutes).toBeDefined();
    expect(team.teamReducer).toBeDefined();
    expect(team.InviteMemberForm).toBeDefined();
    expect(team.TeamMembersTable).toBeDefined();
    expect(team.selectTeamOverview).toBeDefined();
    expect(team.loadTeam).toBeDefined();
  });

  it('resolves every lazy team route to an element', async () => {
    for (const route of [...team.teamRoutes, ...team.teamActionRoutes]) {
      expect(route.lazy).toBeDefined();
      await expect(route.lazy!()).resolves.toMatchObject({ element: expect.anything() });
    }
  });
});
