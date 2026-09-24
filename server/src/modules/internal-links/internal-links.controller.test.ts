import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db as productionDb } from '../../db/client.js';
import {
  previewInternalLinkRunController,
  resolveInternalLinksDb,
} from './internal-links.controller.js';
import { setInternalLinksDb } from './internal-links.holder.js';

afterEach(() => setInternalLinksDb(null));

describe('internal-link controller defense in depth', () => {
  it('resolves both injected and production database handles', () => {
    const injected = {} as never;
    setInternalLinksDb(injected);
    expect(resolveInternalLinksDb()).toBe(injected);
    setInternalLinksDb(null);
    expect(resolveInternalLinksDb()).toBe(productionDb);
  });

  it('rejects a direct unauthenticated invocation before parsing or dependencies', async () => {
    const next = vi.fn() as unknown as NextFunction;
    previewInternalLinkRunController(
      { params: {}, body: {} } as Request,
      {} as Response,
      next,
    );
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect((next as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      status: 401,
      message: 'errors.unauthorized',
    });
  });
});
