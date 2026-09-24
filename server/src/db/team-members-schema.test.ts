import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { user } from './schema/auth.js';
import { teamProvisionedAccounts } from './schema/team-members.js';

describe('team-members schema', () => {
  it('cascades invitation-provisioned provenance with its identity', () => {
    const [foreignKey] = getTableConfig(teamProvisionedAccounts).foreignKeys;
    expect(foreignKey).toBeDefined();
    const reference = foreignKey!.reference();

    expect(reference.columns.map((column) => column.name)).toEqual(['user_id']);
    expect(getTableConfig(reference.foreignTable).name).toBe('user');
    expect(reference.foreignColumns).toEqual([user.id]);
    expect(foreignKey!.onDelete).toBe('cascade');
  });
});
