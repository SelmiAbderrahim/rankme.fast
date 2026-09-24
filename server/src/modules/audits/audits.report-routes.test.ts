/**
 * HTTP tests for GET /api/audits/:runId/report (prompt 08).
 *
 * Locale negotiation runs through the real language middleware, so the
 * parameterized locale test proves the report endpoint really is
 * i18n-terminated: the response body carries localized copy, never keys.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type mongoose from 'mongoose';
import type { Job, Queue } from 'bullmq';
import sharp from 'sharp';
import { createApp } from '../../app.js';
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
import { DICTIONARIES, LANGUAGE_HEADER, SUPPORTED_LOCALES, type SupportedLocale } from '../../shared/i18n/index.js';
import { User } from '../users/users.model.js';
import { setAuditsQueue } from './audits.queue-holder.js';
import { AuditRun } from './audit-run.model.js';
import { Site, setSitesDb } from '../sites/index.js';
import { writeReportSnapshot } from './report.service.js';
import { makeAuditResult } from './rules/fixtures.js';
import { env } from '../../config/env.js';
import { setClientReportsDb } from '../client-reports/index.js';

const app = createApp();
const originalClientReportsFlag = env.CLIENT_REPORTS_ENABLED;

function fakeQueue(): Queue {
  return {
    async add(_name: string, _data: unknown, opts: { jobId?: string }): Promise<Job> {
      return { id: opts.jobId } as Job;
    },
  } as unknown as Queue;
}

async function addSite(user: TestUser): Promise<string> {
  const site = await Site.create({
    accountId: user.id,
    url: 'https://example.com',
    domain: 'example.com',
  });
  return site.id as string;
}

async function seedRunFor(user: TestUser): Promise<{ runId: string; siteId: string; accountId: string }> {
  const siteId = await addSite(user);
  const site = await Site.findById(siteId);
  const run = await AuditRun.create({
    accountId: site!.accountId,
    siteId: site!._id,
    pageCap: 100,
    status: 'succeeded',
  });
  await writeReportSnapshot({
    runId: run.id as string,
    siteId,
    accountId: (site!.accountId as mongoose.Types.ObjectId).toHexString(),
    result: makeAuditResult(),
  });
  return {
    runId: run.id as string,
    siteId,
    accountId: (site!.accountId as mongoose.Types.ObjectId).toHexString(),
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  setClientReportsDb(getTestDb() as unknown as never);
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setClientReportsDb(null);
  (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED =
    originalClientReportsFlag;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setAuditsQueue(fakeQueue());
  (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED = true;
});

afterEach(() => {
  setAuditsQueue(null);
});

describe('GET /api/audits/:runId/report', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/audits/507f191e810c19729de860ea/report');
    expect(res.status).toBe(401);
  });

  it('returns the localized report for the owner', async () => {
    const owner = await signupVerifiedUser(app, { email: 'report-owner@x.co' });
    const { runId } = await seedRunFor(owner);
    const res = await request(app)
      .get(`/api/audits/${runId}/report`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(runId);
    expect(res.body.counts).toEqual({
      fixNow: expect.any(Number),
      watch: expect.any(Number),
      passed: expect.any(Number),
    });
    for (const finding of res.body.findings) {
      expect(finding.copy.title).toBeTypeOf('string');
      expect(finding.copy.title.length).toBeGreaterThan(0);
    }
  });

  it('cross-account run → 404 (no existence leak)', async () => {
    const owner = await signupVerifiedUser(app, { email: 'report-owner2@x.co' });
    const other = await signupVerifiedUser(app, { email: 'report-other@x.co' });
    const { runId } = await seedRunFor(owner);
    const res = await request(app)
      .get(`/api/audits/${runId}/report`)
      .set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });

  it('unknown run → 404', async () => {
    const user = await signupVerifiedUser(app, { email: 'report-unknown@x.co' });
    const res = await request(app)
      .get('/api/audits/507f191e810c19729de860ea/report')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

  it('malformed runId → 404', async () => {
    const user = await signupVerifiedUser(app, { email: 'report-malformed@x.co' });
    const res = await request(app)
      .get('/api/audits/not-an-id/report')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

  it.each(SUPPORTED_LOCALES)(
    'serves copy in %s when x-lang header is set',
    async (locale: SupportedLocale) => {
      const user = await signupVerifiedUser(app, { email: `report-${locale}@x.co` });
      const { runId } = await seedRunFor(user);
      const res = await request(app)
        .get(`/api/audits/${runId}/report`)
        .set('Cookie', user.cookie)
        .set(LANGUAGE_HEADER, locale);
      expect(res.status).toBe(200);
      for (const finding of res.body.findings) {
        expect(finding.copy.title).not.toContain('auditRules.');
      }
    },
  );
});

// ---------------------------------------------------------------------------
// White-label PDF export (workstream B)
// ---------------------------------------------------------------------------

/** superagent leaves unknown content types unparsed — collect raw bytes. */
function pdfRequest(url: string, cookie: string, lang?: string) {
  const req = request(app).get(url).set('Cookie', cookie);
  if (lang) req.set(LANGUAGE_HEADER, lang);
  return req.buffer(true).parse((res, callback) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });
}

function clientPdfRequest(cookie: string, siteId: string, body: unknown) {
  return request(app)
    .post(`/api/client-reports/sites/${siteId}/pdf`)
    .set('Cookie', cookie)
    .send(body as object)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

describe('GET /api/audits/:runId/report.pdf', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/audits/507f191e810c19729de860ea/report.pdf');
    expect(res.status).toBe(401);
  });

  it('rejects unverified accounts with 403', async () => {
    const { signupTestUser } = await import('../../shared/testing/auth.js');
    const user = await signupTestUser(app, { email: 'pdf-unverified@x.co' });
    const res = await request(app)
      .get('/api/audits/507f191e810c19729de860ea/report.pdf')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(403);
  });

  it('streams an attachment PDF for the owner', async () => {
    const user = await signupVerifiedUser(app, { email: 'pdf-pro@x.co' });
    const { runId } = await seedRunFor(user);
    const res = await pdfRequest(`/api/audits/${runId}/report.pdf`, user.cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="rankmefast-report-${runId}.pdf"`,
    );
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('applies stored Mongo branding when present', async () => {
    const user = await signupVerifiedUser(app, { email: 'pdf-branded@x.co' });
    const { runId } = await seedRunFor(user);
    await User.findByIdAndUpdate(user.id, {
      $set: { branding: { companyName: 'Acme SEO', accentColor: '#3366ff' } },
    });
    const res = await pdfRequest(`/api/audits/${runId}/report.pdf`, user.cookie);
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('embeds the normalized stored logo in the branded PDF header', async () => {
    const user = await signupVerifiedUser(app, { email: 'pdf-logo@x.co' });
    const { runId } = await seedRunFor(user);
    const logo = await sharp({
      create: {
        width: 24,
        height: 12,
        channels: 4,
        background: { r: 199, g: 58, b: 34, alpha: 1 },
      },
    }).png().toBuffer();
    await User.findByIdAndUpdate(user.id, {
      $set: {
        branding: {
          companyName: 'Logo Co',
          accentColor: '#3366ff',
          logoPngBase64: logo.toString('base64'),
          logoWidth: 24,
          logoHeight: 12,
        },
      },
    });

    const res = await pdfRequest(`/api/audits/${runId}/report.pdf`, user.cookie);
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders the Arabic (RTL) report', async () => {
    const user = await signupVerifiedUser(app, { email: 'pdf-ar@x.co' });
    const { runId } = await seedRunFor(user);
    const res = await pdfRequest(`/api/audits/${runId}/report.pdf`, user.cookie, 'ar');
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('cross-account run → 404 (no existence leak)', async () => {
    const owner = await signupVerifiedUser(app, { email: 'pdf-owner@x.co' });
    const other = await signupVerifiedUser(app, { email: 'pdf-other@x.co' });
    const { runId } = await seedRunFor(owner);
    const res = await request(app)
      .get(`/api/audits/${runId}/report.pdf`)
      .set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });

  it('unknown run → 404', async () => {
    const user = await signupVerifiedUser(app, { email: 'pdf-unknown@x.co' });
    const res = await request(app)
      .get('/api/audits/507f191e810c19729de860ea/report.pdf')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

  it('still renders when the site row vanishes mid-request and no branding is stored (empty domain, default brand)', async () => {
    const user = await signupVerifiedUser(app, { email: 'pdf-orphan@x.co' });
    const { runId } = await seedRunFor(user);
    // Both docs have to exist when the request starts: `requireAuth` continues
    // under the account work lease and `/api/audits/:runId` continues under the
    // run's site lease, so a deleted account or site is a 404 now, not an
    // orphan render. What is still reachable — and what the controller's
    // `site ? … : ''` guard defends — is the row disappearing between the
    // lease acquire and the controller's own re-read.
    await User.updateOne({ _id: user.id }, { $unset: { branding: 1 } });
    const siteFindOne = vi.spyOn(Site, 'findOne').mockResolvedValue(null as never);
    try {
      const res = await pdfRequest(`/api/audits/${runId}/report.pdf`, user.cookie);
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    } finally {
      siteFindOne.mockRestore();
    }
  });
});

describe('POST /api/client-reports/sites/:siteId/pdf', () => {
  const body = {
    locale: 'en',
    sections: { audit: true, ranks: false, gsc: false },
  };

  it('rejects unauthenticated requests before composition', async () => {
    const res = await request(app)
      .post('/api/client-reports/sites/507f191e810c19729de860ea/pdf')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('returns the deterministic composed PDF attachment', async () => {
    const user = await signupVerifiedUser(app, { email: 'client-pdf-agency@x.co' });
    const { siteId } = await seedRunFor(user);
    const first = await clientPdfRequest(user.cookie, siteId, body);
    const second = await clientPdfRequest(user.cookie, siteId, body);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('application/pdf');
    expect(first.headers['content-disposition']).toBe(
      'attachment; filename="client-report.pdf"',
    );
    expect((first.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect(Buffer.compare(first.body as Buffer, second.body as Buffer)).toBe(0);
  });

  it('blocks new composition when the rollout flag is off', async () => {
    const user = await signupVerifiedUser(app, { email: 'client-pdf-off@x.co' });
    const { siteId } = await seedRunFor(user);
    (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED = false;
    const res = await request(app)
      .post(`/api/client-reports/sites/${siteId}/pdf`)
      .set('Cookie', user.cookie)
      .send(body);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.clientReports.errors.unavailable,
    );
  });

  it('returns 404 for a foreign site and 400 when no section is selected', async () => {
    const owner = await signupVerifiedUser(app, { email: 'client-pdf-owner@x.co' });
    const other = await signupVerifiedUser(app, { email: 'client-pdf-other@x.co' });
    const { siteId } = await seedRunFor(owner);
    const foreign = await request(app)
      .post(`/api/client-reports/sites/${siteId}/pdf`)
      .set('Cookie', other.cookie)
      .send(body);
    expect(foreign.status).toBe(404);

    const invalid = await request(app)
      .post(`/api/client-reports/sites/${siteId}/pdf`)
      .set('Cookie', owner.cookie)
      .send({ locale: 'en', sections: { audit: false, ranks: false, gsc: false } });
    expect(invalid.status).toBe(400);
  });
});
