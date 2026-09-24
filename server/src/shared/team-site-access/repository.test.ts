import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  teamMembers,
  teamMemberSiteGrants,
} from '../../db/schema/team-members.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../testing/postgres.js';
import { canTeamUserAccessSite } from './repository.js';

const TEAM = '111111111111111111111111';
const USER = '222222222222222222222222';
const SITE_A = '507f1f77bcf86cd799439011';
const SITE_B = '507f1f77bcf86cd799439012';

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

async function membership(mode: 'all' | 'selected', revoked = false) {
  const [row] = await getTestDb().insert(teamMembers).values({
    teamId: TEAM,
    userId: USER,
    email: 'member@example.com',
    role: 'member',
    siteAccessMode: mode,
    inviteTokenHash: `${mode}-${revoked}`.padEnd(64, '0'),
    invitedBy: TEAM,
    acceptedAt: new Date(),
    expiresAt: new Date('2099-01-01T00:00:00Z'),
    revokedAt: revoked ? new Date() : null,
  }).returning({ id: teamMembers.id });
  return row!;
}

describe('canTeamUserAccessSite', () => {
  it('always allows the workspace owner', async () => {
    await expect(canTeamUserAccessSite(getTestDb(), {
      teamId: TEAM,
      userId: TEAM,
      siteId: SITE_B,
    })).resolves.toBe(true);
  });

  it('allows every site for an accepted All-sites membership', async () => {
    await membership('all');
    await expect(canTeamUserAccessSite(getTestDb(), {
      teamId: TEAM,
      userId: USER,
      siteId: SITE_B,
    })).resolves.toBe(true);
  });

  it('allows exactly explicit grants for selected memberships', async () => {
    const row = await membership('selected');
    await getTestDb().insert(teamMemberSiteGrants).values({
      teamMemberId: row.id,
      siteId: SITE_A,
    });
    await expect(canTeamUserAccessSite(getTestDb(), {
      teamId: TEAM,
      userId: USER,
      siteId: SITE_A,
    })).resolves.toBe(true);
    await expect(canTeamUserAccessSite(getTestDb(), {
      teamId: TEAM,
      userId: USER,
      siteId: SITE_B,
    })).resolves.toBe(false);
  });

  it('denies missing, pending, and revoked memberships', async () => {
    const probe = () => canTeamUserAccessSite(getTestDb(), {
      teamId: TEAM,
      userId: USER,
      siteId: SITE_A,
    });
    await expect(probe()).resolves.toBe(false);
    await membership('all', true);
    await expect(probe()).resolves.toBe(false);
  });
});
