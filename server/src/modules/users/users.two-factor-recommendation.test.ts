import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth } from '../../shared/testing/auth.js';
import { User } from './users.model.js';

const app = createApp();
const path = '/api/users/preferences/two-factor-recommendation';

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
});
afterAll(async () => {
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('two-factor recommendation dismissal', () => {
  it('requires a session', async () => {
    await request(app).get(path).expect(401);
    await request(app).put(path).expect(401);
  });

  it('records the first dismissal for this user and keeps it on a repeat', async () => {
    const user = await signupVerifiedUser(app, { email: 'recommendation-owner@example.test' });
    const before = await request(app).get(path).set('Cookie', user.cookie).expect(200);
    expect(before.body).toEqual({ dismissedAt: null });
    const first = await request(app).put(path).set('Cookie', user.cookie).expect(200);
    const repeat = await request(app).put(path).set('Cookie', user.cookie).expect(200);
    expect(repeat.body.dismissedAt).toBe(first.body.dismissedAt);
    expect((await User.findById(user.id).lean())?.twoFactorRecommendationDismissedAt).toBeInstanceOf(Date);
  });

  it('keeps another user unaffected by a caller-scoped dismissal', async () => {
    const owner = await signupVerifiedUser(app, { email: 'recommendation-owner-b@example.test' });
    const caller = await signupVerifiedUser(app, { email: 'recommendation-caller@example.test' });
    await request(app).put(path).set('Cookie', caller.cookie).expect(200);
    expect((await request(app).get(path).set('Cookie', owner.cookie).expect(200)).body).toEqual({ dismissedAt: null });
  });

  it('never applies a foreign workspace header to the preference owner', async () => {
    const owner = await signupVerifiedUser(app, { email: 'recommendation-header-owner@example.test' });
    const caller = await signupVerifiedUser(app, { email: 'recommendation-header-caller@example.test' });
    await request(app).put(path).set('Cookie', caller.cookie).set('x-workspace-id', owner.id);
    expect((await User.findById(owner.id).lean())?.twoFactorRecommendationDismissedAt ?? null).toBeNull();
  });
});
