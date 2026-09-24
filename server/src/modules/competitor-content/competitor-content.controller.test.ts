/**
 * Controller-seam unit tests: the production-db fallback when the
 * holder is unset, and the requireUser 401 guard that the router chain normally
 * satisfies before a controller runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  resolveCompetitorContentDb,
  startRunController,
  suggestCompetitorsController,
} from './competitor-content.controller.js';
import { setCompetitorContentDb } from './competitor-content.holders.js';

afterEach(() => setCompetitorContentDb(null));

describe('resolveCompetitorContentDb', () => {
  it('falls back to the production db when the holder is null', () => {
    setCompetitorContentDb(null);
    expect(resolveCompetitorContentDb()).toBeDefined();
  });
});

describe('requireUser guard', () => {
  it('nexts a 401 when the request carries no authenticated user', async () => {
    const next = vi.fn();
    await suggestCompetitorsController({ params: {} } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });

  it('nexts a 401 when workspace context exists without an authenticated actor', async () => {
    const next = vi.fn();
    await startRunController(
      { workspaceAccountId: '000000000000000000000abc' } as unknown as Request,
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });
});
