import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  getKeywordClusterRunController,
  listKeywordClusterRunsController,
  previewKeywordClusterRunController,
  startKeywordClusterRunController,
} from './keyword-clusters.controller.js';

const CONTROLLERS = [
  ['preview', previewKeywordClusterRunController],
  ['start', startKeywordClusterRunController],
  ['list', listKeywordClusterRunsController],
  ['detail', getKeywordClusterRunController],
] as const;

describe('keyword-cluster controller defense in depth', () => {
  it.each(CONTROLLERS)(
    'rejects a direct unauthenticated %s invocation before parsing or dependencies',
    async (_name, controller) => {
      const next = vi.fn() as unknown as NextFunction;
      controller(
        { params: {}, body: {}, query: {} } as Request,
        {} as Response,
        next,
      );
      await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
      expect(
        (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
      ).toMatchObject({
        status: 401,
        message: 'errors.unauthorized',
      });
    },
  );

  it('falls back to the production database when no test database is installed', async () => {
    vi.resetModules();
    const productionDb = { source: 'production' };
    const queue = { name: 'keyword-clustering' };
    const preview = { ready: true, readyCount: 2 };
    const previewMock = vi.fn(async () => preview);

    vi.doMock('../../db/client.js', () => ({ db: productionDb }));
    vi.doMock('./keyword-clusters.holder.js', () => ({
      getKeywordClustersDb: () => null,
      getKeywordClustersQueue: () => queue,
    }));
    vi.doMock('./keyword-clusters.service.js', () => ({
      getKeywordClusterRun: vi.fn(),
      listKeywordClusterRuns: vi.fn(),
      previewKeywordClusterRun: previewMock,
      startKeywordClusterRun: vi.fn(),
    }));

    try {
      const { previewKeywordClusterRunController: controller } = await import(
        './keyword-clusters.controller.js'
      );
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      const next = vi.fn() as unknown as NextFunction;
      const siteId = '000000000000000000000001';

      controller(
        {
          user: { id: 'account-1' },
          params: { siteId },
          body: { locale: 'en' },
          query: {},
        } as unknown as Request,
        { status } as unknown as Response,
        next,
      );

      await vi.waitFor(() => expect(json).toHaveBeenCalledWith(preview));
      expect(status).toHaveBeenCalledWith(200);
      expect(previewMock).toHaveBeenCalledWith(
        {
          accountId: 'account-1',
          siteId,
          keywordIds: undefined,
          locale: 'en',
        },
        { db: productionDb, queue },
      );
      expect(next).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('../../db/client.js');
      vi.doUnmock('./keyword-clusters.holder.js');
      vi.doUnmock('./keyword-clusters.service.js');
      vi.resetModules();
    }
  });
});
