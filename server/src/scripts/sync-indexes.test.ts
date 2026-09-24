import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { syncAllIndexes } from './sync-indexes.js';
import { runSyncIndexesCli } from './run-sync-indexes.js';

const silentLogger = {
  info: vi.fn(),
} as unknown as Logger;

describe('syncAllIndexes', () => {
  it('calls syncIndexes() on every registered model exactly once', async () => {
    const first = { syncIndexes: vi.fn(async () => ['drop-a']) };
    const second = { syncIndexes: vi.fn(async () => []) };
    const model = vi.fn((name: string) => (name === 'A' ? first : second));
    const fakeMongoose = {
      modelNames: () => ['A', 'B'],
      model,
    } as never;
    const result = await syncAllIndexes({ mongoose: fakeMongoose, logger: silentLogger });
    expect(result).toEqual([
      { model: 'A', dropped: ['drop-a'] },
      { model: 'B', dropped: [] },
    ]);
    expect(first.syncIndexes).toHaveBeenCalledTimes(1);
    expect(second.syncIndexes).toHaveBeenCalledTimes(1);
  });

  it('treats a nullish syncIndexes return as an empty dropped list', async () => {
    const model = vi.fn(() => ({
      syncIndexes: vi.fn(async () => undefined as unknown as string[]),
    }));
    const fakeMongoose = {
      modelNames: () => ['OnlyOne'],
      model,
    } as never;
    const result = await syncAllIndexes({ mongoose: fakeMongoose });
    expect(result).toEqual([{ model: 'OnlyOne', dropped: [] }]);
  });
});

describe('runSyncIndexesCli', () => {
  function stubMongoose(models: string[]) {
    const perModel = new Map(
      models.map((name) => [name, { syncIndexes: vi.fn(async () => [] as string[]) }]),
    );
    return {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      modelNames: () => models,
      model: (name: string) => perModel.get(name)!,
    } as never;
  }

  it('connects, syncs, and disconnects — even on syncAllIndexes throw', async () => {
    const stub = stubMongoose(['A']);
    const result = await runSyncIndexesCli({
      mongoose: stub,
      mongoUri: 'mongodb://ignored',
      logger: silentLogger,
    });
    expect(result).toEqual([{ model: 'A', dropped: [] }]);
    expect((stub as never as { connect: ReturnType<typeof vi.fn> }).connect).toHaveBeenCalledWith(
      'mongodb://ignored',
    );
    expect(
      (stub as never as { disconnect: ReturnType<typeof vi.fn> }).disconnect,
    ).toHaveBeenCalled();
  });

  it('always disconnects even when sync throws', async () => {
    const stub = stubMongoose(['A']);
    (stub as never as { model: (name: string) => { syncIndexes: () => Promise<never> } }).model = () => ({
      syncIndexes: async () => {
        throw new Error('boom');
      },
    });
    await expect(
      runSyncIndexesCli({
        mongoose: stub,
        mongoUri: 'mongodb://ignored',
        logger: silentLogger,
      }),
    ).rejects.toThrow(/boom/);
    expect(
      (stub as never as { disconnect: ReturnType<typeof vi.fn> }).disconnect,
    ).toHaveBeenCalled();
  });
});
