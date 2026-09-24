/**
 * Pause enforcement at the API layer — representative spend entry points
 * return the localized 409 for a paused site while stored reads stay 200.
 * (Per-module suites cover the rest; the guard's own branches live in
 * sites.guard.test.ts.)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
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
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { Site } from './sites.model.js';
import { setSitesDb } from './sites.holder.js';
import { setRanksDb, setRanksQueue } from '../ranks/ranks.queue-holder.js';
import { setAuditsQueue } from '../audits/audits.queue-holder.js';

const app = createApp();
const PAUSED_MESSAGE = DICTIONARIES.en.sites.errors.paused;

function insertPausedSite(accountId: string, domain: string) {
  return Site.create({
    accountId,
    url: `https://${domain}`,
    domain,
    displayName: '',
    paused: true,
    pausedAt: new Date(),
  });
}

let user: TestUser;
let siteId: string;

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setSitesDb(db as unknown as never);
  setRanksDb(db as unknown as never);
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  setRanksDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setRanksQueue(null);
  // The audit route 503s on a null queue BEFORE ownership — wire a fake so
  // the request reaches the pause gate; it must never be enqueued to.
  setAuditsQueue({ add: vi.fn() } as never);
  user = await signupVerifiedUser(app, { email: 'enforce@x.co' });
  const site = await insertPausedSite(user.id, 'paused-enforce.example.com');
  siteId = site._id.toHexString();
});

describe('paused-site enforcement at spend entry points', () => {
  it('blocks an audit start with the localized 409 while the audit list read stays 200', async () => {
    const start = await request(app)
      .post(`/api/sites/${siteId}/audits`)
      .set('Cookie', user.cookie)
      .send({});
    expect(start.status).toBe(409);
    expect(start.body.error.message).toBe(PAUSED_MESSAGE);

    const list = await request(app)
      .get(`/api/sites/${siteId}/audits`)
      .set('Cookie', user.cookie);
    expect(list.status).toBe(200);
  });

  it('blocks keyword create, check-now, and cadence change; keyword list read stays 200', async () => {
    const create = await request(app)
      .post(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie)
      .send({
        phrase: 'best coffee',
        locationCode: 2840,
        languageCode: 'en',
        device: 'desktop',
      });
    expect(create.status).toBe(409);
    expect(create.body.error.message).toBe(PAUSED_MESSAGE);

    const check = await request(app)
      .post(`/api/sites/${siteId}/keywords/check`)
      .set('Cookie', user.cookie)
      .send({});
    expect(check.status).toBe(409);
    expect(check.body.error.message).toBe(PAUSED_MESSAGE);

    const cadence = await request(app)
      .patch(`/api/sites/${siteId}/rank-cadence`)
      .set('Cookie', user.cookie)
      .send({ cadence: 'weekly' });
    expect(cadence.status).toBe(409);
    expect(cadence.body.error.message).toBe(PAUSED_MESSAGE);

    const list = await request(app)
      .get(`/api/sites/${siteId}/keywords`)
      .set('Cookie', user.cookie);
    expect(list.status).toBe(200);
  });

  it('GET /api/sites/:id and the site list stay readable while paused', async () => {
    const detail = await request(app)
      .get(`/api/sites/${siteId}`)
      .set('Cookie', user.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.site.paused).toBe(true);

    const list = await request(app).get('/api/sites').set('Cookie', user.cookie);
    expect(list.status).toBe(200);
  });
});
