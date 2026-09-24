import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSecret } from '../../shared/crypto/index.js';
import { createFakeContentMonitorProvider } from '../../shared/providers/content-monitor-fake.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { ContentMonitor } from './monitor.model.js';
import { setContentMonitorProvider } from './monitoring.holders.js';
import {
  deleteMonitorsForSite,
  pauseMonitorsForSite,
  resumeMonitorsForSite,
} from './monitoring.site-pause.js';

const accountId = new mongoose.Types.ObjectId().toHexString();
const siteId = new mongoose.Types.ObjectId().toHexString();

async function seedMonitor(
  input: {
    status?: 'active' | 'paused';
    pausedBy?: 'site' | 'user' | null;
    providerCredentialRef?: string | null;
    deletionStartedAt?: Date | null;
  } = {},
) {
  return ContentMonitor.create({
    accountId,
    ownerUserId: accountId,
    siteId,
    targetUrl: 'https://example.com/page',
    targetKind: 'owned',
    locale: 'en',
    status: input.status ?? 'active',
    pausedBy: input.pausedBy ?? null,
    providerMonitorIdEncrypted: encryptSecret('remote-monitor-id'),
    providerMonitorRef: 'remote-monitor-ref',
    providerCredentialRef: input.providerCredentialRef ?? null,
    deletionStartedAt: input.deletionStartedAt ?? null,
    createdBy: accountId,
  });
}

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  setContentMonitorProvider(null);
  await clearCollections();
});

afterEach(() => {
  setContentMonitorProvider(null);
});

describe('content-monitor site lifecycle boundaries', () => {
  it('pauses locally without a provider and forwards credential affinity when configured', async () => {
    const local = await seedMonitor();
    await expect(pauseMonitorsForSite(siteId)).resolves.toBe(1);
    await expect(ContentMonitor.findById(local._id).lean()).resolves.toMatchObject({
      status: 'paused',
      pausedBy: 'site',
    });

    await ContentMonitor.deleteMany({});
    await seedMonitor({ providerCredentialRef: 'credential-a' });
    const provider = createFakeContentMonitorProvider();
    const pauseSpy = vi.spyOn(provider, 'pauseMonitor').mockResolvedValueOnce({
      providerMonitorId: 'remote-monitor-id',
      status: 'paused',
    });
    setContentMonitorProvider(provider);
    await expect(pauseMonitorsForSite(siteId)).resolves.toBe(1);
    expect(pauseSpy).toHaveBeenCalledWith(
      expect.objectContaining({ providerCredentialRef: 'credential-a' }),
    );
  });

  it('continues best-effort when a provider pause fails', async () => {
    const monitor = await seedMonitor();
    const provider = createFakeContentMonitorProvider();
    vi.spyOn(provider, 'pauseMonitor').mockRejectedValueOnce(new Error('provider down'));
    setContentMonitorProvider(provider);

    await expect(pauseMonitorsForSite(siteId)).resolves.toBe(0);
    expect((await ContentMonitor.findById(monitor._id))?.status).toBe('active');
  });

  it('resumes site-paused monitors locally and through the affinity-bound provider', async () => {
    const local = await seedMonitor({ status: 'paused', pausedBy: 'site' });
    await expect(resumeMonitorsForSite(siteId)).resolves.toBe(1);
    await expect(ContentMonitor.findById(local._id).lean()).resolves.toMatchObject({
      status: 'active',
      pausedBy: null,
      error: null,
    });

    await ContentMonitor.deleteMany({});
    await seedMonitor({
      status: 'paused',
      pausedBy: 'site',
      providerCredentialRef: 'credential-b',
    });
    const provider = createFakeContentMonitorProvider();
    const resumeSpy = vi.spyOn(provider, 'resumeMonitor').mockResolvedValueOnce({
      providerMonitorId: 'remote-monitor-id',
      status: 'active',
    });
    setContentMonitorProvider(provider);
    await expect(resumeMonitorsForSite(siteId)).resolves.toBe(1);
    expect(resumeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ providerCredentialRef: 'credential-b' }),
    );
  });

  it('continues best-effort when a provider resume fails', async () => {
    const monitor = await seedMonitor({ status: 'paused', pausedBy: 'site' });
    const provider = createFakeContentMonitorProvider();
    vi.spyOn(provider, 'resumeMonitor').mockRejectedValueOnce(new Error('provider down'));
    setContentMonitorProvider(provider);

    await expect(resumeMonitorsForSite(siteId)).resolves.toBe(0);
    expect((await ContentMonitor.findById(monitor._id))?.status).toBe('paused');
  });

  it('returns zero without monitors and fails closed without a deletion provider', async () => {
    await expect(deleteMonitorsForSite(siteId)).resolves.toBe(0);
    await seedMonitor();
    await expect(deleteMonitorsForSite(siteId)).rejects.toMatchObject({
      status: 503,
      message: 'contentIntelligence.monitoring.errors.unavailableRuntime',
    });
  });

  it('preserves a prior deletion timestamp and omits absent credential affinity', async () => {
    const deletionStartedAt = new Date('2026-08-14T00:00:00.000Z');
    const monitor = await seedMonitor({ deletionStartedAt });
    const provider = createFakeContentMonitorProvider();
    const deleteSpy = vi.spyOn(provider, 'deleteMonitor');
    setContentMonitorProvider(provider);

    await expect(deleteMonitorsForSite(siteId)).resolves.toBe(1);
    expect(deleteSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ providerCredentialRef: expect.anything() }),
    );
    expect((await ContentMonitor.findById(monitor._id))?.deletionStartedAt).toEqual(
      deletionStartedAt,
    );
  });

  it('maps a vendor deletion failure to a retryable gateway error', async () => {
    await seedMonitor({ providerCredentialRef: 'credential-c' });
    const provider = createFakeContentMonitorProvider();
    vi.spyOn(provider, 'deleteMonitor').mockRejectedValueOnce(new Error('provider down'));
    setContentMonitorProvider(provider);

    await expect(deleteMonitorsForSite(siteId)).rejects.toMatchObject({
      status: 502,
      message: 'contentIntelligence.monitoring.errors.providerFailed',
    });
  });
});
