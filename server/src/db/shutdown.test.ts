import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../config/logger.js';
import { disconnectDb } from '../config/db.js';
import { closeDb } from './client.js';
import { closeDatastores } from './shutdown.js';

vi.mock('../config/db.js', () => ({ disconnectDb: vi.fn() }));
vi.mock('./client.js', () => ({ closeDb: vi.fn() }));

const disconnectDbMock = vi.mocked(disconnectDb);
const closeDbMock = vi.mocked(closeDb);

beforeEach(() => {
  vi.clearAllMocks();
  disconnectDbMock.mockResolvedValue(undefined);
  closeDbMock.mockResolvedValue(undefined);
});

describe('closeDatastores', () => {
  it('closes both datastores (mongo + postgres)', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    await expect(closeDatastores()).resolves.toBeUndefined();
    expect(disconnectDbMock).toHaveBeenCalledTimes(1);
    expect(closeDbMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still closes postgres (and resolves) when the mongo disconnect fails', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    disconnectDbMock.mockRejectedValue(new Error('mongo gone'));
    await expect(closeDatastores()).resolves.toBeUndefined();
    expect(closeDbMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
