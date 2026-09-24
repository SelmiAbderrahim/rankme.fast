import { describe, expect, it } from 'vitest';
import { audienceResearchRoutes } from './routes';

describe('audienceResearchRoutes', () => {
  it('is empty — the workspace is a site-workspace tab, not a standalone route', () => {
    expect(audienceResearchRoutes).toEqual([]);
  });
});
