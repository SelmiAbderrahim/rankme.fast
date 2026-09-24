import { describe, expect, it } from 'vitest';
import {
  CONTENT_BRIEF_STATUSES,
  contentBriefStatusFilter,
  isContentBriefTerminal,
} from './types';
import { contentBriefRoutes } from './routes';

describe('content-brief client state types', () => {
  it('accepts every server status as a URL filter and rejects unknown values', () => {
    for (const status of CONTENT_BRIEF_STATUSES) expect(contentBriefStatusFilter(status)).toBe(status);
    expect(contentBriefStatusFilter(null)).toBe('all');
    expect(contentBriefStatusFilter('crafted')).toBe('all');
  });

  it('polls only queued and running briefs', () => {
    expect(isContentBriefTerminal('queued')).toBe(false);
    expect(isContentBriefTerminal('running')).toBe(false);
    expect(isContentBriefTerminal('completed')).toBe(true);
    expect(isContentBriefTerminal('completed_empty')).toBe(true);
    expect(isContentBriefTerminal('completed_partial')).toBe(true);
    expect(isContentBriefTerminal('failed')).toBe(true);
  });

  it('enrolls the editor route in the authenticated site workspace', () => {
    expect(contentBriefRoutes).toHaveLength(1);
    expect(contentBriefRoutes[0]).toMatchObject({
      path: 'sites/:siteId/content-briefs/:briefId/editor',
    });
  });
});
