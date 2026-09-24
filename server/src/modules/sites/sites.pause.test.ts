import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { domainStates, keywords } from '../../db/schema/keywords.js';
import { sitePulseSettings } from '../../db/schema/weekly-pulse.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { encryptSecret } from '../../shared/crypto/index.js';
import { AuditLog } from '../audit/index.js';
import { Site } from './sites.model.js';
import { setSitesDb } from './sites.holder.js';
import { setRanksQueue } from '../ranks/ranks.queue-holder.js';
import { setPulseQueue } from '../weekly-pulse/pulse.queue-holder.js';
import * as rankScheduler from '../../shared/queue/schedulers.js';
import * as pulseScheduler from '../weekly-pulse/scheduler.js';
import { ContentMonitor } from '../content-monitoring/monitor.model.js';
import {
  providerMonitorRef,
} from '../content-monitoring/monitoring.service.js';
import { setContentMonitorProvider } from '../content-monitoring/monitoring.holders.js';

const app = createApp();

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function seedUser(email = 'pause-owner@x.co'): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

function insertSite(accountId: string, domain: string, overrides: Record<string, unknown> = {}) {
  return Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
    displayName: '',
    ...overrides,
  });
}

function seedMonitor(
  accountId: string,
  siteId: string,
  overrides: Record<string, unknown> = {},
) {
  const providerId = `mon-${new Types.ObjectId().toHexString()}`;
  return ContentMonitor.create({
    accountId,
    ownerUserId: accountId,
    siteId,
    targetUrl: `https://example.com/${new Types.ObjectId().toHexString()}`,
    targetKind: 'owned',
    locale: 'en',
    providerMonitorIdEncrypted: encryptSecret(providerId),
    providerMonitorRef: providerMonitorRef(providerId),
    createdBy: accountId,
    ...overrides,
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setSitesDb(db as unknown as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setRanksQueue(null);
  setPulseQueue(null);
  setContentMonitorProvider(null);
  vi.restoreAllMocks();
});

describe('POST /api/sites/:id/pause', () => {
  it('pauses the site: 200, DTO carries paused + ISO pausedAt, list reflects it, audit logged', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'pause-me.example.com');

    const res = await request(app)
      .post(`/api/sites/${site._id}/pause`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.site.paused).toBe(true);
    expect(res.body.site.pausedAt).toMatch(ISO_8601);
    expect(res.body.message).toBe(DICTIONARIES.en.sites.paused);

    const list = await request(app).get('/api/sites').set('Cookie', user.cookie);
    expect(list.status).toBe(200);
    expect(list.body.sites[0].paused).toBe(true);
    expect(list.body.sites[0].pausedAt).toMatch(ISO_8601);

    const entry = await AuditLog.findOne({ action: 'site.pause' }).lean();
    expect(entry).not.toBeNull();
    expect(String(entry!.targetId)).toBe(site._id.toHexString());
  });

  it('409s a double pause with the localized alreadyPaused message', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'twice.example.com', {
      paused: true,
      pausedAt: new Date(),
    });
    const res = await request(app)
      .post(`/api/sites/${site._id}/pause`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(DICTIONARIES.en.sites.errors.alreadyPaused);
  });

  it('404s cross-account and malformed ids (never 403)', async () => {
    const owner = await seedUser('the-owner@x.co');
    const stranger = await seedUser('stranger@x.co');
    const site = await insertSite(owner.id, 'not-yours.example.com');

    const cross = await request(app)
      .post(`/api/sites/${site._id}/pause`)
      .set('Cookie', stranger.cookie);
    expect(cross.status).toBe(404);

    const malformed = await request(app)
      .post('/api/sites/not-an-id/pause')
      .set('Cookie', owner.cookie);
    expect(malformed.status).toBe(404);

    // The owner's site is untouched by either attempt.
    const fresh = await Site.findById(site._id);
    expect(fresh!.paused).toBe(false);
  });

  it('removes the rank + pulse schedulers when queues are wired', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'scheduled.example.com');
    const siteId = site._id.toHexString();

    const ranksQ = { removeJobScheduler: vi.fn(async () => true) };
    const pulseQ = { removeJobScheduler: vi.fn(async () => true) };
    setRanksQueue(ranksQ as never);
    setPulseQueue(pulseQ as never);
    const rankSpy = vi
      .spyOn(rankScheduler, 'removeRankSchedule')
      .mockResolvedValue(true);
    const pulseSpy = vi
      .spyOn(pulseScheduler, 'removePulseScheduler')
      .mockResolvedValue(true);

    const res = await request(app)
      .post(`/api/sites/${siteId}/pause`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(rankSpy).toHaveBeenCalledWith(ranksQ, siteId);
    expect(pulseSpy).toHaveBeenCalledWith(pulseQ, siteId);
  });

  it('succeeds with null queue holders (teardown arms skipped)', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'no-queues.example.com');
    const res = await request(app)
      .post(`/api/sites/${site._id}/pause`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.site.paused).toBe(true);
  });

  it('pauses active content monitors vendor-side and stamps pausedBy: site', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'monitored.example.com');
    const active = await seedMonitor(user.id, site._id.toHexString(), {
      providerCredentialRef: 'credential-b',
    });
    const provider = {
      pauseMonitor: vi.fn(async () => undefined),
      resumeMonitor: vi.fn(async () => undefined),
    };
    setContentMonitorProvider(provider as never);

    const res = await request(app)
      .post(`/api/sites/${site._id}/pause`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(provider.pauseMonitor).toHaveBeenCalledTimes(1);
    expect(provider.pauseMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ providerCredentialRef: 'credential-b' }),
    );

    const fresh = await ContentMonitor.findById(active._id);
    expect(fresh!.status).toBe('paused');
    expect(fresh!.pausedBy).toBe('site');
  });

  it('monitor pause is best-effort: a provider failure leaves the monitor active but still pauses the site', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'flaky-vendor.example.com');
    const monitor = await seedMonitor(user.id, site._id.toHexString());
    const provider = {
      pauseMonitor: vi.fn(async () => {
        throw new Error('vendor down');
      }),
      resumeMonitor: vi.fn(async () => undefined),
    };
    setContentMonitorProvider(provider as never);

    const res = await request(app)
      .post(`/api/sites/${site._id}/pause`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.site.paused).toBe(true);

    const fresh = await ContentMonitor.findById(monitor._id);
    expect(fresh!.status).toBe('active');
    expect(fresh!.pausedBy).toBeNull();
  });

  it('pauses monitors locally when no provider is configured', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'keyless.example.com');
    const monitor = await seedMonitor(user.id, site._id.toHexString());

    const res = await request(app)
      .post(`/api/sites/${site._id}/pause`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);

    const fresh = await ContentMonitor.findById(monitor._id);
    expect(fresh!.status).toBe('paused');
    expect(fresh!.pausedBy).toBe('site');
  });
});

describe('POST /api/sites/:id/resume', () => {
  it('resumes: 200, DTO cleared, audit logged', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'resume-me.example.com', {
      paused: true,
      pausedAt: new Date(),
    });

    const res = await request(app)
      .post(`/api/sites/${site._id}/resume`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.site.paused).toBe(false);
    expect(res.body.site.pausedAt).toBeNull();
    expect(res.body.message).toBe(DICTIONARIES.en.sites.resumed);

    const entry = await AuditLog.findOne({ action: 'site.resume' }).lean();
    expect(entry).not.toBeNull();
  });

  it('409s resume of a non-paused site with the localized notPaused message', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'never-paused.example.com');
    const res = await request(app)
      .post(`/api/sites/${site._id}/resume`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(DICTIONARIES.en.sites.errors.notPaused);
  });

  it('404s cross-account resume', async () => {
    const owner = await seedUser('resume-owner@x.co');
    const stranger = await seedUser('resume-stranger@x.co');
    const site = await insertSite(owner.id, 'stay-paused.example.com', {
      paused: true,
      pausedAt: new Date(),
    });
    const res = await request(app)
      .post(`/api/sites/${site._id}/resume`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    const fresh = await Site.findById(site._id);
    expect(fresh!.paused).toBe(true);
  });

  it('restores the rank schedule only when an active keyword exists, honoring the stored cadence', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'with-keywords.example.com', {
      paused: true,
      pausedAt: new Date(),
    });
    const siteId = site._id.toHexString();
    const db = getTestDb();
    await db.insert(domainStates).values({ siteId, cadence: 'daily' });
    await db.insert(keywords).values({
      accountId: user.id,
      siteId,
      phrase: 'best coffee',
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
    });

    const ranksQ = { upsertJobScheduler: vi.fn(async () => undefined) };
    setRanksQueue(ranksQ as never);
    const upsertSpy = vi
      .spyOn(rankScheduler, 'upsertRankSchedule')
      .mockResolvedValue(undefined);
    const previousAltEngineFlag = env.ALT_ENGINE_TRACKING_ENABLED;
    (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED = true;

    try {
      const res = await request(app)
        .post(`/api/sites/${siteId}/resume`)
        .set('Cookie', user.cookie);
      expect(res.status).toBe(200);
      expect(upsertSpy).toHaveBeenCalledWith(ranksQ, {
        accountId: user.id,
        siteId,
        cadence: 'daily',
        // Resume snapshots the rollout flag into the recreated scheduler. The
        // processor still filters work to the site's active engine slots.
        altEnginesEnabled: true,
      });
    } finally {
      (env as { ALT_ENGINE_TRACKING_ENABLED: boolean }).ALT_ENGINE_TRACKING_ENABLED =
        previousAltEngineFlag;
    }
  });

  it('does NOT restore the rank schedule when the site has no active keyword', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'no-keywords.example.com', {
      paused: true,
      pausedAt: new Date(),
    });
    setRanksQueue({ upsertJobScheduler: vi.fn() } as never);
    const upsertSpy = vi
      .spyOn(rankScheduler, 'upsertRankSchedule')
      .mockResolvedValue(undefined);

    const res = await request(app)
      .post(`/api/sites/${site._id}/resume`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('restores the pulse scheduler only when site_pulse_settings.enabled', async () => {
    const user = await seedUser();
    const enabledSite = await insertSite(user.id, 'pulse-on.example.com', {
      paused: true,
      pausedAt: new Date(),
    });
    const disabledSite = await insertSite(user.id, 'pulse-off.example.com', {
      paused: true,
      pausedAt: new Date(),
    });
    const db = getTestDb();
    await db.insert(sitePulseSettings).values([
      {
        accountId: user.id,
        siteId: enabledSite._id.toHexString(),
        enabled: true,
        scheduleKey: 0,
        nextRunAt: new Date(),
      },
      {
        accountId: user.id,
        siteId: disabledSite._id.toHexString(),
        enabled: false,
        scheduleKey: 0,
        nextRunAt: new Date(),
      },
    ]);

    const pulseQ = { upsertJobScheduler: vi.fn(async () => undefined) };
    setPulseQueue(pulseQ as never);
    const upsertSpy = vi
      .spyOn(pulseScheduler, 'upsertPulseScheduler')
      .mockResolvedValue(undefined);

    const on = await request(app)
      .post(`/api/sites/${enabledSite._id}/resume`)
      .set('Cookie', user.cookie);
    expect(on.status).toBe(200);
    expect(upsertSpy).toHaveBeenCalledWith(pulseQ, {
      accountId: user.id,
      siteId: enabledSite._id.toHexString(),
    });

    upsertSpy.mockClear();
    const off = await request(app)
      .post(`/api/sites/${disabledSite._id}/resume`)
      .set('Cookie', user.cookie);
    expect(off.status).toBe(200);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('resumes only the monitors the site pause itself paused — a user-paused monitor stays paused', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'mixed-monitors.example.com', {
      paused: true,
      pausedAt: new Date(),
    });
    const siteId = site._id.toHexString();
    const sitePaused = await seedMonitor(user.id, siteId, {
      status: 'paused',
      pausedBy: 'site',
      providerCredentialRef: 'credential-b',
    });
    const userPaused = await seedMonitor(user.id, siteId, {
      status: 'paused',
      pausedBy: null,
    });
    const provider = {
      pauseMonitor: vi.fn(async () => undefined),
      resumeMonitor: vi.fn(async () => undefined),
    };
    setContentMonitorProvider(provider as never);

    const res = await request(app)
      .post(`/api/sites/${siteId}/resume`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(provider.resumeMonitor).toHaveBeenCalledTimes(1);
    expect(provider.resumeMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ providerCredentialRef: 'credential-b' }),
    );

    expect((await ContentMonitor.findById(sitePaused._id))!.status).toBe('active');
    expect((await ContentMonitor.findById(sitePaused._id))!.pausedBy).toBeNull();
    expect((await ContentMonitor.findById(userPaused._id))!.status).toBe('paused');
  });

  it('resumes site-paused monitors locally when no provider is configured', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'keyless-resume.example.com', {
      paused: true,
      pausedAt: new Date(),
    });
    const monitor = await seedMonitor(user.id, site._id.toHexString(), {
      status: 'paused',
      pausedBy: 'site',
    });

    const res = await request(app)
      .post(`/api/sites/${site._id}/resume`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);

    const fresh = await ContentMonitor.findById(monitor._id);
    expect(fresh!.status).toBe('active');
    expect(fresh!.pausedBy).toBeNull();
  });

  it('monitor resume is best-effort: a provider failure leaves the monitor paused but still resumes the site', async () => {
    const user = await seedUser();
    const site = await insertSite(user.id, 'flaky-resume.example.com', {
      paused: true,
      pausedAt: new Date(),
    });
    const monitor = await seedMonitor(user.id, site._id.toHexString(), {
      status: 'paused',
      pausedBy: 'site',
    });
    const provider = {
      pauseMonitor: vi.fn(async () => undefined),
      resumeMonitor: vi.fn(async () => {
        throw new Error('vendor down');
      }),
    };
    setContentMonitorProvider(provider as never);

    const res = await request(app)
      .post(`/api/sites/${site._id}/resume`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.site.paused).toBe(false);

    const fresh = await ContentMonitor.findById(monitor._id);
    expect(fresh!.status).toBe('paused');
    expect(fresh!.pausedBy).toBe('site');
  });
});
