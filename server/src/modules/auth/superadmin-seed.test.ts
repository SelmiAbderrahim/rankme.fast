/**
 * SuperAdmin boot seeder: create / exists / repaired / unconfigured / error,
 * bootstrap credentials never logged, and the seeded account can sign in.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { user as authUserTable } from '../../db/schema/auth.js';
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
import { installTestAuth, uninstallTestAuth } from '../../shared/testing/auth.js';
import { User } from '../users/users.model.js';
import { getAuth } from './auth.js';
import { seedSuperadmin, superadminSeedTestables } from './superadmin-seed.js';

const app = createApp();

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
  vi.restoreAllMocks();
});

describe('seedSuperadmin', () => {
  const original = {
    email: env.SUPERADMIN_EMAIL,
    password: env.SUPERADMIN_PASSWORD,
  };
  const mut = env as unknown as Record<string, string | undefined>;

  function setCreds(email?: string, password?: string): void {
    mut.SUPERADMIN_EMAIL = email;
    mut.SUPERADMIN_PASSWORD = password;
  }

  function promotionDb(input: {
    promoted?: Array<{ id: string }>;
    readback?: { role: string | null; emailVerified: boolean };
  }) {
    return {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue(input.promoted ?? [{ id: 'seed-user' }]),
          })),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([
              input.readback ?? { role: 'SuperAdmin', emailVerified: true },
            ]),
          })),
        })),
      })),
    } as never;
  }

  afterAll(() => {
    mut.SUPERADMIN_EMAIL = original.email;
    mut.SUPERADMIN_PASSWORD = original.password;
  });

  it('no-ops when unconfigured (missing email or password)', async () => {
    setCreds(undefined, undefined);
    const r1 = await seedSuperadmin(getTestDb() as unknown as never);
    expect(r1).toEqual({ created: false, skipped: true, reason: 'unconfigured' });

    setCreds('only-email@example.com', undefined);
    const r2 = await seedSuperadmin(getTestDb() as unknown as never);
    expect(r2.reason).toBe('unconfigured');
    expect(await User.countDocuments({})).toBe(0);
  });

  it('creates the SuperAdmin account, verified, mirrored to Mongo', async () => {
    setCreds('Boss@Example.com', 'super-secret-123');
    const result = await seedSuperadmin(getTestDb() as unknown as never);
    expect(result).toEqual({ created: true, skipped: false, reason: 'created' });

    const rows = await getTestDb()
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.email, 'boss@example.com'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('SuperAdmin');
    expect(rows[0]!.emailVerified).toBe(true);

    const mirror = await User.findById(rows[0]!.id).lean();
    expect(mirror?.role).toBe('SuperAdmin');
  });

  it('skips (no mutation) when the account already exists', async () => {
    setCreds('boss@example.com', 'super-secret-123');
    await seedSuperadmin(getTestDb() as unknown as never);
    const before = await getTestDb()
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.email, 'boss@example.com'));

    const second = await seedSuperadmin(getTestDb() as unknown as never);
    expect(second).toEqual({ created: false, skipped: true, reason: 'exists' });

    const after = await getTestDb()
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.email, 'boss@example.com'));
    expect(after).toHaveLength(1);
    expect(after[0]!.updatedAt.getTime()).toBe(before[0]!.updatedAt.getTime());
  });

  it('repairs an owned partial seed, then preserves a later intentional demotion', async () => {
    setCreds('repair-bootstrap@example.com', 'super-secret-123');
    const mongoFailure = vi.spyOn(User, 'findOneAndUpdate').mockImplementationOnce(
      () =>
        ({
          lean: async () => {
            throw new Error('injected bootstrap Mongo outage');
          },
        }) as never,
    );

    await expect(seedSuperadmin(getTestDb() as unknown as never)).resolves.toEqual({
      created: false,
      skipped: false,
      reason: 'error',
    });
    mongoFailure.mockRestore();

    const [partial] = await getTestDb()
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.email, 'repair-bootstrap@example.com'));
    expect(partial).toMatchObject({ role: 'SuperAdmin', emailVerified: true });
    expect((await User.findById(partial!.id))?.role).toBe('Member');

    await expect(seedSuperadmin(getTestDb() as unknown as never)).resolves.toEqual({
      created: false,
      skipped: false,
      reason: 'repaired',
    });
    expect(await User.findById(partial!.id)).toMatchObject({
      role: 'SuperAdmin',
      emailVerified: true,
    });

    // Once converged the account is operator-managed; boot must not undo an
    // intentional demotion.
    await getTestDb()
      .update(authUserTable)
      .set({ role: 'Owner' })
      .where(eq(authUserTable.id, partial!.id));
    await User.updateOne({ _id: partial!.id }, { $set: { role: 'Owner' } });
    await expect(seedSuperadmin(getTestDb() as unknown as never)).resolves.toEqual({
      created: false,
      skipped: true,
      reason: 'exists',
    });
    expect((await User.findById(partial!.id))?.role).toBe('Owner');
  });

  it('fails closed when a SuperAdmin row has no Mongo mirror at all', async () => {
    setCreds('missing-mirror@example.com', 'super-secret-123');
    await seedSuperadmin(getTestDb() as unknown as never);
    const [row] = await getTestDb()
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.email, 'missing-mirror@example.com'));
    await User.deleteOne({ _id: row!.id });
    vi.spyOn(logger, 'error').mockImplementation(() => logger);

    await expect(seedSuperadmin(getTestDb() as unknown as never)).resolves.toEqual({
      created: false,
      skipped: false,
      reason: 'error',
    });
  });

  it('treats a SuperAdmin row whose mirror is only unverified as a partial seed', async () => {
    setCreds('unverified-mirror@example.com', 'super-secret-123');
    await seedSuperadmin(getTestDb() as unknown as never);
    const [row] = await getTestDb()
      .select()
      .from(authUserTable)
      .where(eq(authUserTable.email, 'unverified-mirror@example.com'));
    await User.updateOne({ _id: row!.id }, { $set: { emailVerified: false } });

    await expect(seedSuperadmin(getTestDb() as unknown as never)).resolves.toMatchObject({
      reason: 'repaired',
    });
    expect((await User.findById(row!.id))?.emailVerified).toBe(true);
  });

  it('resolves reason:error and never throws when signUpEmail fails', async () => {
    setCreds('kaboom@example.com', 'super-secret-123');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    vi.spyOn(getAuth().api, 'signUpEmail').mockRejectedValue(new Error('boom'));
    const result = await seedSuperadmin(getTestDb() as unknown as never);
    expect(result).toEqual({ created: false, skipped: false, reason: 'error' });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('resolves reason:error when signUpEmail returns no user id', async () => {
    setCreds('nouser@example.com', 'super-secret-123');
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
    vi.spyOn(getAuth().api, 'signUpEmail').mockResolvedValue({ user: undefined } as never);
    const result = await seedSuperadmin(getTestDb() as unknown as never);
    expect(result.reason).toBe('error');
  });

  it('fails closed across each bootstrap promotion convergence boundary', async () => {
    await expect(
      superadminSeedTestables.promoteBootstrapUser(promotionDb({ promoted: [] }), 'seed-user'),
    ).rejects.toThrow('Better Auth identity disappeared');

    vi.spyOn(User, 'findOneAndUpdate').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    await expect(
      superadminSeedTestables.promoteBootstrapUser(promotionDb({}), 'seed-user'),
    ).rejects.toThrow('Mongo mirror is missing');

    vi.spyOn(User, 'findOneAndUpdate').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({ _id: 'seed-user' }),
    } as never);
    await expect(
      superadminSeedTestables.promoteBootstrapUser(
        promotionDb({ readback: { role: 'Member', emailVerified: false } }),
        'seed-user',
      ),
    ).rejects.toThrow('Better Auth readback did not converge');

    vi.spyOn(User, 'findOneAndUpdate').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({ _id: 'seed-user' }),
    } as never);
    await expect(
      superadminSeedTestables.promoteBootstrapUser(
        promotionDb({ readback: { role: 'SuperAdmin', emailVerified: false } }),
        'seed-user',
      ),
    ).rejects.toThrow('Better Auth readback did not converge');

    vi.spyOn(User, 'findOneAndUpdate').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({ _id: 'seed-user' }),
    } as never);
    const noReadbackDb = promotionDb({});
    (noReadbackDb as unknown as { select: ReturnType<typeof vi.fn> }).select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    });
    await expect(
      superadminSeedTestables.promoteBootstrapUser(noReadbackDb, 'seed-user'),
    ).rejects.toThrow('Better Auth readback did not converge');
  });

  it('never writes bootstrap credentials to the logs', async () => {
    const password = 'p@ssw0rd-unlogged-xyz';
    const email = 'quiet@example.com';
    setCreds(email, password);
    const captured: string[] = [];
    vi.spyOn(logger, 'info').mockImplementation((...args: unknown[]) => {
      captured.push(JSON.stringify(args));
      return logger;
    });
    await seedSuperadmin(getTestDb() as unknown as never);
    expect(captured.join('\n')).not.toContain(password);
    expect(captured.join('\n')).not.toContain(email);
  });

  it('the seeded account can sign in through the real endpoint', async () => {
    setCreds('login@example.com', 'super-secret-123');
    await seedSuperadmin(getTestDb() as unknown as never);
    const res = await request(app)
      .post('/api/auth/sign-in/email')
      .set('Origin', env.CLIENT_URL)
      .send({ email: 'login@example.com', password: 'super-secret-123' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeTruthy();
  });
});
