import { describe, expect, it } from 'vitest';
import { isSiteMutation, isWorkspaceSwitch, isRankJobSettled, rankJobSettled, SITE_MUTATION_ACTION_TYPES, WORKSPACE_SWITCH_ACTION_TYPE } from './invalidation';
import { setActiveWorkspace } from '@features/workspace';
import { addSite, removeSite, renameSite, pauseSite, resumeSite } from '@features/sites';

describe('cache invalidation contracts', () => {
  it('matches the actual workspace and site action creators', () => {
    expect(WORKSPACE_SWITCH_ACTION_TYPE).toBe(setActiveWorkspace.type);
    expect(isWorkspaceSwitch(setActiveWorkspace(null))).toBe(true);
    expect(isWorkspaceSwitch({ type: 'other' })).toBe(false);
    expect(SITE_MUTATION_ACTION_TYPES).toEqual([addSite, removeSite, renameSite, pauseSite, resumeSite].map((thunk) => thunk.fulfilled.type));
    for (const type of SITE_MUTATION_ACTION_TYPES) expect(isSiteMutation({ type })).toBe(true);
    expect(isSiteMutation({ type: addSite.pending.type })).toBe(false);
    expect(isRankJobSettled(rankJobSettled({ siteId: 'site', jobId: 'job' }))).toBe(true);
    expect(isRankJobSettled({ type: 'other' })).toBe(false);
  });
});
