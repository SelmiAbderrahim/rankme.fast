import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { translate } from '../../shared/i18n/index.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
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
import { setCompetitorsDb } from './competitors.holder.js';
import { previewTrafficSnapshotSpend } from './traffic-snapshots.preview.js';
import { trafficSnapshotPreviewSchema } from './traffic-snapshots.schema.js';

const originalEnabled = env.TRAFFIC_INSIGHTS_ENABLED;
const app = createApp();
const domains = ['one.example', 'two.example', 'three.example', 'four.example'];

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setCompetitorsDb(db as never);
});

afterAll(async () => {
  (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED = originalEnabled;
  setCompetitorsDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED = true;
});

describe('Traffic Insights spend preview', () => {
  it('returns the community preview without plan capacity', () => {
    expect(previewTrafficSnapshotSpend()).toEqual({
      deploymentMode: 'community',
      capacityEnforced: false,
    });
  });

  it('serves the authenticated bulk route for every verified account', async () => {
    await request(app)
      .post('/api/competitors/traffic-snapshots/preview')
      .send({ domains: ['one.example'] })
      .expect(401);
    const user = await signupVerifiedUser(app, { email: 'preview-community@example.test' });
    const response = await request(app)
      .post('/api/competitors/traffic-snapshots/preview')
      .set('Cookie', user.cookie)
      .send({ domains: ['one.example', 'two.example'] })
      .expect(200);
    expect(response.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
    await request(app)
      .post('/api/competitors/traffic-snapshots/preview')
      .set('Cookie', user.cookie)
      .send({ domains: [] })
      .expect(400);
  });

  it('rejects disabled previews and strict one-to-five unique-domain inputs', async () => {
    (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED = false;
    expect(() => previewTrafficSnapshotSpend()).toThrow(
      expect.objectContaining({ status: 503 }),
    );
    const user = await signupVerifiedUser(app, { email: 'preview-disabled@example.test' });
    const disabled = await request(app)
      .post('/api/competitors/traffic-snapshots/preview')
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'de')
      .send({ domains: ['one.example'] })
      .expect(503);
    expect(disabled.body.error.message).toBe(
      translate('de', 'trafficInsights.errors.productUnavailable'),
    );
    expect(trafficSnapshotPreviewSchema.safeParse({ domains: [] }).success).toBe(false);
    expect(
      trafficSnapshotPreviewSchema.safeParse({ domains: [...domains, 'five.example', 'six.example'] }).success,
    ).toBe(false);
    expect(
      trafficSnapshotPreviewSchema.safeParse({ domains: ['one.example', 'ONE.EXAMPLE'] }).success,
    ).toBe(false);
  });
});
