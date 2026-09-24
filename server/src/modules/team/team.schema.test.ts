import { describe, expect, it } from 'vitest';
import { teamSiteAccessSchema } from './team.schema.js';

describe('team site access schema', () => {
  it('rejects duplicate selected site ids', () => {
    const siteId = '507f1f77bcf86cd799439011';
    const parsed = teamSiteAccessSchema.safeParse({
      mode: 'selected',
      siteIds: [siteId, siteId],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({ message: 'validation.custom.siteIdsUnique' }),
      );
    }
  });
});
