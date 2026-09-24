import { describe, expect, it } from 'vitest';
import type { RootState } from '@app/store';
import { selectTeamOverview } from './store/selectors';
import { selectNotificationPreferences } from '@features/settings/store/selectors';
import { selectApiKeys } from '@features/settings/store/apiKeysSelectors';
import { selectBranding } from '@features/settings/store/brandingSelectors';

// Consolidated regression net for the lazy-slice first-render crash class.
// Every guarded root selector must fall back to its slice initial state when
// RTK has not materialized the lazy route reducer yet.
describe('lazy-slice selectors — no throw before the slice materializes', () => {
  const bare = {} as unknown as RootState;

  it('every previously-unguarded slice selector falls back instead of throwing', () => {
    expect(() => selectTeamOverview(bare)).not.toThrow();
    expect(() => selectNotificationPreferences(bare)).not.toThrow();
    expect(() => selectApiKeys(bare)).not.toThrow();
    expect(() => selectBranding(bare)).not.toThrow();
    expect(selectTeamOverview(bare)).toBeNull();
  });
});
