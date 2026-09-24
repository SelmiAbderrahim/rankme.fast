import type { Queue } from 'bullmq';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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
import {
  setCompetitorsDb,
  setTrafficSnapshotsQueue,
} from './competitors.holder.js';

const originalEnabled = env.TRAFFIC_INSIGHTS_ENABLED;

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setCompetitorsDb(db as never);
});

afterAll(async () => {
  (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED = originalEnabled;
  setTrafficSnapshotsQueue(null);
  setCompetitorsDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED = true;
  setTrafficSnapshotsQueue({ add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Queue);
});

describe('traffic-snapshots named rate bucket', () => {
  it('rejects the eleventh account mutation in one window with localized 429 copy', async () => {
    const app = createApp();
    const user = await signupVerifiedUser(app, {
      email: 'traffic-rate-limit@example.test',
    });
    for (let index = 0; index < 10; index += 1) {
      await request(app)
        .post('/api/competitors/traffic-snapshots')
        .set('Cookie', user.cookie)
        .send({ targetDomain: `rate-${index}.example` })
        .expect(202);
    }
    const limited = await request(app)
      .post('/api/competitors/traffic-snapshots')
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'zh')
      .send({ targetDomain: 'rate-over.example' })
      .expect(429);
    expect(limited.body.error).toBe(
      translate('zh', 'trafficInsights.errors.rateLimited'),
    );
  });
});
