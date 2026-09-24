/**
 * Controller-seam unit tests: the production-db fallback when the
 * holder is unset, and the requireUser 401 guard that the router chain normally
 * satisfies before a controller runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  createMonitorController,
  resolveContentMonitorDb,
} from './monitoring.controller.js';
import { setContentMonitorDb } from './monitoring.holders.js';

afterEach(() => setContentMonitorDb(null));

describe('resolveContentMonitorDb', () => {
  it('falls back to the production db when the holder is null', () => {
    setContentMonitorDb(null);
    expect(resolveContentMonitorDb()).toBeDefined();
  });
});

describe('requireUser guard', () => {
  it('nexts a 401 when the request carries no authenticated user', async () => {
    const next = vi.fn();
    await createMonitorController(
      { workspaceAccountId: 'account-1', params: {}, body: {} } as unknown as Request,
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });
});
